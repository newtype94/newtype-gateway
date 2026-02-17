import express, { Request, Response, NextFunction } from 'express';
import type { Server } from 'http';
import type { RequestHandler } from '../handler/request-handler.js';
import type { Configuration } from '../types/index.js';
import type { ProviderError, OpenAIError } from '../types/index.js';
import logger from '../config/logger.js';
import { randomUUID } from 'crypto';
import { UsageTracker } from '../dashboard/usage-tracker.js';
import { createDashboardRoutes } from '../dashboard/dashboard-routes.js';
import { getDashboardHTML } from '../dashboard/dashboard-page.js';
import type { TokenStore } from '../types/index.js';
import type { AuthManager } from '../auth/auth-manager.js';
import type { RateLimiter } from '../rate-limiter/rate-limiter.js';

interface DashboardDepsParam {
  usageTracker: UsageTracker;
  tokenStore: TokenStore;
  rateLimiter: RateLimiter;
  authManager: AuthManager;
  startTime: number;
}

export class GatewayProxy {
  private app: express.Application;
  private server: Server | null = null;
  private requestHandler: RequestHandler;
  private config: Configuration;
  private dashboardDeps?: DashboardDepsParam;

  constructor(requestHandler: RequestHandler, config: Configuration, dashboardDeps?: DashboardDepsParam) {
    this.requestHandler = requestHandler;
    this.config = config;
    this.dashboardDeps = dashboardDeps;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandler();
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '10mb' }));

    // Request ID and logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const requestId = randomUUID();
      req.headers['x-request-id'] = requestId;
      res.setHeader('x-request-id', requestId);
      logger.info({ method: req.method, path: req.path, requestId }, 'Incoming request');
      next();
    });
  }

  private setupRoutes(): void {
    // POST /v1/chat/completions
    this.app.post('/v1/chat/completions', this.handleChatCompletions.bind(this));

    // GET /health
    this.app.get('/health', this.handleHealth.bind(this));

    // GET /v1/models
    this.app.get('/v1/models', this.handleListModels.bind(this));

    // Dashboard routes (only when dashboardDeps is provided)
    if (this.dashboardDeps) {
      this.app.get('/dashboard', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'text/html');
        res.send(getDashboardHTML());
      });

      const dashboardRouter = createDashboardRoutes({
        config: this.config,
        tokenStore: this.dashboardDeps.tokenStore,
        rateLimiter: this.dashboardDeps.rateLimiter,
        usageTracker: this.dashboardDeps.usageTracker,
        authManager: this.dashboardDeps.authManager,
        startTime: this.dashboardDeps.startTime,
      });
      this.app.use('/api/dashboard', dashboardRouter);
    }

    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({
        error: { message: 'Not found', type: 'invalid_request_error', param: null, code: null }
      });
    });
  }

  private async handleChatCompletions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const request = this.requestHandler.parseRequest(req.body);

      if (request.stream) {
        // SSE streaming response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        try {
          for await (const chunk of this.requestHandler.handleCompletionStream(request)) {
            if (res.destroyed) break;
            res.write(chunk);
          }
        } catch (streamError: unknown) {
          // Mid-stream error: send error as SSE event then close
          if (!res.destroyed) {
            const errorPayload = this.formatError(streamError);
            res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
            res.write('data: [DONE]\n\n');
          }
        }

        if (!res.destroyed) {
          res.end();
        }
      } else {
        // Non-streaming response
        const response = await this.requestHandler.handleCompletion(request);
        res.json(response);
      }
    } catch (error: unknown) {
      next(error);
    }
  }

  private handleHealth(_req: Request, res: Response): void {
    res.json({ status: 'ok' });
  }

  private handleListModels(_req: Request, res: Response): void {
    const models = this.config.modelAliases.map(alias => ({
      id: alias.alias,
      object: 'model' as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: 'llm-gateway',
    }));

    res.json({
      object: 'list',
      data: models,
    });
  }

  private setupErrorHandler(): void {
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      logger.error({ error: err.message }, 'Request error');

      const errorResponse = this.formatError(err);
      const statusCode = this.getHttpStatus(err);

      res.status(statusCode).json(errorResponse);
    });
  }

  private formatError(error: unknown): OpenAIError {
    // Check if it's a ProviderError
    if (error && typeof error === 'object' && 'type' in error && 'provider' in error) {
      const pe = error as ProviderError;
      let type = 'server_error';
      let code: string | null = null;
      if (pe.type === 'auth') { type = 'authentication_error'; code = 'invalid_api_key'; }
      else if (pe.type === 'rate_limit') { type = 'rate_limit_error'; code = 'rate_limit_exceeded'; }
      else if (pe.type === 'invalid_request') { type = 'invalid_request_error'; }
      else if (pe.type === 'service_unavailable') { type = 'server_error'; code = 'service_unavailable'; }
      return { error: { message: pe.message, type, param: null, code } };
    }

    const message = error instanceof Error ? error.message : String(error);
    // Check if it's a validation error (from parseRequest)
    if (message.includes('required') || message.includes('must be') || message.includes('must have')) {
      return { error: { message, type: 'invalid_request_error', param: null, code: null } };
    }
    return { error: { message, type: 'server_error', param: null, code: null } };
  }

  private getHttpStatus(error: unknown): number {
    if (error && typeof error === 'object' && 'type' in error) {
      const pe = error as ProviderError;
      if (pe.type === 'auth') return 401;
      if (pe.type === 'rate_limit') return 429;
      if (pe.type === 'invalid_request') return 400;
      if (pe.type === 'service_unavailable') return 503;
    }
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('required') || msg.includes('must be') || msg.includes('must have') || msg.includes('Unknown model')) {
      return 400;
    }
    return 500;
  }

  /**
   * Validate host is localhost only (security requirement 7.2-7.3)
   */
  private validateHost(host: string): void {
    const allowedHosts = ['localhost', '127.0.0.1', '::1'];
    if (!allowedHosts.includes(host)) {
      throw new Error(`Security: host must be localhost, 127.0.0.1, or ::1. Got: ${host}`);
    }
  }

  async start(): Promise<void> {
    const { host, port } = this.config.gateway;
    this.validateHost(host);

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, host, () => {
          logger.info({ host, port }, 'Gateway proxy started');
          resolve();
        });
        this.server.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else {
          logger.info('Gateway proxy stopped');
          resolve();
        }
      });
    });
  }

  getApp(): express.Application {
    return this.app;
  }
}
