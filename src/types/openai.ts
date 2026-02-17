// OpenAI API types based on the OpenAI API specification

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

export interface Message {
  role: MessageRole;
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  function_call?: FunctionCall;
}

// ============================================================================
// Tool and Function Types
// ============================================================================

export interface Tool {
  type: 'function';
  function: FunctionDefinition;
}

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: FunctionCallDetails;
}

export interface FunctionCallDetails {
  name: string;
  arguments: string;
}

export interface FunctionCall {
  name: string;
  arguments: string;
}

// ============================================================================
// Request Types
// ============================================================================

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
  function_call?: 'none' | 'auto' | { name: string };
  functions?: FunctionDefinition[];
  response_format?: { type: 'text' | 'json_object' };
}

// ============================================================================
// Response Types
// ============================================================================

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
  system_fingerprint?: string;
}

export interface ChatCompletionChoice {
  index: number;
  message: Message;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
  logprobs?: null;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ============================================================================
// Streaming Response Types
// ============================================================================

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  system_fingerprint?: string;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
  logprobs?: null;
}

export interface ChatCompletionChunkDelta {
  role?: MessageRole;
  content?: string | null;
  tool_calls?: ToolCallChunk[];
  function_call?: FunctionCallChunk;
}

export interface ToolCallChunk {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface FunctionCallChunk {
  name?: string;
  arguments?: string;
}

// ============================================================================
// Error Types
// ============================================================================

export interface OpenAIError {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | null;
  };
}
