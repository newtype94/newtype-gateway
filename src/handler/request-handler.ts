import type { Router } from '../router/router.js';
import type { RateLimiter } from '../rate-limiter/rate-limiter.js';
import type { BaseProvider } from '../providers/base-provider.js';
import type { ResponseTransformer } from '../transformer/response-transformer.js';
import type { AuthManager } from '../auth/auth-manager.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ProviderRequest,
  ProviderError,
} from '../types/index.js';
import logger from '../config/logger.js';
import type { UsageTracker } from '../dashboard/usage-tracker.js';

export class RequestHandler {
  private router: Router;
  private rateLimiter: RateLimiter;
  private providers: Map<string, BaseProvider>;
  private transformer: ResponseTransformer;
  private authManager: AuthManager;
  private maxRetries: number;
  private usageTracker?: UsageTracker;

  constructor(
    router: Router,
    rateLimiter: RateLimiter,
    providers: Map<string, BaseProvider>,
    transformer: ResponseTransformer,
    authManager: AuthManager,
    maxRetries: number = 3,
    usageTracker?: UsageTracker
  ) {
    this.router = router;
    this.rateLimiter = rateLimiter;
    this.providers = providers;
    this.transformer = transformer;
    this.authManager = authManager;
    this.maxRetries = maxRetries;
    this.usageTracker = usageTracker;
  }

  /**
   * Parse and validate incoming request body.
   * Throws if model or messages are invalid.
   */
  parseRequest(body: unknown): ChatCompletionRequest {
    if (!body || typeof body !== 'object') {
      throw new Error('Request body must be a JSON object');
    }
    const obj = body as Record<string, unknown>;

    if (!obj.model || typeof obj.model !== 'string') {
      throw new Error('model is required and must be a string');
    }
    if (!Array.isArray(obj.messages) || obj.messages.length === 0) {
      throw new Error('messages is required and must be a non-empty array');
    }
    // Validate each message has role and content
    for (const msg of obj.messages) {
      if (!msg || typeof msg !== 'object') throw new Error('Each message must be an object');
      const m = msg as Record<string, unknown>;
      if (!m.role || typeof m.role !== 'string') throw new Error('Each message must have a role');
      // content can be null for assistant messages with tool_calls
      if (m.content === undefined && !m.tool_calls && !m.function_call) {
        throw new Error('Each message must have content, tool_calls, or function_call');
      }
    }
    return obj as unknown as ChatCompletionRequest;
  }

  /**
   * Handle a non-streaming chat completion request.
   * Pipeline: validate -> route -> rate limit -> auth -> provider call -> transform
   * With automatic fallback on retryable errors.
   */
  async handleCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // 1. Resolve model alias to provider candidates
    const candidates = this.router.resolveModelAlias(request.model);
    let selected = this.router.selectProvider(candidates);

    if (!selected) {
      throw this.createProviderError('No available provider', request.model);
    }

    let lastError: ProviderError | null = null;
    let attempts = 0;

    while (attempts < this.maxRetries && selected) {
      attempts++;
      try {
        // 2. Rate limit
        await this.rateLimiter.acquire(selected.provider);

        // 3. Get valid token
        const token = await this.authManager.getValidToken(selected.provider);

        // 4. Build provider request
        const providerRequest: ProviderRequest = {
          model: selected.model,
          messages: request.messages,
          stream: false,
          accessToken: token.accessToken,
          temperature: request.temperature,
          top_p: request.top_p,
          max_tokens: request.max_tokens,
          stop: request.stop,
          tools: request.tools,
        };

        // 5. Get provider and make call
        const provider = this.providers.get(selected.provider);
        if (!provider) {
          throw {
            provider: selected.provider,
            message: `Provider ${selected.provider} not initialized`,
            type: 'service_unavailable',
            retryable: true,
          } as ProviderError;
        }

        const response = await provider.chatCompletion(providerRequest);

        // 6. Track usage (before transform to preserve camelCase)
        this.usageTracker?.recordUsage(selected.provider, selected.model, response.usage);

        // 7. Transform to OpenAI format
        return this.transformer.toOpenAIResponse(response, request.model);
      } catch (error: unknown) {
        const providerError = this.normalizeToProviderError(error, selected.provider);
        lastError = providerError;

        logger.warn(
          { provider: selected.provider, error: providerError.message, attempt: attempts },
          'Provider call failed'
        );

        if (providerError.retryable && attempts < this.maxRetries) {
          selected = this.router.getNextProvider(request.model, selected.provider);
          if (!selected) break;
          logger.info({ nextProvider: selected.provider }, 'Falling back to next provider');
        } else {
          break;
        }
      }
    }

    // All retries exhausted
    throw lastError || this.createProviderError('All providers failed', request.model);
  }

  /**
   * Handle a streaming chat completion request.
   * Same pipeline but yields SSE-formatted strings.
   */
  async *handleCompletionStream(request: ChatCompletionRequest): AsyncGenerator<string> {
    const candidates = this.router.resolveModelAlias(request.model);
    let selected = this.router.selectProvider(candidates);

    if (!selected) {
      throw this.createProviderError('No available provider', request.model);
    }

    let lastError: ProviderError | null = null;
    let attempts = 0;

    while (attempts < this.maxRetries && selected) {
      attempts++;
      try {
        await this.rateLimiter.acquire(selected.provider);
        const token = await this.authManager.getValidToken(selected.provider);

        const providerRequest: ProviderRequest = {
          model: selected.model,
          messages: request.messages,
          stream: true,
          accessToken: token.accessToken,
          temperature: request.temperature,
          top_p: request.top_p,
          max_tokens: request.max_tokens,
          stop: request.stop,
          tools: request.tools,
        };

        const provider = this.providers.get(selected.provider);
        if (!provider) {
          throw {
            provider: selected.provider,
            message: `Provider ${selected.provider} not initialized`,
            type: 'service_unavailable',
            retryable: true,
          } as ProviderError;
        }

        const streamId = this.transformer.generateCompletionId();

        for await (const chunk of provider.chatCompletionStream(providerRequest)) {
          const openaiChunk = this.transformer.toOpenAIChunk(chunk, request.model, streamId);
          yield this.transformer.formatSSE(openaiChunk);
        }

        yield this.transformer.formatSSEDone();
        return; // Success, exit generator
      } catch (error: unknown) {
        const providerError = this.normalizeToProviderError(error, selected.provider);
        lastError = providerError;

        logger.warn(
          { provider: selected.provider, error: providerError.message, attempt: attempts },
          'Stream provider call failed'
        );

        if (providerError.retryable && attempts < this.maxRetries) {
          selected = this.router.getNextProvider(request.model, selected.provider);
          if (!selected) break;
        } else {
          break;
        }
      }
    }

    throw lastError || this.createProviderError('All providers failed', request.model);
  }

  private normalizeToProviderError(error: unknown, provider: string): ProviderError {
    if (error && typeof error === 'object' && 'type' in error && 'message' in error) {
      return error as ProviderError;
    }
    const msg = error instanceof Error ? error.message : String(error);
    return { provider, message: msg, type: 'unknown', retryable: false };
  }

  private createProviderError(message: string, model: string): ProviderError {
    return { provider: model, message, type: 'service_unavailable', retryable: false };
  }
}
