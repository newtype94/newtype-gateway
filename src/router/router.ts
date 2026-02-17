import type { Configuration, ModelAlias, ProviderModel } from '../types/index.js';
import logger from '../config/logger.js';

export class Router {
  private modelAliases: Map<string, ModelAlias>;
  private failedProviders: Map<string, number>;
  private failureTTL: number;

  constructor(config: Configuration, failureTTL: number = 60000) {
    this.failureTTL = failureTTL;
    this.failedProviders = new Map();
    this.modelAliases = new Map();
    for (const alias of config.modelAliases) {
      this.modelAliases.set(alias.alias, alias);
    }
    logger.debug({ aliasCount: this.modelAliases.size }, 'Router initialized');
  }

  resolveModelAlias(model: string): ProviderModel[] {
    const alias = this.modelAliases.get(model);
    if (alias) {
      const sorted = [...alias.providers].sort((a, b) => a.priority - b.priority);
      return sorted;
    }
    if (model.includes('/')) {
      const slashIndex = model.indexOf('/');
      const provider = model.slice(0, slashIndex);
      const modelName = model.slice(slashIndex + 1);
      return [{ provider, model: modelName, priority: 0 }];
    }
    throw new Error(`Unknown model: ${model}`);
  }

  selectProvider(candidates: ProviderModel[]): ProviderModel | null {
    if (candidates.length === 0) return null;
    this.clearExpiredFailures();
    const available: ProviderModel[] = [];
    const failed: ProviderModel[] = [];
    for (const candidate of candidates) {
      if (this.isProviderFailed(candidate.provider)) {
        failed.push(candidate);
      } else {
        available.push(candidate);
      }
    }
    available.sort((a, b) => a.priority - b.priority);
    failed.sort((a, b) => a.priority - b.priority);
    if (available.length > 0) return available[0];
    return failed.length > 0 ? failed[0] : null;
  }

  getNextProvider(model: string, failedProvider: string): ProviderModel | null {
    this.markFailed(failedProvider);
    const candidates = this.resolveModelAlias(model);
    return this.selectProvider(candidates);
  }

  markFailed(provider: string): void {
    this.failedProviders.set(provider, Date.now());
    logger.debug({ provider }, 'Provider marked as failed');
  }

  clearExpiredFailures(): void {
    const now = Date.now();
    for (const [provider, timestamp] of this.failedProviders) {
      if (now - timestamp > this.failureTTL) {
        this.failedProviders.delete(provider);
      }
    }
  }

  isProviderFailed(provider: string): boolean {
    const timestamp = this.failedProviders.get(provider);
    if (timestamp === undefined) return false;
    return Date.now() - timestamp <= this.failureTTL;
  }
}
