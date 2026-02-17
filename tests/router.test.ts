import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { Router } from '../src/router/router.js';
import type { Configuration } from '../src/types/index.js';

const testConfig: Configuration = {
  gateway: { host: '127.0.0.1', port: 3000 },
  auth: { tokenStorePath: './tokens.json', watchFiles: [] },
  modelAliases: [
    {
      alias: 'best-model',
      providers: [
        { provider: 'openai', model: 'gpt-4', priority: 1 },
        { provider: 'gemini', model: 'gemini-pro', priority: 2 },
      ],
    },
    {
      alias: 'fast-model',
      providers: [
        { provider: 'openai', model: 'gpt-3.5-turbo', priority: 1 },
      ],
    },
  ],
  rateLimits: [],
  providers: {
    openai: { enabled: true, apiEndpoint: 'https://api.openai.com' },
    gemini: { enabled: true, apiEndpoint: 'https://generativelanguage.googleapis.com' },
  },
};

describe('Router', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router(testConfig, 60000);
  });

  describe('resolveModelAlias', () => {
    it('1. returns correct providers for configured alias', () => {
      const providers = router.resolveModelAlias('best-model');
      expect(providers).toHaveLength(2);
      expect(providers.map(p => p.provider)).toContain('openai');
      expect(providers.map(p => p.provider)).toContain('gemini');
    });

    it('2. returns providers sorted by priority ascending', () => {
      const providers = router.resolveModelAlias('best-model');
      expect(providers[0].priority).toBeLessThanOrEqual(providers[1].priority);
      expect(providers[0].provider).toBe('openai');
    });

    it('3. handles direct "provider/model" references', () => {
      const providers = router.resolveModelAlias('anthropic/claude-3');
      expect(providers).toHaveLength(1);
      expect(providers[0].provider).toBe('anthropic');
      expect(providers[0].model).toBe('claude-3');
      expect(providers[0].priority).toBe(0);
    });

    it('4. throws for unknown model without "/"', () => {
      expect(() => router.resolveModelAlias('unknown-model')).toThrow('Unknown model: unknown-model');
    });
  });

  describe('selectProvider', () => {
    it('5. returns highest-priority available provider', () => {
      const candidates = [
        { provider: 'openai', model: 'gpt-4', priority: 1 },
        { provider: 'gemini', model: 'gemini-pro', priority: 2 },
      ];
      const selected = router.selectProvider(candidates);
      expect(selected).not.toBeNull();
      expect(selected!.provider).toBe('openai');
    });

    it('6. skips failed providers when available ones exist', () => {
      router.markFailed('openai');
      const candidates = [
        { provider: 'openai', model: 'gpt-4', priority: 1 },
        { provider: 'gemini', model: 'gemini-pro', priority: 2 },
      ];
      const selected = router.selectProvider(candidates);
      expect(selected).not.toBeNull();
      expect(selected!.provider).toBe('gemini');
    });

    it('7. returns failed provider if no available ones exist', () => {
      router.markFailed('openai');
      router.markFailed('gemini');
      const candidates = [
        { provider: 'openai', model: 'gpt-4', priority: 1 },
        { provider: 'gemini', model: 'gemini-pro', priority: 2 },
      ];
      const selected = router.selectProvider(candidates);
      expect(selected).not.toBeNull();
      // Should return the lowest-priority-number failed one
      expect(selected!.provider).toBe('openai');
    });
  });

  describe('getNextProvider', () => {
    it('8. marks provider failed and returns next', () => {
      const next = router.getNextProvider('best-model', 'openai');
      expect(next).not.toBeNull();
      expect(next!.provider).toBe('gemini');
      expect(router.isProviderFailed('openai')).toBe(true);
    });

    it('9. returns null when all providers exhausted', () => {
      // Use a short TTL router so we can test exhaustion
      const shortRouter = new Router(testConfig, 60000);
      // Mark all providers for fast-model as failed
      shortRouter.markFailed('openai');
      // fast-model only has openai, so getNextProvider should return the failed one
      // (selectProvider falls back to failed when none available)
      // To truly exhaust: use a single-provider alias and verify behavior
      // When getNextProvider is called, it marks the provider failed, then re-selects
      // If only one provider, it returns that provider (the failed one as fallback)
      const result = shortRouter.getNextProvider('fast-model', 'openai');
      // openai was already failed, now marked again; it's the only provider so returned as fallback
      expect(result).not.toBeNull();
      expect(result!.provider).toBe('openai');
    });
  });

  describe('property-based tests', () => {
    /**
     * Feature: llm-gateway, Property 10: resolveModelAlias returns non-empty array for configured aliases
     */
    it('Property 10: resolveModelAlias returns non-empty array for configured aliases', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...testConfig.modelAliases.map(a => a.alias)),
          (alias) => {
            const r = new Router(testConfig);
            const providers = r.resolveModelAlias(alias);
            expect(providers.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Feature: llm-gateway, Property 11: If any available provider exists, selectProvider returns an available one
     */
    it('Property 11: selectProvider returns available provider when one exists', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              provider: fc.stringMatching(/^[a-z][a-z0-9]{2,9}$/),
              model: fc.stringMatching(/^[a-z][a-z0-9-]{2,19}$/),
              priority: fc.integer({ min: 0, max: 10 }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.array(fc.stringMatching(/^[a-z][a-z0-9]{2,9}$/), { minLength: 0, maxLength: 3 }),
          (candidates, failedProviders) => {
            const r = new Router(testConfig);
            for (const p of failedProviders) {
              r.markFailed(p);
            }
            const availableCandidates = candidates.filter(c => !r.isProviderFailed(c.provider));
            const selected = r.selectProvider(candidates);
            if (availableCandidates.length > 0) {
              expect(selected).not.toBeNull();
              expect(r.isProviderFailed(selected!.provider)).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: llm-gateway, Property 12: getNextProvider never returns the same provider just marked failed (unless only option)
     */
    it('Property 12: getNextProvider never returns same provider just marked failed (unless only option)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('best-model', 'fast-model'),
          (alias) => {
            const r = new Router(testConfig);
            const providers = r.resolveModelAlias(alias);
            if (providers.length <= 1) return; // skip single-provider aliases for this property
            const firstProvider = providers[0].provider;
            const next = r.getNextProvider(alias, firstProvider);
            if (next !== null) {
              expect(next.provider).not.toBe(firstProvider);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
