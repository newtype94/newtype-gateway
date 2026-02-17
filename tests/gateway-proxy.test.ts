import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import http from 'http';
import fc from 'fast-check';
import { GatewayProxy } from '../src/server/gateway-proxy.js';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../src/types/index.js';

// ============================================================================
// Mock Setup
// ============================================================================

const mockConfig = {
  gateway: { host: '127.0.0.1', port: 3000 },
  auth: { tokenStorePath: '/tmp/tokens.json', watchFiles: [] },
  modelAliases: [
    { alias: 'gpt-4', providers: [{ provider: 'openai', model: 'gpt-4', priority: 1 }] }
  ],
  rateLimits: [],
  providers: {}
};

const validRequest = {
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
};

const mockResponse: ChatCompletionResponse = {
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 1234567890,
  model: 'gpt-4',
  choices: [{
    index: 0,
    message: { role: 'assistant', content: 'Hello!' },
    finish_reason: 'stop',
  }],
  usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
};

async function* mockStreamGenerator(): AsyncGenerator<string> {
  yield 'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n';
  yield 'data: [DONE]\n\n';
}

function createMockRequestHandler(overrides?: Partial<{
  parseRequest: (body: unknown) => ChatCompletionRequest;
  handleCompletion: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
  handleCompletionStream: (req: ChatCompletionRequest) => AsyncGenerator<string>;
}>) {
  return {
    parseRequest: vi.fn((body: unknown) => {
      if (!body || typeof body !== 'object') throw new Error('Request body must be a JSON object');
      const obj = body as Record<string, unknown>;
      if (!obj.model || typeof obj.model !== 'string') throw new Error('model is required and must be a string');
      if (!Array.isArray(obj.messages) || obj.messages.length === 0) throw new Error('messages is required and must be a non-empty array');
      return obj as unknown as ChatCompletionRequest;
    }),
    handleCompletion: vi.fn(async (_req: ChatCompletionRequest) => mockResponse),
    handleCompletionStream: vi.fn((_req: ChatCompletionRequest) => mockStreamGenerator()),
    ...overrides,
  };
}

/**
 * Helper: make a raw HTTP POST to an Express app and collect the full response body.
 * Works reliably with SSE / chunked transfer encoding (unlike supertest).
 */
