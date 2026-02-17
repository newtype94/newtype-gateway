import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock axios before importing providers
vi.mock('axios', () => {
  const mockAxiosInstance = {
    post: vi.fn(),
  };
  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
    },
  };
});

// Mock logger
vi.mock('../src/config/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import axios from 'axios';
import { OpenAIProvider } from '../src/providers/openai-provider.js';
import { GeminiProvider } from '../src/providers/gemini-provider.js';
import { BaseProvider } from '../src/providers/base-provider.js';
import { UserAgentPool } from '../src/providers/user-agent-pool.js';
import type { ProviderRequest } from '../src/types/index.js';

// Helper to get the mocked axios instance
function getMockClient() {
  return (axios.create as any).mock.results.at(-1)?.value ?? (axios.create as any)();
}

// Async generator helper for streaming tests
async function* makeAsyncIterable(chunks: string[]) {
  for (const chunk of chunks) {
    yield Buffer.from(chunk);
  }
}

const baseRequest: ProviderRequest = {
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: false,
  accessToken: 'test-token-123',
};

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockClient: { post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider('https://api.openai.com');
    mockClient = getMockClient();
  });

  it('Test 1: chatCompletion sends correct request format and parses response', async () => {
    const mockResponse = {
      data: {
        choices: [{
          message: { content: 'Hello there!', role: 'assistant' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    };
    mockClient.post.mockResolvedValueOnce(mockResponse);

    const result = await provider.chatCompletion(baseRequest);

    expect(mockClient.post).toHaveBeenCalledWith(
      '/v1/chat/completions',
      expect.objectContaining({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.content).toBe('Hello there!');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it('Test 2: chatCompletionStream parses SSE chunks correctly', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ];
    mockClient.post.mockResolvedValueOnce({ data: makeAsyncIterable(sseData) });

    const chunks: any[] = [];
    for await (const chunk of provider.chatCompletionStream({ ...baseRequest, stream: true })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].content).toBe(' world');
  });

  it('Test 3: chatCompletion handles tool_calls in response', async () => {
    const mockToolCalls = [{
      id: 'call_abc123',
      type: 'function',
      function: { name: 'get_weather', arguments: '{"city":"London"}' },
    }];
    mockClient.post.mockResolvedValueOnce({
      data: {
        choices: [{
          message: { content: null, tool_calls: mockToolCalls },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      },
    });

    const result = await provider.chatCompletion(baseRequest);

    expect(result.toolCalls).toEqual(mockToolCalls);
    expect(result.finishReason).toBe('tool_calls');
  });
});

describe('GeminiProvider', () => {
  let provider: GeminiProvider;
  let mockClient: { post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GeminiProvider('https://generativelanguage.googleapis.com');
    mockClient = getMockClient();
  });

  it('Test 4: chatCompletion converts messages to Gemini format', async () => {
    mockClient.post.mockResolvedValueOnce({
      data: {
        candidates: [{
          content: { role: 'model', parts: [{ text: 'Hi!' }] },
          finishReason: 'STOP',
          index: 0,
        }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
      },
    });

    const result = await provider.chatCompletion(baseRequest);

    expect(mockClient.post).toHaveBeenCalledWith(
      expect.stringContaining('/v1beta/models/gpt-4:generateContent'),
      expect.objectContaining({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      }),
      expect.any(Object)
    );
    expect(result.content).toBe('Hi!');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 3, totalTokens: 8 });
  });

  it('Test 5: convertTools converts Tool[] to GeminiTool[]', () => {
    const tools = [{
      type: 'function' as const,
      function: {
        name: 'get_weather',
        description: 'Get the weather',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    }];

    const result = provider.convertTools(tools);

    expect(result).toHaveLength(1);
    expect(result[0].functionDeclarations).toHaveLength(1);
    expect(result[0].functionDeclarations[0].name).toBe('get_weather');
    expect(result[0].functionDeclarations[0].description).toBe('Get the weather');
  });

  it('Test 6: chatCompletionStream parses Gemini SSE stream', async () => {
    const sseData = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"finishReason":null,"index":0}]}\n',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]},"finishReason":"STOP","index":0}]}\n',
    ];
    mockClient.post.mockResolvedValueOnce({ data: makeAsyncIterable(sseData) });

    const chunks: any[] = [];
    for await (const chunk of provider.chatCompletionStream({ ...baseRequest, stream: true })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].content).toBe(' world');
    expect(chunks[1].finishReason).toBe('stop');
  });

  it('Test 7: toGeminiRequest maps system messages correctly (prepends to first user msg)', () => {
    const request: ProviderRequest = {
      ...baseRequest,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is 2+2?' },
      ],
    };

    const result = provider.toGeminiRequest(request);

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].role).toBe('user');
    expect(result.contents[0].parts[0].text).toContain('[System]');
    expect(result.contents[0].parts[0].text).toContain('You are a helpful assistant.');
    expect(result.contents[0].parts[0].text).toContain('What is 2+2?');
  });
});

