import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDashboardRoutes } from '../src/dashboard/dashboard-routes.js';
import { getDashboardHTML } from '../src/dashboard/dashboard-page.js';
import { UsageTracker } from '../src/dashboard/usage-tracker.js';
import type { DashboardDeps } from '../src/dashboard/dashboard-routes.js';
import type { TokenStore, TokenSet, Configuration } from '../src/types/index.js';

function createMockTokenStore(): TokenStore {
  const tokens = new Map<string, TokenSet>();
  return {
    saveToken: vi.fn(async (provider: string, tokenSet: TokenSet) => {
      tokens.set(provider, tokenSet);
    }),
    getToken: vi.fn(async (provider: string) => tokens.get(provider) || null),
    deleteToken: vi.fn(async (provider: string) => { tokens.delete(provider); }),
    getAllTokens: vi.fn(async () => new Map(tokens)),
    isTokenExpired: vi.fn(async (_provider: string) => false),
  };
}

function createMockConfig(): Configuration {
  return {
    gateway: { host: '127.0.0.1', port: 8080 },
    auth: { tokenStorePath: './tokens.json', watchFiles: [] },
    modelAliases: [
      {
        alias: 'best-model',
        providers: [
          { provider: 'openai', model: 'gpt-4', priority: 1 },
          { provider: 'gemini', model: 'gemini-pro', priority: 2 },
        ],
      },
    ],
    rateLimits: [
      { provider: 'openai', requestsPerMinute: 10, maxQueueSize: 50 },
    ],
    providers: {
      openai: { enabled: true, apiEndpoint: 'https://api.openai.com/v1' },
      gemini: { enabled: true, apiEndpoint: 'https://generativelanguage.googleapis.com/v1' },
    },
  };
}

function createMockRateLimiter() {
  return {
    getStatus: vi.fn(() => ({ requestsInWindow: 3, queueLength: 0, nextAvailableSlot: 0 })),
    acquire: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockAuthManager() {
  return {
    initiateDeviceFlow: vi.fn(async () => ({
      deviceCode: 'test-device-code',
      userCode: 'TEST-CODE',
      verificationUrl: 'https://example.com/verify',
      expiresIn: 600,
    })),
    completeDeviceFlow: vi.fn(async () => ({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresAt: Date.now() + 3600000,
      provider: 'openai',
    })),
    refreshToken: vi.fn(async () => ({
      accessToken: 'refreshed-token',
      refreshToken: 'refreshed-refresh',
      expiresAt: Date.now() + 3600000,
      provider: 'openai',
    })),
    getValidToken: vi.fn(),
    syncTokenFromFile: vi.fn(),
    startFileWatcher: vi.fn(),
    stopFileWatcher: vi.fn(),
  };
}

describe('Dashboard Routes', () => {
  let app: express.Application;
  let deps: DashboardDeps;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    deps = {
      config: createMockConfig(),
      tokenStore: createMockTokenStore(),
      rateLimiter: createMockRateLimiter() as any,
      usageTracker: new UsageTracker(),
      authManager: createMockAuthManager() as any,
      startTime: Date.now() - 60000, // started 1 minute ago
    };

    const router = createDashboardRoutes(deps);
    app.use('/api/dashboard', router);
  });

  describe('GET /api/dashboard/status', () => {
    it('should return gateway status with uptime and providers', async () => {
      const res = await request(app).get('/api/dashboard/status');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.uptime).toBeGreaterThan(0);
      expect(res.body.providers).toBeDefined();
      expect(res.body.providers.openai).toBeDefined();
      expect(res.body.providers.openai.enabled).toBe(true);
      expect(res.body.providers.openai.rateLimitStatus).toBeDefined();
    });
  });

  describe('GET /api/dashboard/tokens', () => {
    it('should return token status for all providers', async () => {
      const res = await request(app).get('/api/dashboard/tokens');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2); // openai + gemini

      const openai = res.body.find((t: any) => t.provider === 'openai');
      expect(openai).toBeDefined();
      expect(openai.hasToken).toBe(false);
    });

    it('should mask access tokens', async () => {
      await deps.tokenStore.saveToken('openai', {
        accessToken: 'super-secret-token-12345678',
        expiresAt: Date.now() + 3600000,
        provider: 'openai',
      });

      const res = await request(app).get('/api/dashboard/tokens');
      const openai = res.body.find((t: any) => t.provider === 'openai');
      expect(openai.hasToken).toBe(true);
      expect(openai.accessTokenPreview).toBe('...12345678');
      expect(openai.accessTokenPreview).not.toContain('super-secret');
    });
  });

  describe('GET /api/dashboard/usage', () => {
    it('should return usage stats', async () => {
      deps.usageTracker.recordUsage('openai', 'gpt-4', { promptTokens: 10, completionTokens: 20, totalTokens: 30 });

      const res = await request(app).get('/api/dashboard/usage');
      expect(res.status).toBe(200);
      expect(res.body.totalRequests).toBe(1);
      expect(res.body.totalTokens).toBe(30);
      expect(res.body.byProvider.openai).toBeDefined();
    });
  });

  describe('GET /api/dashboard/models', () => {
    it('should return model aliases sorted by priority', async () => {
      const res = await request(app).get('/api/dashboard/models');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].alias).toBe('best-model');
      expect(res.body[0].providers[0].priority).toBe(1);
      expect(res.body[0].providers[1].priority).toBe(2);
    });
  });

  describe('POST /api/dashboard/tokens/:provider/device-flow', () => {
    it('should initiate device flow', async () => {
      const res = await request(app).post('/api/dashboard/tokens/openai/device-flow');
      expect(res.status).toBe(200);
      expect(res.body.userCode).toBe('TEST-CODE');
      expect(res.body.verificationUrl).toBe('https://example.com/verify');
      expect(deps.authManager.initiateDeviceFlow).toHaveBeenCalledWith('openai');
    });
  });

  describe('POST /api/dashboard/tokens/:provider/refresh', () => {
    it('should refresh token', async () => {
      const res = await request(app).post('/api/dashboard/tokens/openai/refresh');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.authManager.refreshToken).toHaveBeenCalledWith('openai');
    });
  });

  describe('POST /api/dashboard/tokens/:provider (manual insert)', () => {
    it('should save manually inserted token', async () => {
      const res = await request(app)
        .post('/api/dashboard/tokens/openai')
        .send({ accessToken: 'my-manual-token', expiresIn: 7200 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.tokenStore.saveToken).toHaveBeenCalled();
    });
  });
});

describe('Dashboard HTML', () => {
  it('should return valid HTML', () => {
    const html = getDashboardHTML();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('LLM Gateway Dashboard');
    expect(html).toContain('/api/dashboard/status');
    expect(html).toContain('/api/dashboard/tokens');
    expect(html).toContain('/api/dashboard/usage');
    expect(html).toContain('/api/dashboard/models');
  });
});
