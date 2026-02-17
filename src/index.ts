import { Command } from 'commander';
import { loadConfig } from './config/loader.js';
import logger from './config/logger.js';
import { FileTokenStore } from './auth/token-store.js';
import { AuthManager } from './auth/auth-manager.js';
import { Router } from './router/router.js';
import { RateLimiter } from './rate-limiter/rate-limiter.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { GeminiProvider } from './providers/gemini-provider.js';
import { BaseProvider } from './providers/base-provider.js';
import { ResponseTransformer } from './transformer/response-transformer.js';
import { RequestHandler } from './handler/request-handler.js';
import { GatewayProxy } from './server/gateway-proxy.js';
import type { Configuration } from './types/index.js';
import { UsageTracker } from './dashboard/usage-tracker.js';

export async function startGateway(configPath: string): Promise<{ gateway: GatewayProxy; cleanup: () => Promise<void> }> {
  const startTime = Date.now();
  // 1. Load configuration
  const config = loadConfig(configPath);
  logger.info({ host: config.gateway.host, port: config.gateway.port }, 'Configuration loaded');

  // 2. Initialize token store
  const tokenStore = new FileTokenStore(config.auth.tokenStorePath);

  // 3. Initialize auth manager
  const authManager = new AuthManager(tokenStore, config.providers);
  authManager.startFileWatcher(config.auth.watchFiles);

  // 4. Initialize router
  const router = new Router(config);

  // 5. Initialize rate limiter
  const rateLimiter = new RateLimiter(config.rateLimits);

  // 6. Initialize provider clients
  const providers = new Map<string, BaseProvider>();
  for (const [name, providerConfig] of Object.entries(config.providers)) {
    if (!providerConfig.enabled) continue;
    if (name === 'openai') {
      providers.set(name, new OpenAIProvider(providerConfig.apiEndpoint));
    } else if (name === 'gemini') {
      providers.set(name, new GeminiProvider(providerConfig.apiEndpoint));
    } else {
      logger.warn({ provider: name }, 'Unknown provider type, skipping');
    }
  }

  if (providers.size === 0) {
    throw new Error('No enabled providers configured. At least one provider must be enabled.');
  }

  logger.info({ providers: Array.from(providers.keys()) }, 'Providers initialized');

  // 7. Initialize transformer
  const transformer = new ResponseTransformer();

  // 7.5. Initialize usage tracker
  const usageTracker = new UsageTracker();

  // 8. Initialize request handler
  const requestHandler = new RequestHandler(router, rateLimiter, providers, transformer, authManager, 3, usageTracker);

  // 9. Initialize and start gateway
  const gateway = new GatewayProxy(requestHandler, config, {
    usageTracker,
    tokenStore,
    rateLimiter,
    authManager,
    startTime,
  });
  await gateway.start();

  // Cleanup function
  const cleanup = async () => {
    await gateway.stop();
    await authManager.stopFileWatcher();
    rateLimiter.dispose();
    logger.info('All components cleaned up');
  };

  return { gateway, cleanup };
}

// CLI setup
const program = new Command();

program
  .name('llm-gateway')
  .description('Local LLM Gateway with OAuth authentication')
  .version('1.0.0')
  .option('-c, --config <path>', 'Path to configuration file', './config.yaml')
  .action(async (options) => {
    try {
      logger.info('Starting LLM Gateway...');
      const { cleanup } = await startGateway(options.config);

      // Graceful shutdown handlers
      const shutdown = async () => {
        logger.info('Shutting down gracefully...');
        await cleanup();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      logger.info('LLM Gateway started successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to start LLM Gateway');
      process.exit(1);
    }
  });

// Only run CLI when this module is executed directly (not imported in tests)
import { fileURLToPath } from 'url';
import { argv } from 'process';

const __filename = fileURLToPath(import.meta.url);
const isMain = argv[1] && (argv[1] === __filename || argv[1].endsWith('index.js') || argv[1].endsWith('index.ts'));
if (isMain) {
  program.parse();
}
