import { randomUUID } from 'crypto';
import type {
  ProviderResponse,
  ProviderStreamChunk,
  ProviderError,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionChoice,
  ChatCompletionChunkChoice,
  ChatCompletionChunkDelta,
  OpenAIError,
  Message,
  ToolCallChunk,
} from '../types/index.js';

export class ResponseTransformer {
  /**
   * Convert ProviderResponse to OpenAI ChatCompletionResponse.
   */
  toOpenAIResponse(providerResponse: ProviderResponse, model: string): ChatCompletionResponse {
    const message: Message = {
      role: 'assistant',
      content: providerResponse.content,
    };

    if (providerResponse.toolCalls) {
      message.tool_calls = providerResponse.toolCalls.map(tc => ({
        id: tc.id,
        type: tc.type,
        function: tc.function,
      }));
    }

    if (providerResponse.functionCall) {
      message.function_call = providerResponse.functionCall;
    }

    // Map finishReason
    let finish_reason: ChatCompletionChoice['finish_reason'] = 'stop';
    if (providerResponse.finishReason === 'length') finish_reason = 'length';
    else if (providerResponse.finishReason === 'tool_calls') finish_reason = 'tool_calls';
    else if (providerResponse.finishReason === 'content_filter') finish_reason = 'content_filter';
    else if (providerResponse.finishReason === 'function_call') finish_reason = 'function_call';

    return {
      id: this.generateCompletionId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message,
        finish_reason,
        logprobs: null,
      }],
      usage: {
        prompt_tokens: providerResponse.usage.promptTokens,
        completion_tokens: providerResponse.usage.completionTokens,
        total_tokens: providerResponse.usage.totalTokens,
      },
    };
  }

  /**
   * Convert ProviderStreamChunk to ChatCompletionChunk.
   */
  toOpenAIChunk(chunk: ProviderStreamChunk, model: string, streamId: string): ChatCompletionChunk {
    const delta: ChatCompletionChunkDelta = {};

    if (chunk.content !== undefined) {
      delta.content = chunk.content;
    }

    if (chunk.toolCallChunk) {
      const toolCallChunk: ToolCallChunk = {
        index: chunk.toolCallChunk.index,
      };
      if (chunk.toolCallChunk.id !== undefined) toolCallChunk.id = chunk.toolCallChunk.id;
      if (chunk.toolCallChunk.type !== undefined) toolCallChunk.type = chunk.toolCallChunk.type;
      if (chunk.toolCallChunk.function !== undefined) toolCallChunk.function = chunk.toolCallChunk.function;
      delta.tool_calls = [toolCallChunk];
    }

    if (chunk.functionCallChunk) {
      delta.function_call = chunk.functionCallChunk;
    }

    let finish_reason: ChatCompletionChunkChoice['finish_reason'] = null;
    if (chunk.finishReason) {
      if (chunk.finishReason === 'stop') finish_reason = 'stop';
      else if (chunk.finishReason === 'length') finish_reason = 'length';
      else if (chunk.finishReason === 'tool_calls') finish_reason = 'tool_calls';
      else if (chunk.finishReason === 'content_filter') finish_reason = 'content_filter';
      else if (chunk.finishReason === 'function_call') finish_reason = 'function_call';
    }

    return {
      id: streamId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        delta,
        finish_reason,
        logprobs: null,
      }],
    };
  }

  /**
   * Convert ProviderError to OpenAI error format.
   */
  toOpenAIError(error: ProviderError): OpenAIError {
    let type: string;
    let code: string | null = null;

    switch (error.type) {
      case 'auth':
        type = 'authentication_error';
        code = 'invalid_api_key';
        break;
      case 'rate_limit':
        type = 'rate_limit_error';
        code = 'rate_limit_exceeded';
        break;
      case 'invalid_request':
        type = 'invalid_request_error';
        break;
      case 'service_unavailable':
        type = 'server_error';
        code = 'service_unavailable';
        break;
      default:
        type = 'server_error';
        break;
    }

    return {
      error: {
        message: error.message,
        type,
        param: null,
        code,
      },
    };
  }

  generateCompletionId(): string {
    return `chatcmpl-${randomUUID()}`;
  }

  formatSSE(chunk: ChatCompletionChunk): string {
    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  formatSSEDone(): string {
    return 'data: [DONE]\n\n';
  }
}
