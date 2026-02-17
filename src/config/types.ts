// Configuration types for the LLM Gateway

// Configuration types for the LLM Gateway

// ============================================================================
// Configuration Types
// ============================================================================

export interface ProviderConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  authEndpoint?: string;
  tokenEndpoint?: string;
  apiEndpoint: string;
}

export interface ProviderModel {
  provider: string;
  model: string;
  priority: number;
}

export interface ModelAlias {
  alias: string;
  providers: ProviderModel[];
}

export interface RateLimitConfig {
  provider: string;
  requestsPerMinute: number;
  maxQueueSize: number;
}

export interface Configuration {
  gateway: {
    host: string;
    port: number;
  };
  auth: {
    tokenStorePath: string;
    watchFiles: string[];
  };
  modelAliases: ModelAlias[];
  rateLimits: RateLimitConfig[];
  providers: {
    [key: string]: ProviderConfig;
  };
}

// ============================================================================
// Rate Limiting Types
// ============================================================================

export interface RateLimitStatus {
  requestsInWindow: number;
  queueLength: number;
  nextAvailableSlot: number;
}

// ============================================================================
// Usage Types
// ============================================================================

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