describe('BaseProvider.normalizeError', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider('https://api.openai.com');
  });

  it('Test 8: classifies HTTP status codes correctly', () => {
    const makeAxiosError = (status: number, message = 'error') => ({
      response: { status, data: { error: { message } } },
      message,
    });

    // Access normalizeError via casting (it's protected but we need to test it)
    const normalizeError = (provider as any).normalizeError.bind(provider);

    const authError401 = normalizeError(makeAxiosError(401, 'Unauthorized'));
    expect(authError401.type).toBe('auth');
    expect(authError401.retryable).toBe(false);

    const authError403 = normalizeError(makeAxiosError(403, 'Forbidden'));
    expect(authError403.type).toBe('auth');
    expect(authError403.retryable).toBe(false);

    const rateLimitError = normalizeError(makeAxiosError(429, 'Too many requests'));
    expect(rateLimitError.type).toBe('rate_limit');
    expect(rateLimitError.retryable).toBe(true);

    const serverError500 = normalizeError(makeAxiosError(500, 'Internal Server Error'));
    expect(serverError500.type).toBe('service_unavailable');
    expect(serverError500.retryable).toBe(true);

    const badRequestError = normalizeError(makeAxiosError(400, 'Bad Request'));
    expect(badRequestError.type).toBe('invalid_request');
    expect(badRequestError.retryable).toBe(false);

    expect(authError401.statusCode).toBe(401);
    expect(authError401.provider).toBe('openai');
  });

  it('Test 9: buildHeaders includes required headers (Authorization, Content-Type, User-Agent)', () => {
    const headers = provider.buildHeaders('my-secret-token');

    expect(headers['Authorization']).toBe('Bearer my-secret-token');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toBeDefined();
    expect(typeof headers['User-Agent']).toBe('string');
    expect(headers['User-Agent'].length).toBeGreaterThan(0);
  });
});

describe('Property Tests', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider('https://api.openai.com');
  });

  it('Property 16: For any valid access token, buildHeaders always includes Authorization and Content-Type', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (token) => {
          const headers = provider.buildHeaders(token);
          expect(headers['Authorization']).toBe(`Bearer ${token}`);
          expect(headers['Content-Type']).toBe('application/json');
          expect(headers['User-Agent']).toBeDefined();
        }
      )
    );
  });

  it('Property 17: Headers User-Agent varies across multiple calls (round-robin)', () => {
    const pool = new UserAgentPool();
    const agents = new Set<string>();

    // Collect agents over multiple calls
    for (let i = 0; i < 8; i++) {
      agents.add(pool.getNext());
    }

    // Should have seen more than 1 unique agent (round-robin across 4 agents)
    expect(agents.size).toBeGreaterThan(1);

    // Property: cycling through 4 agents, after 4 calls we see all of them
    const pool2 = new UserAgentPool();
    const first4 = Array.from({ length: 4 }, () => pool2.getNext());
    const second4 = Array.from({ length: 4 }, () => pool2.getNext());
    // Round-robin: second 4 should equal first 4
    expect(second4).toEqual(first4);
  });
});
