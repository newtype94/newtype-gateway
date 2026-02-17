import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { ResponseTransformer } from '../src/transformer/response-transformer.js';
import type {
  ProviderResponse,
  ProviderStreamChunk,
  ProviderError,
} from '../src/types/index.js';

describe('ResponseTransformer', () => {
  let transformer: ResponseTransformer;

  beforeEach(() => {
    transformer = new ResponseTransformer();
  });

  // Test 1: toOpenAIResponse produces valid ChatCompletionResponse structure
  it('toOpenAIResponse produces valid ChatCompletionResponse structure', () => {
    const providerResponse: ProviderResponse = {
      content: 'Hello, world!',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };

    const result = transformer.toOpenAIResponse(providerResponse, 'gpt-4');

    expect(result.id).toMatch(/^chatcmpl-/);
    expect(result.object).toBe('chat.completion');
    expect(result.created).toBeTypeOf('number');
    expect(result.model).toBe('gpt-4');
    expect(Array.isArray(result.choices)).toBe(true);
    expect(result.choices).toHaveLength(1);
    expect(result.usage).toBeDefined();
  });

  // Test 2: toOpenAIResponse maps usage fields correctly
  it('toOpenAIResponse maps usage fields correctly', () => {
    const providerResponse: ProviderResponse = {
      content: 'test',
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    };

    const result = transformer.toOpenAIResponse(providerResponse, 'gpt-4');

    expect(result.usage.prompt_tokens).toBe(100);
    expect(result.usage.completion_tokens).toBe(50);
    expect(result.usage.total_tokens).toBe(150);
  });

  // Test 3: toOpenAIResponse preserves tool_calls
  it('toOpenAIResponse preserves tool_calls', () => {
    const providerResponse: ProviderResponse = {
      content: '',
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [
        {
          id: 'call_abc123',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
        },
      ],
    };

    const result = transformer.toOpenAIResponse(providerResponse, 'gpt-4');

    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls![0].id).toBe('call_abc123');
    expect(result.choices[0].message.tool_calls![0].function.name).toBe('get_weather');
    expect(result.choices[0].finish_reason).toBe('tool_calls');
  });

  // Test 4: toOpenAIResponse preserves function_call
  it('toOpenAIResponse preserves function_call', () => {
    const providerResponse: ProviderResponse = {
      content: '',
      finishReason: 'function_call',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      functionCall: { name: 'search', arguments: '{"query":"test"}' },
    };

    const result = transformer.toOpenAIResponse(providerResponse, 'gpt-4');

    expect(result.choices[0].message.function_call).toBeDefined();
    expect(result.choices[0].message.function_call!.name).toBe('search');
    expect(result.choices[0].finish_reason).toBe('function_call');
  });

  // Test 5: toOpenAIChunk produces valid chunk with consistent id
  it('toOpenAIChunk produces valid chunk with consistent streamId', () => {
    const chunk: ProviderStreamChunk = {
      content: 'Hello',
      finishReason: undefined,
    };
    const streamId = 'chatcmpl-stream-abc';

    const result = transformer.toOpenAIChunk(chunk, 'gpt-4', streamId);

    expect(result.id).toBe(streamId);
    expect(result.object).toBe('chat.completion.chunk');
    expect(result.model).toBe('gpt-4');
    expect(Array.isArray(result.choices)).toBe(true);
    expect(result.choices[0].delta.content).toBe('Hello');
    expect(result.choices[0].finish_reason).toBeNull();
  });

  // Test 6: toOpenAIError maps each error type
  it('toOpenAIError maps auth error type', () => {
    const error: ProviderError = {
      provider: 'openai',
      message: 'Invalid API key',
      type: 'auth',
      retryable: false,
    };
    const result = transformer.toOpenAIError(error);
    expect(result.error.type).toBe('authentication_error');
    expect(result.error.code).toBe('invalid_api_key');
    expect(result.error.message).toBe('Invalid API key');
  });

  it('toOpenAIError maps rate_limit error type', () => {
    const error: ProviderError = {
      provider: 'openai',
      message: 'Rate limit exceeded',
      type: 'rate_limit',
      retryable: true,
    };
    const result = transformer.toOpenAIError(error);
    expect(result.error.type).toBe('rate_limit_error');
    expect(result.error.code).toBe('rate_limit_exceeded');
  });

  it('toOpenAIError maps service_unavailable error type', () => {
    const error: ProviderError = {
      provider: 'openai',
      message: 'Service unavailable',
      type: 'service_unavailable',
      retryable: true,
    };
    const result = transformer.toOpenAIError(error);
    expect(result.error.type).toBe('server_error');
    expect(result.error.code).toBe('service_unavailable');
  });

  it('toOpenAIError maps invalid_request error type', () => {
    const error: ProviderError = {
      provider: 'openai',
      message: 'Invalid request',
      type: 'invalid_request',
      retryable: false,
    };
    const result = transformer.toOpenAIError(error);
    expect(result.error.type).toBe('invalid_request_error');
    expect(result.error.code).toBeNull();
  });

  it('toOpenAIError maps unknown error type', () => {
    const error: ProviderError = {
      provider: 'openai',
      message: 'Unknown error',
      type: 'unknown',
      retryable: false,
    };
    const result = transformer.toOpenAIError(error);
    expect(result.error.type).toBe('server_error');
    expect(result.error.code).toBeNull();
  });

  // Test 7: formatSSE produces correct SSE format
  it('formatSSE produces correct SSE format', () => {
    const chunk = transformer.toOpenAIChunk({ content: 'hi' }, 'gpt-4', 'chatcmpl-123');
    const sse = transformer.formatSSE(chunk);
    expect(sse).toMatch(/^data: \{.*\}\n\n$/);
    const jsonPart = sse.slice('data: '.length, -2);
    expect(() => JSON.parse(jsonPart)).not.toThrow();
  });

  // Test 8: formatSSEDone produces "data: [DONE]\n\n"
  it('formatSSEDone produces "data: [DONE]\\n\\n"', () => {
    expect(transformer.formatSSEDone()).toBe('data: [DONE]\n\n');
  });

  // Property test: toOpenAIResponse preserves content, finish reason, and usage totals
  it('property: toOpenAIResponse preserves content, model, usage, and object type', () => {
    fc.assert(
      fc.property(
        fc.record({
          content: fc.string(),
          finishReason: fc.constantFrom('stop', 'length', 'tool_calls', 'content_filter'),
          usage: fc.record({
            promptTokens: fc.nat({ max: 10000 }),
            completionTokens: fc.nat({ max: 10000 }),
            totalTokens: fc.nat({ max: 20000 }),
          }),
        }),
        fc.string({ minLength: 1 }),
        (providerResp, model) => {
          const result = transformer.toOpenAIResponse(providerResp as ProviderResponse, model);
          return (
            result.choices[0].message.content === providerResp.content &&
            result.usage.total_tokens === providerResp.usage.totalTokens &&
            result.model === model &&
            result.object === 'chat.completion'
          );
        }
      )
    );
  });

  // Property test: Every ProviderError.type maps to a valid OpenAIError
  it('property: every ProviderError.type maps to a valid OpenAIError', () => {
    fc.assert(
      fc.property(
        fc.record({
          provider: fc.string({ minLength: 1 }),
          statusCode: fc.option(fc.integer({ min: 400, max: 599 })),
          message: fc.string({ minLength: 1 }),
          type: fc.constantFrom('auth', 'rate_limit', 'service_unavailable', 'invalid_request', 'unknown'),
          retryable: fc.boolean(),
        }),
        (providerError) => {
          const result = transformer.toOpenAIError(providerError as ProviderError);
          return (
            typeof result.error.message === 'string' &&
            typeof result.error.type === 'string' &&
            result.error.type.length > 0
          );
        }
      )
    );
  });
});
