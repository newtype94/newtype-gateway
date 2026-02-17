import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { RateLimiter } from '../src/rate-limiter/rate-limiter.js';
import type { RateLimitConfig } from '../src/types/index.js';

const testConfigs: RateLimitConfig[] = [
  { provider: 'openai', requestsPerMinute: 3, maxQueueSize: 5 },
  { provider: 'gemini', requestsPerMinute: 2, maxQueueSize: 3 },
];

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter(testConfigs);
  });

  afterEach(() => {
    rateLimiter.dispose();
    vi.useRealTimers();
  });

  describe('unit tests', () => {
    it('acquire resolves immediately when under limit', async () => {
      // openai allows 3 requests per minute; first request should resolve immediately
      await expect(rateLimiter.acquire('openai')).resolves.toBeUndefined();
      const status = rateLimiter.getStatus('openai');
      expect(status.requestsInWindow).toBe(1);
    });

    it('acquire queues when at limit but queue not full', async () => {
      vi.useFakeTimers();

      // Fill up the openai limit (3 requests)
      await rateLimiter.acquire('openai');
      await rateLimiter.acquire('openai');
      await rateLimiter.acquire('openai');

      // 4th request should queue (not resolve yet)
      let resolved = false;
      const pending = rateLimiter.acquire('openai').then(() => { resolved = true; });

      // Should not resolve immediately
      await Promise.resolve();
      expect(resolved).toBe(false);

      const status = rateLimiter.getStatus('openai');
      expect(status.queueLength).toBe(1);

      // Advance time past 60s window so old timestamps expire
      vi.advanceTimersByTime(61000);

      await pending;
      expect(resolved).toBe(true);
    });

    it('acquire rejects when queue is full', async () => {
      vi.useFakeTimers();

      // Fill the rate limit (3 slots)
      await rateLimiter.acquire('openai');
      await rateLimiter.acquire('openai');
      await rateLimiter.acquire('openai');

      // Fill the queue (maxQueueSize = 5)
      const queuedPromises: Promise<void>[] = [];
      for (let i = 0; i < 5; i++) {
        queuedPromises.push(rateLimiter.acquire('openai'));
      }

      // One more beyond queue capacity should reject
      await expect(rateLimiter.acquire('openai')).rejects.toThrow(
        'Rate limit exceeded: queue full for provider openai'
      );

      // Cleanup: dispose rejects remaining queued items
      rateLimiter.dispose();
      await Promise.allSettled(queuedPromises);
    });

    it('queued requests resolve when window slides (fake timers)', async () => {
      vi.useFakeTimers();

      // Fill up limit (gemini: 2 req/min)
      await rateLimiter.acquire('gemini');
      await rateLimiter.acquire('gemini');

      // Queue a 3rd request
      let resolved = false;
      const pending = rateLimiter.acquire('gemini').then(() => { resolved = true; });

      expect(resolved).toBe(false);

      // Advance 61 seconds so old timestamps expire and interval fires
      vi.advanceTimersByTime(61000);

      await pending;
      expect(resolved).toBe(true);
    });

    it('getStatus returns correct counts', async () => {
      await rateLimiter.acquire('openai');
      await rateLimiter.acquire('openai');

      const status = rateLimiter.getStatus('openai');
      expect(status.requestsInWindow).toBe(2);
      expect(status.queueLength).toBe(0);
      expect(status.nextAvailableSlot).toBe(0); // still under limit
    });

    it('sliding window: old requests expire and free slots (fake timers)', async () => {
      vi.useFakeTimers();

      // Fill up openai limit
      await rateLimiter.acquire('openai');
      await rateLimiter.acquire('openai');
      await rateLimiter.acquire('openai');

      let statusFull = rateLimiter.getStatus('openai');
      expect(statusFull.requestsInWindow).toBe(3);

      // Advance time past window
      vi.advanceTimersByTime(61000);

      // After window slides, old requests should be gone
      const statusAfter = rateLimiter.getStatus('openai');
      expect(statusAfter.requestsInWindow).toBe(0);

      // New request should resolve immediately
      await expect(rateLimiter.acquire('openai')).resolves.toBeUndefined();
    });

    it('unconfigured provider passes through immediately', async () => {
      await expect(rateLimiter.acquire('unknown-provider')).resolves.toBeUndefined();
      // Status for unknown provider returns zeros
      const status = rateLimiter.getStatus('unknown-provider');
      expect(status.requestsInWindow).toBe(0);
      expect(status.queueLength).toBe(0);
      expect(status.nextAvailableSlot).toBe(0);
    });
  });

  describe('property-based tests', () => {
    /**
     * Feature: llm-gateway, Property 13: After N requests (N = requestsPerMinute),
     * getStatus shows requestsInWindow === N
     */
    it('Property 13: after N requests getStatus shows requestsInWindow === N', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (n) => {
            const config: RateLimitConfig[] = [
              { provider: 'test-provider', requestsPerMinute: n, maxQueueSize: 10 },
            ];
            const limiter = new RateLimiter(config);
            try {
              for (let i = 0; i < n; i++) {
                await limiter.acquire('test-provider');
              }
              const status = limiter.getStatus('test-provider');
              expect(status.requestsInWindow).toBe(n);
            } finally {
              limiter.dispose();
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    /**
     * Feature: llm-gateway, Property 14: Queued requests resolve in FIFO order
     */
    it('Property 14: queued requests resolve in FIFO order', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 3 }),
          async (queueCount) => {
            vi.useFakeTimers();

            const config: RateLimitConfig[] = [
              { provider: 'fifo-provider', requestsPerMinute: 1, maxQueueSize: queueCount + 5 },
            ];
            const limiter = new RateLimiter(config);

            try {
              // Use the one slot
              await limiter.acquire('fifo-provider');

              const order: number[] = [];
              const promises: Promise<void>[] = [];

              for (let i = 0; i < queueCount; i++) {
                const idx = i;
                promises.push(limiter.acquire('fifo-provider').then(() => { order.push(idx); }));
              }

              // Advance time in 1s increments to release one per tick
              for (let i = 0; i < queueCount + 2; i++) {
                vi.advanceTimersByTime(61000);
                await Promise.resolve();
                await Promise.resolve();
              }

              await Promise.all(promises);

              // Check FIFO order
              for (let i = 0; i < order.length - 1; i++) {
                expect(order[i]).toBeLessThan(order[i + 1]);
              }
            } finally {
              limiter.dispose();
              vi.useRealTimers();
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    /**
     * Feature: llm-gateway, Property 15: Rate limiting on provider A does not affect provider B
     */
    it('Property 15: rate limiting on provider A does not affect provider B', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (extraRequests) => {
            const config: RateLimitConfig[] = [
              { provider: 'provider-a', requestsPerMinute: 1, maxQueueSize: 2 },
              { provider: 'provider-b', requestsPerMinute: 10, maxQueueSize: 10 },
            ];
            const limiter = new RateLimiter(config);

            try {
              // Saturate provider A
              await limiter.acquire('provider-a');

              // Provider B should still resolve immediately regardless of A's state
              for (let i = 0; i < extraRequests; i++) {
                await expect(limiter.acquire('provider-b')).resolves.toBeUndefined();
              }

              const statusA = limiter.getStatus('provider-a');
              const statusB = limiter.getStatus('provider-b');

              expect(statusA.requestsInWindow).toBe(1);
              expect(statusB.requestsInWindow).toBe(extraRequests);
            } finally {
              limiter.dispose();
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
