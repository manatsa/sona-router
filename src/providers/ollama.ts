import { BaseProvider } from './base';
import { ClaudeRequest, ClaudeResponse, OpenAIResponse, OpenAIStreamChunk, OpenAIStreamToolCall, ProviderConfig } from '../types';
import { Response } from 'express';
import * as http from 'http';
import * as https from 'https';
import chalk from 'chalk';

interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

export class OllamaProvider extends BaseProvider {
  private modelLoadAttempted: Set<string> = new Set();

  constructor(config: ProviderConfig) {
    super(config);
  }

  // Get Ollama native API base URL (without /v1)
  private getOllamaApiBase(): string {
    const url = new URL(this.config.baseUrl);
    // Remove /v1 suffix if present to get native Ollama API
    const base = url.origin;
    return base;
  }

  // Check if model is available locally
  async isModelAvailable(modelName: string): Promise<boolean> {
    try {
      const base = this.getOllamaApiBase();
      const response = await fetch(`${base}/api/tags`);
      if (!response.ok) return false;

      const data = await response.json() as OllamaTagsResponse;
      const normalizedName = modelName.split(':')[0].toLowerCase();

      return data.models.some(m => {
        const name = m.name.split(':')[0].toLowerCase();
        return name === normalizedName || m.name.toLowerCase() === modelName.toLowerCase();
      });
    } catch {
      return false;
    }
  }

