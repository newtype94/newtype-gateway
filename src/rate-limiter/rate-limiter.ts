import type { RateLimitConfig, RateLimitStatus } from '../types/index.js';
import logger from '../config/logger.js';

interface QueuedRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

export class RateLimiter {
  private configs: Map<string, RateLimitConfig>;
  private requestTimestamps: Map<string, number[]>;
  private queues: Map<string, QueuedRequest[]>;
  private timers: Map<string, NodeJS.Timeout>;

  constructor(configs: RateLimitConfig[]) {
    this.configs = new Map(configs.map(c => [c.provider, c]));
    this.requestTimestamps = new Map();
    this.queues = new Map();
    this.timers = new Map();
  }

  acquire(provider: string): Promise<void> {
    const config = this.configs.get(provider);
    if (!config) {
      return Promise.resolve();
    }

    this.cleanWindow(provider);

    const timestamps = this.requestTimestamps.get(provider) ?? [];
    if (!this.requestTimestamps.has(provider)) {
      this.requestTimestamps.set(provider, timestamps);
    }

    const queue = this.queues.get(provider) ?? [];
    if (!this.queues.has(provider)) {
      this.queues.set(provider, queue);
    }

    if (timestamps.length < config.requestsPerMinute) {
      timestamps.push(Date.now());
      logger.debug({ provider, requestsInWindow: timestamps.length }, 'Rate limiter: request allowed');
      return Promise.resolve();
    }

    if (queue.length < config.maxQueueSize) {
      return new Promise<void>((resolve, reject) => {
        queue.push({ resolve, reject, enqueuedAt: Date.now() });
        logger.debug({ provider, queueLength: queue.length }, 'Rate limiter: request queued');
        this.startTimer(provider);
      });
    }

    logger.warn({ provider }, 'Rate limiter: queue full, rejecting request');
    return Promise.reject(new Error(`Rate limit exceeded: queue full for provider ${provider}`));
  }

  getStatus(provider: string): RateLimitStatus {
    if (!this.configs.has(provider)) {
      return { requestsInWindow: 0, queueLength: 0, nextAvailableSlot: 0 };
    }

    this.cleanWindow(provider);

    const timestamps = this.requestTimestamps.get(provider) ?? [];
    const queue = this.queues.get(provider) ?? [];
    const config = this.configs.get(provider)!;

    let nextAvailableSlot = 0;
    if (timestamps.length >= config.requestsPerMinute && timestamps.length > 0) {
      nextAvailableSlot = timestamps[0] + 60000;
    }

    return {
      requestsInWindow: timestamps.length,
      queueLength: queue.length,
      nextAvailableSlot,
    };
  }

  dispose(): void {
    for (const [provider] of this.timers) {
      this.stopTimer(provider);
    }

    for (const [provider, queue] of this.queues) {
      for (const item of queue) {
        item.reject(new Error(`Rate limiter disposed for provider ${provider}`));
      }
      queue.length = 0;
    }

    logger.debug('Rate limiter disposed');
  }

  private cleanWindow(provider: string): void {
    const timestamps = this.requestTimestamps.get(provider);
    if (!timestamps) return;

    const cutoff = Date.now() - 60000;
    const validIdx = timestamps.findIndex(t => t > cutoff);
    if (validIdx === -1) {
      timestamps.length = 0;
    } else if (validIdx > 0) {
      timestamps.splice(0, validIdx);
    }
  }

  private processQueue(provider: string): void {
    this.cleanWindow(provider);

    const config = this.configs.get(provider);
    if (!config) return;

    const timestamps = this.requestTimestamps.get(provider) ?? [];
    const queue = this.queues.get(provider) ?? [];

    while (queue.length > 0 && timestamps.length < config.requestsPerMinute) {
      const item = queue.shift()!;
      timestamps.push(Date.now());
      logger.debug({ provider, queueLength: queue.length }, 'Rate limiter: queued request released');
      item.resolve();
    }

    if (queue.length === 0) {
      this.stopTimer(provider);
    }
  }

  private startTimer(provider: string): void {
    if (this.timers.has(provider)) return;

    const timer = setInterval(() => {
      this.processQueue(provider);
    }, 1000);

    this.timers.set(provider, timer);
  }

  private stopTimer(provider: string): void {
    const timer = this.timers.get(provider);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(provider);
    }
  }
}
