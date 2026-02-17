import axios, { AxiosInstance } from 'axios';
import type { ProviderRequest, ProviderResponse, ProviderStreamChunk, ProviderError } from '../types/index.js';
import { UserAgentPool } from './user-agent-pool.js';
import logger from '../config/logger.js';

export abstract class BaseProvider {
  protected client: AxiosInstance;
  protected providerName: string;
  protected userAgentPool: UserAgentPool;

  constructor(providerName: string, baseURL: string) {
    this.providerName = providerName;
    this.userAgentPool = new UserAgentPool();
    this.client = axios.create({ baseURL, timeout: 30000 });
  }

  buildHeaders(accessToken: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': this.userAgentPool.getNext(),
    };
  }

  abstract chatCompletion(request: ProviderRequest): Promise<ProviderResponse>;
  abstract chatCompletionStream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk>;

  protected normalizeError(error: unknown): ProviderError {
    const axiosError = error as any;
    const statusCode = axiosError?.response?.status;
    const message = axiosError?.response?.data?.error?.message || axiosError?.message || 'Unknown error';

    let type: ProviderError['type'] = 'unknown';
    let retryable = false;

    if (statusCode === 401 || statusCode === 403) {
      type = 'auth';
    } else if (statusCode === 429) {
      type = 'rate_limit';
      retryable = true;
    } else if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
      type = 'service_unavailable';
      retryable = true;
    } else if (statusCode === 400) {
      type = 'invalid_request';
    }

    return { provider: this.providerName, statusCode, message, type, retryable };
  }
}
