import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { RequestHandler } from '../src/handler/request-handler.js';
import type {
  ChatCompletionRequest,
  ProviderResponse,
  ProviderStreamChunk,
  ProviderError,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../src/types/index.js';

// ============================================================================
// Mock factories
// ============================================================================

function makeRouter(overrides: Record<string, unknown> = {}) {
  return {
    resolveModelAlias: vi.fn().mockReturnValue([{ provider: 'openai', model: 'gpt-4', priority: 1 }]),
    selectProvider: vi.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4', priority: 1 }),
    getNextProvider: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function makeRateLimiter(overrides: Record<string, unknown> = {}) {
  return {
    acquire: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeToken() {
  return { accessToken: 'tok-test', provider: 'openai', expiresAt: Date.now() + 3600000 };
}

function makeAuthManager(overrides: Record<string, unknown> = {}) {
  return {
    getValidToken: vi.fn().mockResolvedValue(makeToken()),
    ...overrides,
  };
}

function makeProviderResponse(): ProviderResponse {
  return {
    content: 'Hello world',
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

function makeOpenAIResponse(model: string): ChatCompletionResponse {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hello world' }, finish_reason: 'stop', logprobs: null }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function makeOpenAIChunk(model: string, id: string): ChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null, logprobs: null }],
  };
}

function makeTransformer(model = 'gpt-4', overrides: Record<string, unknown> = {}) {
  const streamId = 'chatcmpl-stream-test';
  return {
    toOpenAIResponse: vi.fn().mockReturnValue(makeOpenAIResponse(model)),
    toOpenAIChunk: vi.fn().mockReturnValue(makeOpenAIChunk(model, streamId)),
    generateCompletionId: vi.fn().mockReturnValue(streamId),
    formatSSE: vi.fn().mockImplementation((chunk: ChatCompletionChunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    formatSSEDone: vi.fn().mockReturnValue('data: [DONE]\n\n'),
    ...overrides,
  };
}

async function* asyncChunks(chunks: ProviderStreamChunk[]): AsyncIterable<ProviderStreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    chatCompletion: vi.fn().mockResolvedValue(makeProviderResponse()),
    chatCompletionStream: vi.fn().mockReturnValue(asyncChunks([{ content: 'Hi', finishReason: 'stop' }])),
    ...overrides,
  };
}

function makeHandlerAndDeps(routerOverrides = {}, rateLimiterOverrides = {}, authOverrides = {}, transformerOverrides = {}, providerOverrides = {}) {
  const router = makeRouter(routerOverrides) as any;
  const rateLimiter = makeRateLimiter(rateLimiterOverrides) as any;
  const authManager = makeAuthManager(authOverrides) as any;
  const transformer = makeTransformer('gpt-4', transformerOverrides) as any;
  const provider = makeProvider(providerOverrides);
  const providers = new Map([['openai', provider as any]]);
  const handler = new RequestHandler(router, rateLimiter, providers, transformer, authManager, 3);
  return { handler, router, rateLimiter, authManager, transformer, provider, providers };
}

function makeValidRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
  return {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('RequestHandler', () => {
  describe('parseRequest', () => {
    let handler: RequestHandler;

    beforeEach(() => {
      ({ handler } = makeHandlerAndDeps());
    });

    it('1. valid request parses correctly', () => {
      const body = { model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] };
      const result = handler.parseRequest(body);
      expect(result.model).toBe('gpt-4');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello');
    });

    it('2. throws on missing model', () => {
      expect(() => handler.parseRequest({ messages: [{ role: 'user', content: 'Hi' }] }))
        .toThrow('model is required and must be a string');
    });

    it('3. throws on empty messages', () => {
      expect(() => handler.parseRequest({ model: 'gpt-4', messages: [] }))
        .toThrow('messages is required and must be a non-empty array');
    });

    it('4. throws on invalid message (missing role)', () => {
      expect(() =>
        handler.parseRequest({ model: 'gpt-4', messages: [{ content: 'Hello' }] })
      ).toThrow('Each message must have a role');
    });
  });

  describe('handleCompletion', () => {
    it('5. successful completion through pipeline', async () => {
      const { handler, rateLimiter, authManager, provider, transformer } = makeHandlerAndDeps();
      const request = makeValidRequest();
      const result = await handler.handleCompletion(request);

      expect(rateLimiter.acquire).toHaveBeenCalledWith('openai');
      expect(authManager.getValidToken).toHaveBeenCalledWith('openai');
      expect(provider.chatCompletion).toHaveBeenCalled();
      expect(transformer.toOpenAIResponse).toHaveBeenCalled();
      expect(result.model).toBe('gpt-4');
      expect(result.object).toBe('chat.completion');
    });

    it('6. falls back on retryable error', async () => {
      const retryableError: ProviderError = {
        provider: 'openai',
        message: 'Service unavailable',
        type: 'service_unavailable',
        retryable: true,
      };
      const fallbackProvider = makeProvider();
      const providers = new Map([
        ['openai', makeProvider({ chatCompletion: vi.fn().mockRejectedValue(retryableError) }) as any],
        ['gemini', fallbackProvider as any],
      ]);
      const router = makeRouter({
        resolveModelAlias: vi.fn().mockReturnValue([
          { provider: 'openai', model: 'gpt-4', priority: 1 },
          { provider: 'gemini', model: 'gemini-pro', priority: 2 },
        ]),
        selectProvider: vi.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4', priority: 1 }),
        getNextProvider: vi.fn().mockReturnValue({ provider: 'gemini', model: 'gemini-pro', priority: 2 }),
      }) as any;
      const rateLimiter = makeRateLimiter() as any;
      const authManager = makeAuthManager() as any;
      const transformer = makeTransformer() as any;
      const handler = new RequestHandler(router, rateLimiter, providers, transformer, authManager, 3);

      await handler.handleCompletion(makeValidRequest());

      expect(router.getNextProvider).toHaveBeenCalledWith('gpt-4', 'openai');
      expect(fallbackProvider.chatCompletion).toHaveBeenCalled();
    });

    it('7. throws on non-retryable error', async () => {
      const nonRetryableError: ProviderError = {
        provider: 'openai',
        message: 'Invalid request',
        type: 'invalid_request',
        retryable: false,
      };
      const { handler, router } = makeHandlerAndDeps(
        {},
        {},
        {},
        {},
        { chatCompletion: vi.fn().mockRejectedValue(nonRetryableError) }
      );

      await expect(handler.handleCompletion(makeValidRequest())).rejects.toMatchObject({
        message: 'Invalid request',
        type: 'invalid_request',
      });
      expect(router.getNextProvider).not.toHaveBeenCalled();
    });

    it('8. exhausts all retries', async () => {
      const retryableError: ProviderError = {
        provider: 'openai',
        message: 'Service unavailable',
        type: 'service_unavailable',
        retryable: true,
      };
      // Return a second provider on first getNextProvider call, then null
      const secondProvider = makeProvider({
        chatCompletion: vi.fn().mockRejectedValue(retryableError),
      });
      const providers = new Map([
        ['openai', makeProvider({ chatCompletion: vi.fn().mockRejectedValue(retryableError) }) as any],
        ['gemini', secondProvider as any],
      ]);
      const router = makeRouter({
        resolveModelAlias: vi.fn().mockReturnValue([
          { provider: 'openai', model: 'gpt-4', priority: 1 },
          { provider: 'gemini', model: 'gemini-pro', priority: 2 },
        ]),
        selectProvider: vi.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4', priority: 1 }),
        getNextProvider: vi.fn()
          .mockReturnValueOnce({ provider: 'gemini', model: 'gemini-pro', priority: 2 })
          .mockReturnValueOnce(null),
      }) as any;
      const handler = new RequestHandler(
        router,
        makeRateLimiter() as any,
        providers,
        makeTransformer() as any,
        makeAuthManager() as any,
        3
      );

      await expect(handler.handleCompletion(makeValidRequest())).rejects.toMatchObject({
        type: 'service_unavailable',
      });
    });

    it('11. throws when no provider available', async () => {
      const { handler } = makeHandlerAndDeps({
        selectProvider: vi.fn().mockReturnValue(null),
      });

      await expect(handler.handleCompletion(makeValidRequest())).rejects.toMatchObject({
        message: 'No available provider',
        type: 'service_unavailable',
      });
    });
  });

  describe('handleCompletionStream', () => {
    it('9. yields SSE chunks and [DONE]', async () => {
      const { handler } = makeHandlerAndDeps();
      const request = makeValidRequest();
      const results: string[] = [];

      for await (const chunk of handler.handleCompletionStream(request)) {
        results.push(chunk);
      }

      expect(results.length).toBeGreaterThan(0);
      expect(results[results.length - 1]).toBe('data: [DONE]\n\n');
      // All non-final chunks should be SSE data lines
      for (const chunk of results.slice(0, -1)) {
        expect(chunk).toMatch(/^data: /);
      }
    });

    it('10. falls back on stream error', async () => {
      const retryableError: ProviderError = {
        provider: 'openai',
        message: 'Stream failed',
        type: 'service_unavailable',
        retryable: true,
      };

      async function* failingStream(): AsyncIterable<ProviderStreamChunk> {
        throw retryableError;
        yield { content: 'never' }; // unreachable, satisfies type
      }

      const failingProvider = makeProvider({ chatCompletionStream: vi.fn().mockReturnValue(failingStream()) });
      const successProvider = makeProvider();
      const providers = new Map([
        ['openai', failingProvider as any],
        ['gemini', successProvider as any],
      ]);
      const router = makeRouter({
        resolveModelAlias: vi.fn().mockReturnValue([
          { provider: 'openai', model: 'gpt-4', priority: 1 },
          { provider: 'gemini', model: 'gemini-pro', priority: 2 },
        ]),
        selectProvider: vi.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4', priority: 1 }),
        getNextProvider: vi.fn().mockReturnValue({ provider: 'gemini', model: 'gemini-pro', priority: 2 }),
      }) as any;
      const handler = new RequestHandler(
        router,
        makeRateLimiter() as any,
        providers,
        makeTransformer() as any,
        makeAuthManager() as any,
        3
      );

      const results: string[] = [];
      for await (const chunk of handler.handleCompletionStream(makeValidRequest())) {
        results.push(chunk);
      }

      expect(router.getNextProvider).toHaveBeenCalledWith('gpt-4', 'openai');
      expect(successProvider.chatCompletionStream).toHaveBeenCalled();
      expect(results[results.length - 1]).toBe('data: [DONE]\n\n');
    });
  });

  // ============================================================================
  // Property-Based Tests
  // ============================================================================

  describe('property-based tests', () => {
    /**
     * Feature: llm-gateway, Property 5:
     * parseRequest round-trip - parse(JSON.parse(JSON.stringify(req))) produces valid result
     */
    it('Property 5: parseRequest round-trip preserves model and messages', () => {
      fc.assert(
        fc.property(
          fc.record({
            model: fc.stringMatching(/^[a-z][a-z0-9-]{2,19}$/),
            messages: fc.array(
              fc.record({
                role: fc.constantFrom('user', 'assistant', 'system'),
                content: fc.string({ minLength: 1, maxLength: 100 }),
              }),
              { minLength: 1, maxLength: 5 }
            ),
          }),
          (req) => {
            const { handler } = makeHandlerAndDeps();
            const serialized = JSON.parse(JSON.stringify(req));
            const result = handler.parseRequest(serialized);
            expect(result.model).toBe(req.model);
            expect(result.messages).toHaveLength(req.messages.length);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Feature: llm-gateway, Property 6:
     * For all valid requests, if provider succeeds, response has correct model field
     */
    it('Property 6: if provider succeeds, response model matches requested model', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringMatching(/^[a-z][a-z0-9-]{2,19}$/),
          async (modelName) => {
            const transformer = makeTransformer(modelName) as any;
            transformer.toOpenAIResponse = vi.fn().mockReturnValue(makeOpenAIResponse(modelName));
            const router = makeRouter({
              resolveModelAlias: vi.fn().mockReturnValue([{ provider: 'openai', model: modelName, priority: 1 }]),
              selectProvider: vi.fn().mockReturnValue({ provider: 'openai', model: modelName, priority: 1 }),
              getNextProvider: vi.fn().mockReturnValue(null),
            }) as any;
            const handler = new RequestHandler(
              router,
              makeRateLimiter() as any,
              new Map([['openai', makeProvider() as any]]),
              transformer,
              makeAuthManager() as any,
              3
            );
            const result = await handler.handleCompletion({ model: modelName, messages: [{ role: 'user', content: 'Hi' }] });
            expect(result.model).toBe(modelName);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Feature: llm-gateway, Property 7:
     * For all retryable errors, handler attempts fallback before failing
     */
    it('Property 7: for retryable errors, getNextProvider is called before giving up', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('rate_limit', 'service_unavailable'),
          async (errorType) => {
            const retryableError: ProviderError = {
              provider: 'openai',
              message: 'Temporary failure',
              type: errorType as ProviderError['type'],
              retryable: true,
            };
            const getNextProvider = vi.fn().mockReturnValue(null);
            const router = makeRouter({
              resolveModelAlias: vi.fn().mockReturnValue([{ provider: 'openai', model: 'gpt-4', priority: 1 }]),
              selectProvider: vi.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4', priority: 1 }),
              getNextProvider,
            }) as any;
            const handler = new RequestHandler(
              router,
              makeRateLimiter() as any,
              new Map([['openai', makeProvider({ chatCompletion: vi.fn().mockRejectedValue(retryableError) }) as any]]),
              makeTransformer() as any,
              makeAuthManager() as any,
              3
            );

            try {
              await handler.handleCompletion(makeValidRequest());
            } catch {
              // Expected to fail after exhausting retries
            }

            expect(getNextProvider).toHaveBeenCalled();
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
