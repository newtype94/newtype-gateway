export interface ModelUsage {
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UsageStats {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  byProvider: Record<string, ModelUsage>;
  byModel: Record<string, ModelUsage>;
  since: number;
}

export class UsageTracker {
  private totalRequests: number;
  private totalPromptTokens: number;
  private totalCompletionTokens: number;
  private totalTokens: number;
  private byProvider: Map<string, ModelUsage>;
  private byModel: Map<string, ModelUsage>;
  private since: number;

  constructor() {
    this.totalRequests = 0;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalTokens = 0;
    this.byProvider = new Map();
    this.byModel = new Map();
    this.since = Date.now();
  }

  recordUsage(
    provider: string,
    model: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  ): void {
    this.totalRequests += 1;
    this.totalPromptTokens += usage.promptTokens;
    this.totalCompletionTokens += usage.completionTokens;
    this.totalTokens += usage.totalTokens;

    if (!this.byProvider.has(provider)) {
      this.byProvider.set(provider, {
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    }
    const providerEntry = this.byProvider.get(provider)!;
    providerEntry.requestCount += 1;
    providerEntry.promptTokens += usage.promptTokens;
    providerEntry.completionTokens += usage.completionTokens;
    providerEntry.totalTokens += usage.totalTokens;

    if (!this.byModel.has(model)) {
      this.byModel.set(model, {
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    }
    const modelEntry = this.byModel.get(model)!;
    modelEntry.requestCount += 1;
    modelEntry.promptTokens += usage.promptTokens;
    modelEntry.completionTokens += usage.completionTokens;
    modelEntry.totalTokens += usage.totalTokens;
  }

  getStats(): UsageStats {
    return {
      totalRequests: this.totalRequests,
      totalPromptTokens: this.totalPromptTokens,
      totalCompletionTokens: this.totalCompletionTokens,
      totalTokens: this.totalTokens,
      byProvider: Object.fromEntries(this.byProvider),
      byModel: Object.fromEntries(this.byModel),
      since: this.since,
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalTokens = 0;
    this.byProvider = new Map();
    this.byModel = new Map();
    this.since = Date.now();
  }
}
