import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock chokidar before any imports that use it
vi.mock('chokidar', () => ({
  watch: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock axios to prevent real HTTP calls
vi.mock('axios');

import { startGateway } from '../src/index.js';
import { Router } from '../src/router/router.js';
import { RateLimiter } from '../src/rate-limiter/rate-limiter.js';
import { ResponseTransformer } from '../src/transformer/response-transformer.js';
import { RequestHandler } from '../src/handler/request-handler.js';
import type {
  Configuration,
  ProviderResponse,
  ProviderStreamChunk,
  ProviderError,
} from '../src/types/index.js';

// ============================================================================
// Helpers
// ============================================================================

function makeTempDir(): string {
  const dir = join(tmpdir(), `llm-gateway-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir: string, config: object): string {
  const configPath = join(dir, 'config.yaml');
  const yaml = configToYaml(config);
  writeFileSync(configPath, yaml, 'utf-8');
  return configPath;
}

/** Escape a string value for YAML (single-quoted, forward slashes for paths) */
function yamlStr(s: string): string {
  // Use forward slashes to avoid YAML backslash escape issues on Windows
  return `'${s.replace(/\\/g, '/').replace(/'/g, "''")}'`;
}

/** Minimal YAML serialiser sufficient for our config shape */
function configToYaml(obj: object, indent = 0): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${pad}${key}: null`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${pad}${key}: ${value}`);
    } else if (typeof value === 'string') {
      lines.push(`${pad}${key}: ${yamlStr(value)}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            const itemLines = configToYaml(item, indent + 4).split('\n');
            lines.push(`${pad}  -`);
            for (const il of itemLines) {
              if (il.trim()) lines.push(`  ${il}`);
            }
          } else {
            lines.push(`${pad}  - ${item}`);
          }
        }
      }
    } else if (typeof value === 'object') {
      lines.push(`${pad}${key}:`);
      lines.push(configToYaml(value as object, indent + 2));
    }
  }
  return lines.join('\n');
}

function makeMinimalConfig(dir: string, overrides: Partial<Configuration> = {}): Configuration {
  return {
    gateway: { host: '127.0.0.1', port: 0 },
    auth: {
      tokenStorePath: join(dir, 'tokens.json'),
      watchFiles: [],
    },
    modelAliases: [
      {
        alias: 'gpt-4',
        providers: [{ provider: 'openai', model: 'gpt-4', priority: 1 }],
      },
    ],
    rateLimits: [
      { provider: 'openai', requestsPerMinute: 60, maxQueueSize: 10 },
    ],
    providers: {
      openai: {
        enabled: true,
        apiEndpoint: 'https://api.openai.com',
      },
    },
    ...overrides,
  };
}

// ============================================================================
// Mock factories (same pattern as request-handler.test.ts)
// ============================================================================

function makeToken(provider = 'openai') {
  return { accessToken: 'tok-test', provider, expiresAt: Date.now() + 3600000 };
}

function makeAuthManager(overrides: Record<string, unknown> = {}) {
  return {
    getValidToken: vi.fn().mockResolvedValue(makeToken()),
    startFileWatcher: vi.fn(),
    stopFileWatcher: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeProviderResponse(): ProviderResponse {
  return {
    content: 'Hello from mock provider',
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
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
    chatCompletionStream: vi.fn().mockReturnValue(
      asyncChunks([{ content: 'Hello', finishReason: undefined }, { content: ' world', finishReason: 'stop' }])
    ),
    ...overrides,
  };
}

function makeRouter(overrides: Record<string, unknown> = {}) {
  return {
    resolveModelAlias: vi.fn().mockReturnValue([{ provider: 'openai', model: 'gpt-4', priority: 1 }]),
    selectProvider: vi.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4', priority: 1 }),
    getNextProvider: vi.fn().mockReturnValue(null),
    markFailed: vi.fn(),
    clearExpiredFailures: vi.fn(),
    isProviderFailed: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

function makeValidRequest() {
  return {
    model: 'gpt-4',
    messages: [{ role: 'user' as const, content: 'Hello' }],
  };
}

// ============================================================================
// Test: startGateway integration (Tests 1-4)
// ============================================================================

describe('startGateway', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(async () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('1. creates all components and starts successfully with valid config', async () => {
    const config = makeMinimalConfig(tempDir);
    configPath = writeConfig(tempDir, config);

    const { gateway, cleanup } = await startGateway(configPath);

    expect(gateway).toBeDefined();
    expect(typeof cleanup).toBe('function');

    await cleanup();
  });

  it('2. cleanup stops server, file watcher, and rate limiter', async () => {
    const config = makeMinimalConfig(tempDir);
    configPath = writeConfig(tempDir, config);

    const { gateway, cleanup } = await startGateway(configPath);

    // Should not throw
    await expect(cleanup()).resolves.toBeUndefined();
  });

  it('3. throws descriptive error on invalid/missing config file', async () => {
    await expect(startGateway('/nonexistent/path/config.yaml')).rejects.toThrow(
      'Failed to load configuration'
    );
  });

  it('4. throws when no providers are enabled', async () => {
    const config = makeMinimalConfig(tempDir, {
      providers: {
        openai: { enabled: false, apiEndpoint: 'https://api.openai.com' },
      },
    });
    configPath = writeConfig(tempDir, config);

    await expect(startGateway(configPath)).rejects.toThrow(
      'No enabled providers configured'
    );
  });
});

// ============================================================================
// Test: RequestHandler + ResponseTransformer + Router integration (Tests 5-8)
// ============================================================================

describe('RequestHandler integration with real Router, RateLimiter, ResponseTransformer', () => {
  const minimalConfig: Configuration = {
    gateway: { host: '127.0.0.1', port: 0 },
    auth: { tokenStorePath: '/tmp/tokens.json', watchFiles: [] },
    modelAliases: [
      {
        alias: 'gpt-4',
        providers: [
          { provider: 'openai', model: 'gpt-4', priority: 1 },
          { provider: 'gemini', model: 'gemini-pro', priority: 2 },
        ],
      },
    ],
    rateLimits: [
      { provider: 'openai', requestsPerMinute: 60, maxQueueSize: 10 },
      { provider: 'gemini', requestsPerMinute: 60, maxQueueSize: 10 },
    ],
    providers: {
      openai: { enabled: true, apiEndpoint: 'https://api.openai.com' },
      gemini: { enabled: true, apiEndpoint: 'https://generativelanguage.googleapis.com' },
    },
  };

  function makeHandler(providerMap: Map<string, ReturnType<typeof makeProvider>>, authOverrides = {}) {
    const router = new Router(minimalConfig);
    const rateLimiter = new RateLimiter(minimalConfig.rateLimits);
    const transformer = new ResponseTransformer();
    const authManager = makeAuthManager(authOverrides) as any;
    const handler = new RequestHandler(
      router,
      rateLimiter,
      providerMap as any,
      transformer,
      authManager,
      3
    );
    return { handler, rateLimiter };
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('5. end-to-end non-streaming: mock provider response is transformed to OpenAI format', async () => {
    const provider = makeProvider();
    const { handler, rateLimiter } = makeHandler(new Map([['openai', provider]]));

    const result = await handler.handleCompletion(makeValidRequest());

    expect(provider.chatCompletion).toHaveBeenCalledOnce();
    expect(result.object).toBe('chat.completion');
    expect(result.model).toBe('gpt-4');
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe('assistant');
    expect(result.choices[0].message.content).toBe('Hello from mock provider');
    expect(result.usage.total_tokens).toBe(15);

    rateLimiter.dispose();
  });

  it('6. end-to-end streaming: mock SSE chunks are yielded and end with [DONE]', async () => {
    const provider = makeProvider();
    const { handler, rateLimiter } = makeHandler(new Map([['openai', provider]]));

    const chunks: string[] = [];
    for await (const chunk of handler.handleCompletionStream(makeValidRequest())) {
      chunks.push(chunk);
    }

    expect(provider.chatCompletionStream).toHaveBeenCalledOnce();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[chunks.length - 1]).toBe('data: [DONE]\n\n');
    // All non-final chunks are valid SSE data lines
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk).toMatch(/^data: \{/);
      const parsed = JSON.parse(chunk.slice(6));
      expect(parsed.object).toBe('chat.completion.chunk');
    }

    rateLimiter.dispose();
  });

  it('7. fallback: provider A (openai) fails with retryable error -> provider B (gemini) succeeds', async () => {
    const retryableError: ProviderError = {
      provider: 'openai',
      message: 'Service unavailable',
      type: 'service_unavailable',
      retryable: true,
    };
    const openaiProvider = makeProvider({
      chatCompletion: vi.fn().mockRejectedValue(retryableError),
    });
    const geminiProvider = makeProvider({
      chatCompletion: vi.fn().mockResolvedValue({
        content: 'Response from gemini',
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      } as ProviderResponse),
    });
    const providerMap = new Map([
      ['openai', openaiProvider],
      ['gemini', geminiProvider],
    ]);

    const { handler, rateLimiter } = makeHandler(providerMap);
    const result = await handler.handleCompletion(makeValidRequest());

    expect(openaiProvider.chatCompletion).toHaveBeenCalledOnce();
    expect(geminiProvider.chatCompletion).toHaveBeenCalledOnce();
    // Result comes from gemini (transformer uses the response content)
    expect(result.choices[0].message.content).toBe('Response from gemini');

    rateLimiter.dispose();
  });

  it('8. all providers fail -> throws error with details', async () => {
    const retryableError: ProviderError = {
      provider: 'openai',
      message: 'All down',
      type: 'service_unavailable',
      retryable: true,
    };
    const openaiProvider = makeProvider({
      chatCompletion: vi.fn().mockRejectedValue(retryableError),
    });
    const geminiProvider = makeProvider({
      chatCompletion: vi.fn().mockRejectedValue({
        provider: 'gemini',
        message: 'Also down',
        type: 'service_unavailable',
        retryable: true,
      } as ProviderError),
    });
    const providerMap = new Map([
      ['openai', openaiProvider],
      ['gemini', geminiProvider],
    ]);

    const { handler, rateLimiter } = makeHandler(providerMap);

    await expect(handler.handleCompletion(makeValidRequest())).rejects.toMatchObject({
      type: 'service_unavailable',
    });

    rateLimiter.dispose();
  });
});