function rawPost(app: ReturnType<GatewayProxy['getApp']>, path: string, body: unknown): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const payload = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode!, headers: res.headers, body: data });
        });
        res.on('error', (err) => { server.close(); reject(err); });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.write(payload);
      req.end();
    });
  });
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('GatewayProxy', () => {
  let mockHandler: ReturnType<typeof createMockRequestHandler>;
  let gateway: GatewayProxy;

  beforeEach(() => {
    mockHandler = createMockRequestHandler();
    gateway = new GatewayProxy(mockHandler as never, mockConfig);
  });

  it('1. GET /health returns { status: "ok" }', async () => {
    const res = await request(gateway.getApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('2. GET /v1/models returns configured models', async () => {
    const res = await request(gateway.getApp()).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('gpt-4');
    expect(res.body.data[0].object).toBe('model');
    expect(res.body.data[0].owned_by).toBe('llm-gateway');
  });

  it('3. POST /v1/chat/completions with valid non-streaming request returns 200', async () => {
    const res = await request(gateway.getApp())
      .post('/v1/chat/completions')
      .send(validRequest);
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('chat.completion');
    expect(res.body.id).toBe('chatcmpl-test');
    expect(mockHandler.handleCompletion).toHaveBeenCalledOnce();
  });

  it('4. POST /v1/chat/completions with streaming returns SSE response', async () => {
    const streamRequest = { ...validRequest, stream: true };
    const res = await rawPost(gateway.getApp(), '/v1/chat/completions', streamRequest);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.body).toContain('data:');
    expect(res.body).toContain('[DONE]');
  }, 10000);

  it('5. POST /v1/chat/completions with invalid body returns 400', async () => {
    const res = await request(gateway.getApp())
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'Hello' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.type).toBe('invalid_request_error');
  });

  it('6. 404 for unknown routes', async () => {
    const res = await request(gateway.getApp()).get('/unknown/route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toBe('Not found');
    expect(res.body.error.type).toBe('invalid_request_error');
  });

  it('7. start() rejects non-localhost host (e.g., 0.0.0.0)', async () => {
    const insecureConfig = { ...mockConfig, gateway: { host: '0.0.0.0', port: 3999 } };
    const insecureGateway = new GatewayProxy(mockHandler as never, insecureConfig);
    await expect(insecureGateway.start()).rejects.toThrow('Security: host must be localhost');
  });

  it('8. Error handler returns OpenAI error format on provider error', async () => {
    const providerError = {
      provider: 'openai',
      message: 'API key is invalid',
      type: 'auth' as const,
      retryable: false,
    };
    mockHandler.handleCompletion = vi.fn(async () => { throw providerError; });
    const errorGateway = new GatewayProxy(mockHandler as never, mockConfig);

    const res = await request(errorGateway.getApp())
      .post('/v1/chat/completions')
      .send(validRequest);
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.type).toBe('authentication_error');
    expect(res.body.error.code).toBe('invalid_api_key');
    expect(res.body.error.message).toBe('API key is invalid');
  });

  // ============================================================================
  // Property Tests (P18-P23)
  // ============================================================================

  /**
   * Feature: llm-gateway, Property 18: All valid requests get response with correct Content-Type
   * Tests both streaming (via rawPost) and non-streaming (via supertest).
   */
  it('P18: All valid requests get response with correct Content-Type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        async (streaming) => {
          const handler = createMockRequestHandler({
            handleCompletionStream: vi.fn((_req: ChatCompletionRequest) => mockStreamGenerator()),
          });
          const g = new GatewayProxy(handler as never, mockConfig);
          const body = { ...validRequest, stream: streaming };
          if (streaming) {
            const res = await rawPost(g.getApp(), '/v1/chat/completions', body);
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/event-stream/);
          } else {
            const res = await request(g.getApp())
              .post('/v1/chat/completions')
              .send(body);
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/application\/json/);
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 15000);

  /**
   * Feature: llm-gateway, Property 19: All error responses match OpenAI error schema
   */
  it('P19: All error responses match OpenAI error schema', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('auth', 'rate_limit', 'service_unavailable', 'invalid_request', 'unknown'),
        async (errorType) => {
          const providerError = {
            provider: 'openai',
            message: `Error of type ${errorType}`,
            type: errorType as 'auth' | 'rate_limit' | 'service_unavailable' | 'invalid_request' | 'unknown',
            retryable: false,
          };
          const handler = createMockRequestHandler({
            handleCompletion: vi.fn(async () => { throw providerError; }),
          });
          const g = new GatewayProxy(handler as never, mockConfig);
          const res = await request(g.getApp())
            .post('/v1/chat/completions')
            .send(validRequest);
          expect(res.body.error).toBeDefined();
          expect(typeof res.body.error.message).toBe('string');
          expect(typeof res.body.error.type).toBe('string');
        }
      ),
      { numRuns: 5 }
    );
  });

  /**
   * Feature: llm-gateway, Property 20: Health endpoint always returns 200 with status ok
   */
  it('P20: Health endpoint always returns 200 with status ok', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (_n) => {
          const res = await request(gateway.getApp()).get('/health');
          expect(res.status).toBe(200);
          expect(res.body).toEqual({ status: 'ok' });
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: llm-gateway, Property 21: Unknown routes always return 404
   */
  it('P21: Unknown routes always return 404', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^\/[a-z]{3,10}(\/[a-z]{3,10})?$/),
        async (path) => {
          if (['/health', '/v1/models', '/v1/chat', '/dashboard', '/api'].some(known => path.startsWith(known))) return;
          const res = await request(gateway.getApp()).get(path);
          expect(res.status).toBe(404);
          expect(res.body.error).toBeDefined();
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Feature: llm-gateway, Property 22: Request ID header is always present in responses
   */
  it('P22: Request ID header is always present in responses', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('/health', '/v1/models', '/unknown-path-xyz'),
        async (path) => {
          const res = await request(gateway.getApp()).get(path);
          expect(res.headers['x-request-id']).toBeDefined();
          expect(typeof res.headers['x-request-id']).toBe('string');
          expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: llm-gateway, Property 23: Localhost validation rejects all non-localhost hosts
   */
  it('P23: Localhost validation rejects all non-localhost hosts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.ipV4(),
          fc.domain(),
        ).filter(host => !['localhost', '127.0.0.1', '::1'].includes(host)),
        async (host) => {
          const cfg = { ...mockConfig, gateway: { host, port: 3999 } };
          const g = new GatewayProxy(mockHandler as never, cfg);
          await expect(g.start()).rejects.toThrow('Security: host must be localhost');
        }
      ),
      { numRuns: 20 }
    );
  });
});