  // Pull/download a model
  async pullModel(modelName: string): Promise<boolean> {
    console.log(chalk.yellow(`  Pulling model ${modelName}...`));

    try {
      const base = this.getOllamaApiBase();
      const response = await fetch(`${base}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: false }),
      });

      if (response.ok) {
        console.log(chalk.green(`  Model ${modelName} pulled successfully`));
        return true;
      } else {
        const text = await response.text();
        console.log(chalk.red(`  Failed to pull model: ${text}`));
        return false;
      }
    } catch (error) {
      console.log(chalk.red(`  Error pulling model: ${error}`));
      return false;
    }
  }

  // Load/warm up a model by sending a minimal request
  async loadModel(modelName: string): Promise<boolean> {
    console.log(chalk.yellow(`  Loading model ${modelName}...`));

    try {
      const base = this.getOllamaApiBase();
      const response = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          prompt: '',
          stream: false,
        }),
      });

      if (response.ok) {
        console.log(chalk.green(`  Model ${modelName} loaded successfully`));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Ensure model is available and loaded
  async ensureModelReady(modelName: string): Promise<void> {
    // Prevent infinite loops
    if (this.modelLoadAttempted.has(modelName)) {
      return;
    }
    this.modelLoadAttempted.add(modelName);

    const isAvailable = await this.isModelAvailable(modelName);

    if (!isAvailable) {
      console.log(chalk.yellow(`  Model ${modelName} not found locally`));
      const pulled = await this.pullModel(modelName);
      if (!pulled) {
        throw new Error(`Failed to pull model ${modelName}. Please run: ollama pull ${modelName}`);
      }
    }

    // Load the model to warm it up
    await this.loadModel(modelName);
  }

  async complete(request: ClaudeRequest): Promise<ClaudeResponse> {
    const openAIRequest = this.convertClaudeToOpenAI(request);
    openAIRequest.stream = false;

    try {
      const response = await this.makeRequest('/chat/completions', openAIRequest);
      return this.convertOpenAIToClaude(response as OpenAIResponse, request.model);
    } catch (error) {
      // If request failed, try to ensure model is ready and retry
      const modelName = this.getEffectiveModel();
      if (error instanceof Error && (
        error.message.includes('model') ||
        error.message.includes('not found') ||
        error.message.includes('404') ||
        error.message.includes('ECONNREFUSED')
      )) {
        await this.ensureModelReady(modelName);
        // Retry the request
        const response = await this.makeRequest('/chat/completions', openAIRequest);
        return this.convertOpenAIToClaude(response as OpenAIResponse, request.model);
      }
      throw error;
    }
  }

  async stream(request: ClaudeRequest, res: Response): Promise<void> {
    const openAIRequest = this.convertClaudeToOpenAI(request);
    openAIRequest.stream = true;

    // Pre-check if model is available for streaming
    const modelName = this.getEffectiveModel();
    const isAvailable = await this.isModelAvailable(modelName);
    if (!isAvailable) {
      await this.ensureModelReady(modelName);
    }

    const url = new URL(this.config.baseUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}/chat/completions`.replace('//', '/'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
      },
    };

    return new Promise((resolve, reject) => {
      const req = httpModule.request(options, (upstream) => {
        // Set up SSE headers for Claude format
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const messageId = this.generateMessageId();
        let inputTokens = 0;
        let outputTokens = 0;
        let buffer = '';
        let hasStartedTextBlock = false;
        let currentBlockIndex = 0;
        let finishReason = 'end_turn';

        // Track streaming tool calls
        const toolCalls: Map<number, StreamingToolCall> = new Map();
        let hasToolCalls = false;

        // Send initial message_start event
        const messageStart = {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: request.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        };
        res.write(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`);

        upstream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                continue;
              }

              try {
                const parsed = JSON.parse(data) as OpenAIStreamChunk;
                const choice = parsed.choices[0];
                const content = choice?.delta?.content;
                const deltaToolCalls = choice?.delta?.tool_calls;

                // Handle text content
                if (content) {
                  if (!hasStartedTextBlock) {
                    const blockStart = {
                      type: 'content_block_start',
                      index: currentBlockIndex,
                      content_block: { type: 'text', text: '' },
                    };
                    res.write(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`);
                    hasStartedTextBlock = true;
                  }

                  outputTokens++;
                  const delta = {
                    type: 'content_block_delta',
                    index: currentBlockIndex,
                    delta: { type: 'text_delta', text: content },
                  };
                  res.write(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`);
                }

                // Handle tool calls
                if (deltaToolCalls && deltaToolCalls.length > 0) {
                  hasToolCalls = true;

                  for (const toolCallDelta of deltaToolCalls) {
                    const tcIndex = toolCallDelta.index;

                    if (!toolCalls.has(tcIndex)) {
                      // New tool call starting
                      toolCalls.set(tcIndex, {
                        id: toolCallDelta.id || `toolu_${Date.now()}_${tcIndex}`,
                        name: toolCallDelta.function?.name || '',
                        arguments: '',
                      });
                    }

                    const tc = toolCalls.get(tcIndex)!;

                    // Update with any new data
                    if (toolCallDelta.id) tc.id = toolCallDelta.id;
                    if (toolCallDelta.function?.name) tc.name = toolCallDelta.function.name;
                    if (toolCallDelta.function?.arguments) {
                      tc.arguments += toolCallDelta.function.arguments;
                    }
                  }
                }

                // Track finish reason
                if (choice?.finish_reason) {
                  finishReason = this.mapFinishReason(choice.finish_reason);
                }

                if (parsed.usage) {
                  inputTokens = parsed.usage.prompt_tokens || inputTokens;
                }
              } catch {
                // Ignore parse errors for malformed chunks
              }
            }
          }
        });

        upstream.on('end', () => {
          // Close text block if we started one
          if (hasStartedTextBlock) {
            const blockStop = { type: 'content_block_stop', index: currentBlockIndex };
            res.write(`event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`);
            currentBlockIndex++;
          }

          // Emit tool_use blocks
          if (hasToolCalls) {
            for (const [, tc] of toolCalls) {
              // Start tool_use block
              const toolBlockStart = {
                type: 'content_block_start',
                index: currentBlockIndex,
                content_block: {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.name,
                  input: {},
                },
              };
              res.write(`event: content_block_start\ndata: ${JSON.stringify(toolBlockStart)}\n\n`);

              // Send input as JSON delta
              if (tc.arguments) {
                const inputDelta = {
                  type: 'content_block_delta',
                  index: currentBlockIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.arguments,
                  },
                };
                res.write(`event: content_block_delta\ndata: ${JSON.stringify(inputDelta)}\n\n`);
              }

              // Stop tool_use block
              const toolBlockStop = { type: 'content_block_stop', index: currentBlockIndex };
              res.write(`event: content_block_stop\ndata: ${JSON.stringify(toolBlockStop)}\n\n`);
              currentBlockIndex++;
            }
          }

          // If no content blocks were created, create an empty text block
          if (!hasStartedTextBlock && !hasToolCalls) {
            const blockStart = {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            };
            res.write(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`);
            const blockStop = { type: 'content_block_stop', index: 0 };
            res.write(`event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`);
          }

          // Send message_delta with final info
          const messageDelta = {
            type: 'message_delta',
            delta: { stop_reason: finishReason, stop_sequence: null },
            usage: { output_tokens: outputTokens },
          };
          res.write(`event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`);

          // Send message_stop
          const messageStop = { type: 'message_stop' };
          res.write(`event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`);

          res.end();
          resolve();
        });

        upstream.on('error', (err) => {
          reject(err);
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(JSON.stringify(openAIRequest));
      req.end();
    });
  }

  private async makeRequest(endpoint: string, body: unknown): Promise<unknown> {
    const url = new URL(this.config.baseUrl);
    const fullUrl = `${url.origin}${url.pathname}${endpoint}`.replace('//', '/');

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama request failed: ${response.status} ${text}`);
    }

    return response.json();
  }
}
