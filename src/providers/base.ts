import {
  ClaudeRequest,
  ClaudeResponse,
  ClaudeMessage,
  ClaudeContentBlock,
  ClaudeTextBlock,
  ClaudeToolUseBlock,
  ClaudeToolResultBlock,
  ClaudeTool,
  ClaudeSystem,
  ClaudeSystemBlock,
  OpenAIRequest,
  OpenAIMessage,
  OpenAIResponse,
  OpenAITool,
  OpenAIToolCall,
  ProviderConfig,
  BetaFeature,
} from '../types';
import { Response } from 'express';

export abstract class BaseProvider {
  protected config: ProviderConfig;
  protected modelOverride?: string;
  protected betaFeatures: BetaFeature[] = [];

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  setModelOverride(model: string): void {
    this.modelOverride = model;
  }

  clearModelOverride(): void {
    this.modelOverride = undefined;
  }

  setBetaFeatures(features: BetaFeature[]): void {
    this.betaFeatures = features;
  }

  clearBetaFeatures(): void {
    this.betaFeatures = [];
  }

  protected getEffectiveModel(): string {
    return this.modelOverride || this.config.model;
  }

  protected extractSystemContent(system: ClaudeSystem): string {
    if (typeof system === 'string') {
      return system;
    }
    // Array of system blocks - extract text content
    return system
      .map(block => block.text)
      .join('\n\n');
  }

  protected convertClaudeToOpenAI(request: ClaudeRequest): OpenAIRequest {
    const messages: OpenAIMessage[] = [];

    // Add system message if present (handle both string and array format)
    if (request.system) {
      messages.push({
        role: 'system',
        content: this.extractSystemContent(request.system),
      });
    }

    // Convert Claude messages to OpenAI format
    for (const msg of request.messages) {
      const convertedMessages = this.convertClaudeMessageToOpenAI(msg);
      messages.push(...convertedMessages);
    }

    const openAIRequest: OpenAIRequest = {
      model: this.getEffectiveModel(),
      messages,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      top_p: request.top_p,
      stream: request.stream,
    };

    // Add top_k if present (some providers support this)
    if (request.top_k !== undefined) {
      openAIRequest.top_k = request.top_k;
    }

    // Convert stop_sequences to stop
    if (request.stop_sequences && request.stop_sequences.length > 0) {
      openAIRequest.stop = request.stop_sequences;
    }

    // Convert tools if present
    if (request.tools && request.tools.length > 0) {
      openAIRequest.tools = this.convertClaudeToolsToOpenAI(request.tools);
    }

    // Convert tool_choice if present
    if (request.tool_choice) {
      openAIRequest.tool_choice = this.convertClaudeToolChoiceToOpenAI(request.tool_choice);
    }

    return openAIRequest;
  }

  protected convertClaudeMessageToOpenAI(msg: ClaudeMessage): OpenAIMessage[] {
    const messages: OpenAIMessage[] = [];

    if (typeof msg.content === 'string') {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
      return messages;
    }

    // Group content blocks by type
    const textBlocks: ClaudeTextBlock[] = [];
    const toolUseBlocks: ClaudeToolUseBlock[] = [];
    const toolResultBlocks: ClaudeToolResultBlock[] = [];

    for (const block of msg.content) {
      if (block.type === 'text') {
        textBlocks.push(block as ClaudeTextBlock);
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push(block as ClaudeToolUseBlock);
      } else if (block.type === 'tool_result') {
        toolResultBlocks.push(block as ClaudeToolResultBlock);
      }
    }

    // Handle assistant messages with tool_use
    if (msg.role === 'assistant') {
      const textContent = textBlocks.map(b => b.text).join('\n') || null;

      if (toolUseBlocks.length > 0) {
        // Assistant message with tool calls
        const toolCalls: OpenAIToolCall[] = toolUseBlocks.map(block => ({
          id: block.id,
          type: 'function' as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        }));

        messages.push({
          role: 'assistant',
          content: textContent,
          tool_calls: toolCalls,
        });
      } else {
        messages.push({
          role: 'assistant',
          content: textContent || '',
        });
      }
    }
    // Handle user messages with tool_result
    else if (msg.role === 'user') {
      // First add tool results as separate tool messages
      for (const block of toolResultBlocks) {
        const resultContent = typeof block.content === 'string'
          ? block.content
          : block.content.map(b => b.text).join('\n');

        messages.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: resultContent,
        });
      }

      // Then add any text content as user message
      if (textBlocks.length > 0) {
        messages.push({
          role: 'user',
          content: textBlocks.map(b => b.text).join('\n'),
        });
      }
    }

    return messages;
  }

  protected convertClaudeToolsToOpenAI(tools: ClaudeTool[]): OpenAITool[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  protected convertClaudeToolChoiceToOpenAI(toolChoice: { type: string; name?: string }): 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } } {
    switch (toolChoice.type) {
      case 'auto':
        return 'auto';
      case 'any':
        return 'required';
      case 'tool':
        if (toolChoice.name) {
          return { type: 'function', function: { name: toolChoice.name } };
        }
        return 'required';
      default:
        return 'auto';
    }
  }

  protected extractTextContent(content: string | ClaudeContentBlock[]): string {
    if (typeof content === 'string') {
      return content;
    }

    return content
      .filter((block): block is ClaudeTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  protected convertOpenAIToClaude(
    response: OpenAIResponse,
    originalModel: string
  ): ClaudeResponse {
    const choice = response.choices[0];
    const content: ClaudeContentBlock[] = [];

    // Add text content if present
    if (choice?.message?.content) {
      content.push({
        type: 'text',
        text: choice.message.content,
      });
    }

    // Convert tool_calls to tool_use blocks
    if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
      for (const toolCall of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments || '{}'),
        });
      }
    }

    // Ensure we have at least an empty text block if no content
    if (content.length === 0) {
      content.push({
        type: 'text',
        text: '',
      });
    }

    return {
      id: `msg_${response.id}`,
      type: 'message',
      role: 'assistant',
      content,
      model: originalModel,
      stop_reason: this.mapFinishReason(choice?.finish_reason),
      stop_sequence: null,
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
      },
    };
  }

  protected mapFinishReason(reason: string | null): string {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'length':
        return 'max_tokens';
      case 'content_filter':
        return 'stop_sequence';
      case 'tool_calls':
        return 'tool_use';
      default:
        return 'end_turn';
    }
  }

  protected generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  abstract complete(request: ClaudeRequest): Promise<ClaudeResponse>;
  abstract stream(request: ClaudeRequest, res: Response): Promise<void>;
}
