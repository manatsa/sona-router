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

interface LMStudioModel {
  id: string;
  object: string;
}

export class LMStudioProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  // Check if LM Studio is running and get loaded models
  async getLoadedModels(): Promise<string[]> {
    try {
      const url = new URL(this.config.baseUrl);
      const response = await fetch(`${url.origin}${url.pathname}/models`.replace('//', '/'));
      if (!response.ok) return [];

      const data = await response.json() as { data: LMStudioModel[] };
      return data.data?.map(m => m.id) || [];
    } catch {
      return [];
    }
  }

  // Check if LM Studio server is running
  async isServerRunning(): Promise<boolean> {
    try {
      const url = new URL(this.config.baseUrl);
      const response = await fetch(`${url.origin}${url.pathname}/models`.replace('//', '/'));
      return response.ok;
    } catch {
      return false;
    }
  }

  // Provide helpful error message for LM Studio
  private async getHelpfulError(error: Error): Promise<Error> {
    const modelName = this.getEffectiveModel();

    // Check if server is running
    const serverRunning = await this.isServerRunning();
    if (!serverRunning) {
      console.log(chalk.red('\n  LM Studio server is not running!'));
      console.log(chalk.yellow('  Please:'));
      console.log(chalk.white('    1. Open LM Studio'));
      console.log(chalk.white('    2. Load a model'));
      console.log(chalk.white('    3. Start the local server (Developer tab)\n'));
      return new Error(`LM Studio server not running at ${this.config.baseUrl}. Please start LM Studio and load a model.`);
    }

    // Check loaded models
    const loadedModels = await this.getLoadedModels();
    if (loadedModels.length === 0) {
      console.log(chalk.red('\n  No model loaded in LM Studio!'));
      console.log(chalk.yellow('  Please load a model in LM Studio:'));
      console.log(chalk.white(`    Requested: ${modelName}`));
      console.log(chalk.white('    Go to LM Studio > Select a model > Load\n'));
      return new Error(`No model loaded in LM Studio. Please load "${modelName}" or another model.`);
    }

    // Model mismatch
    if (!loadedModels.some(m => m.toLowerCase().includes(modelName.toLowerCase().split('/').pop() || ''))) {
      console.log(chalk.yellow('\n  Model mismatch in LM Studio'));
      console.log(chalk.white(`    Requested: ${modelName}`));
      console.log(chalk.white(`    Loaded:    ${loadedModels.join(', ')}`));
      console.log(chalk.gray('    (Request will use the loaded model)\n'));
    }

    return error;
  }

  async complete(request: ClaudeRequest): Promise<ClaudeResponse> {
    const openAIRequest = this.convertClaudeToOpenAI(request);
    openAIRequest.stream = false;

    try {
      const response = await this.makeRequest('/chat/completions', openAIRequest);
      return this.convertOpenAIToClaude(response as OpenAIResponse, request.model);
    } catch (error) {
      if (error instanceof Error) {
        throw await this.getHelpfulError(error);
      }
      throw error;
    }
  }

  async stream(request: ClaudeRequest, res: Response): Promise<void> {
    const openAIRequest = this.convertClaudeToOpenAI(request);
    openAIRequest.stream = true;

    // Pre-check if LM Studio is running
    const serverRunning = await this.isServerRunning();
    if (!serverRunning) {
      const error = await this.getHelpfulError(new Error('Server not running'));
      throw error;
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
      throw new Error(`LM Studio request failed: ${response.status} ${text}`);
    }

    return response.json();
  }
}
