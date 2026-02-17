import express from 'express';
import type { Configuration, TokenStore, TokenSet } from '../types/index.js';
import { AuthManager } from '../auth/auth-manager.js';
import { RateLimiter } from '../rate-limiter/rate-limiter.js';
import { UsageTracker } from './usage-tracker.js';

export interface DashboardDeps {
  config: Configuration;
  tokenStore: TokenStore;
  rateLimiter: RateLimiter;
  usageTracker: UsageTracker;
  authManager: AuthManager;
  startTime: number;
}

export function createDashboardRoutes(deps: DashboardDeps): express.Router {
  const router = express.Router();

  // GET /status
  router.get('/status', (_req, res) => {
    try {
      const uptime = Math.floor((Date.now() - deps.startTime) / 1000);

      const providers: Record<string, { enabled: boolean; rateLimitStatus: ReturnType<RateLimiter['getStatus']> }> = {};
      for (const [name, providerConfig] of Object.entries(deps.config.providers)) {
        providers[name] = {
          enabled: providerConfig.enabled,
          rateLimitStatus: deps.rateLimiter.getStatus(name),
        };
      }

      res.json({ status: 'ok', uptime, providers });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /tokens
  router.get('/tokens', async (_req, res) => {
    try {
      const allTokens: Map<string, TokenSet> = await deps.tokenStore.getAllTokens();

      const result = await Promise.all(
        Object.keys(deps.config.providers).map(async (provider) => {
          const token = allTokens.get(provider);
          if (!token) {
            return {
              provider,
              hasToken: false,
              isExpired: null,
              expiresAt: null,
              accessTokenPreview: null,
              hasRefreshToken: false,
            };
          }

          const isExpired = await deps.tokenStore.isTokenExpired(provider);
          const accessTokenPreview = '...' + token.accessToken.slice(-8);

          return {
            provider,
            hasToken: true,
            isExpired,
            expiresAt: token.expiresAt,
            accessTokenPreview,
            hasRefreshToken: !!token.refreshToken,
          };
        })
      );

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /usage
  router.get('/usage', (_req, res) => {
    try {
      res.json(deps.usageTracker.getStats());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /models
  router.get('/models', (_req, res) => {
    try {
      const models = deps.config.modelAliases.map((modelAlias) => ({
        alias: modelAlias.alias,
        providers: [...modelAlias.providers].sort((a, b) => a.priority - b.priority),
      }));

      res.json(models);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /tokens/:provider/device-flow
  router.post('/tokens/:provider/device-flow', async (req, res) => {
    try {
      const deviceFlowInfo = await deps.authManager.initiateDeviceFlow(req.params.provider);
      res.json(deviceFlowInfo);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /tokens/:provider/device-flow/complete
  router.post('/tokens/:provider/device-flow/complete', async (req, res) => {
    try {
      const { deviceCode } = req.body as { deviceCode: string };
      await deps.authManager.completeDeviceFlow(req.params.provider, deviceCode);
      res.json({ success: true, provider: req.params.provider });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /tokens/:provider/refresh
  router.post('/tokens/:provider/refresh', async (req, res) => {
    try {
      await deps.authManager.refreshToken(req.params.provider);
      res.json({ success: true, provider: req.params.provider });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /tokens/:provider
  router.post('/tokens/:provider', async (req, res) => {
    try {
      const body = req.body as { accessToken: string; expiresIn?: number };
      const provider = req.params.provider;
      const tokenSet: TokenSet = {
        accessToken: body.accessToken,
        expiresAt: Date.now() + (body.expiresIn || 3600) * 1000,
        provider,
      };
      await deps.tokenStore.saveToken(provider, tokenSet);
      res.json({ success: true, provider });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
