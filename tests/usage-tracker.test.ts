import { describe, it, expect, beforeEach } from 'vitest';
import { UsageTracker } from '../src/dashboard/usage-tracker.js';

describe('UsageTracker', () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
  });

  describe('initial state', () => {
    it('should return zero counts initially', () => {
      const stats = tracker.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalPromptTokens).toBe(0);
      expect(stats.totalCompletionTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(Object.keys(stats.byProvider)).toHaveLength(0);
      expect(Object.keys(stats.byModel)).toHaveLength(0);
      expect(stats.since).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('recordUsage', () => {
    it('should accumulate usage correctly', () => {
      tracker.recordUsage('openai', 'gpt-4', { promptTokens: 10, completionTokens: 20, totalTokens: 30 });
      tracker.recordUsage('openai', 'gpt-4', { promptTokens: 5, completionTokens: 15, totalTokens: 20 });

      const stats = tracker.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.totalPromptTokens).toBe(15);
      expect(stats.totalCompletionTokens).toBe(35);
      expect(stats.totalTokens).toBe(50);
    });

    it('should track by provider correctly', () => {
      tracker.recordUsage('openai', 'gpt-4', { promptTokens: 10, completionTokens: 20, totalTokens: 30 });
      tracker.recordUsage('gemini', 'gemini-pro', { promptTokens: 5, completionTokens: 10, totalTokens: 15 });

      const stats = tracker.getStats();
      expect(stats.byProvider['openai'].requestCount).toBe(1);
      expect(stats.byProvider['openai'].totalTokens).toBe(30);
      expect(stats.byProvider['gemini'].requestCount).toBe(1);
      expect(stats.byProvider['gemini'].totalTokens).toBe(15);
    });

    it('should track by model correctly', () => {
      tracker.recordUsage('openai', 'gpt-4', { promptTokens: 10, completionTokens: 20, totalTokens: 30 });
      tracker.recordUsage('openai', 'gpt-3.5', { promptTokens: 5, completionTokens: 10, totalTokens: 15 });
      tracker.recordUsage('openai', 'gpt-4', { promptTokens: 8, completionTokens: 12, totalTokens: 20 });

      const stats = tracker.getStats();
      expect(stats.byModel['gpt-4'].requestCount).toBe(2);
      expect(stats.byModel['gpt-4'].totalTokens).toBe(50);
      expect(stats.byModel['gpt-3.5'].requestCount).toBe(1);
      expect(stats.byModel['gpt-3.5'].totalTokens).toBe(15);
    });
  });

  describe('reset', () => {
    it('should clear all accumulated data', () => {
      tracker.recordUsage('openai', 'gpt-4', { promptTokens: 10, completionTokens: 20, totalTokens: 30 });
      tracker.reset();

      const stats = tracker.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalPromptTokens).toBe(0);
      expect(stats.totalCompletionTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(Object.keys(stats.byProvider)).toHaveLength(0);
      expect(Object.keys(stats.byModel)).toHaveLength(0);
    });

    it('should update the since timestamp on reset', () => {
      const beforeReset = Date.now();
      tracker.reset();
      const stats = tracker.getStats();
      expect(stats.since).toBeGreaterThanOrEqual(beforeReset);
    });
  });
});
