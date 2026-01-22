export type Provider = 'lmstudio' | 'ollama';

export interface ModelRouting {
  [claudeModel: string]: string;
}

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  modelRouting?: ModelRouting;
}

export interface Config {
  provider: Provider;
  port: number;
  lmstudio: ProviderConfig;
  ollama: ProviderConfig;
}

// Beta features
export type BetaFeature =
  | 'computer-use-2025-01-24'
  | 'files-api-2025-04-14'
  | 'interleaved-thinking-2025-05-14'
  | 'prompt-caching-2024-07-31'
  | 'max-tokens-3-5-sonnet-2024-07-15'
  | string;

// Cache control for prompt caching
export interface CacheControl {
  type: 'ephemeral';
  ttl?: number;
}

// System prompt can be string or array with cache control
export interface ClaudeSystemBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

export type ClaudeSystem = string | ClaudeSystemBlock[];

// Extended thinking configuration
export interface ThinkingConfig {
  type: 'enabled' | 'disabled';
  budget_tokens?: number;
}

// Metadata for requests
export interface RequestMetadata {
  user_id?: string;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

export interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ClaudeTextBlock[];
  is_error?: boolean;
}

export interface ClaudeImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

// Thinking content block (extended thinking)
export interface ClaudeThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

// Redacted thinking block
export interface ClaudeRedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}

// Document block (for files API)
export interface ClaudeDocumentBlock {
  type: 'document';
  source: {
    type: 'base64' | 'file';
    media_type?: string;
    data?: string;
    file_id?: string;
  };
  cache_control?: CacheControl;
}

export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeToolUseBlock
  | ClaudeToolResultBlock
  | ClaudeImageBlock
  | ClaudeThinkingBlock
  | ClaudeRedactedThinkingBlock
  | ClaudeDocumentBlock;

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ClaudeToolChoice {
  type: 'auto' | 'any' | 'tool';
  name?: string;
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: ClaudeSystem;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  tools?: ClaudeTool[];
  tool_choice?: ClaudeToolChoice;
  stop_sequences?: string[];
  thinking?: ThinkingConfig;
  metadata?: RequestMetadata;
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: ClaudeUsage;
}

// Token counting request/response
export interface TokenCountRequest {
  model: string;
  messages: ClaudeMessage[];
  system?: ClaudeSystem;
  tools?: ClaudeTool[];
  thinking?: ThinkingConfig;
}

export interface TokenCountResponse {
  input_tokens: number;
}

// Batch processing types
export interface BatchRequest {
  custom_id: string;
  params: ClaudeRequest;
}

export interface BatchCreateRequest {
  requests: BatchRequest[];
}

export interface BatchResponse {
  id: string;
  type: 'message_batch';
  processing_status: 'in_progress' | 'ended';
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  ended_at: string | null;
  created_at: string;
  expires_at: string;
  results_url: string | null;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface OpenAIToolChoice {
  type: 'auto' | 'none' | 'required' | 'function';
  function?: { name: string };
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | 'required' | OpenAIToolChoice;
  stop?: string[];
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIStreamToolCall {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAIStreamToolCall[];
    };
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
