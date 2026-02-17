// Provider-specific types for LLM API interactions

import type { Message, Tool } from './openai.js';
import type { Usage } from '../config/types.js';

// ============================================================================
// Provider Request Types
// ============================================================================

export interface ProviderRequest {
  model: string;
  messages: Message[];
  stream: boolean;
  tools?: Tool[];
  accessToken: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
}

// ============================================================================
// Provider Response Types
// ============================================================================

export interface ProviderResponse {
  content: string;
  finishReason: string;
  usage: Usage;
  toolCalls?: ProviderToolCall[];
  functionCall?: ProviderFunctionCall;
}

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ProviderFunctionCall {
  name: string;
  arguments: string;
}

// ============================================================================
// Provider Stream Types
// ============================================================================

export interface ProviderStreamChunk {
  content?: string;
  finishReason?: string;
  toolCallChunk?: ProviderToolCallChunk;
  functionCallChunk?: ProviderFunctionCallChunk;
}

export interface ProviderToolCallChunk {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ProviderFunctionCallChunk {
  name?: string;
  arguments?: string;
}

// ============================================================================
// Provider Error Types
// ============================================================================

export interface ProviderError {
  provider: string;
  statusCode?: number;
  message: string;
  type: 'auth' | 'rate_limit' | 'service_unavailable' | 'invalid_request' | 'unknown';
  retryable: boolean;
}

// ============================================================================
// Provider-Specific Types (OpenAI)
// ============================================================================

export interface OpenAIProviderRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  tools?: Tool[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
}

// ============================================================================
// Provider-Specific Types (Google Gemini)
// ============================================================================

export interface GeminiProviderRequest {
  contents: GeminiContent[];
  generationConfig?: GeminiGenerationConfig;
  tools?: GeminiTool[];
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface GeminiProviderResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
  index: number;
}
