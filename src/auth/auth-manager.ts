import axios from 'axios';
import { watch, FSWatcher } from 'chokidar';
import { promises as fs } from 'fs';
import type { TokenStore, TokenSet, DeviceFlowInfo, ProviderConfig } from '../types/index.js';
import logger from '../config/logger.js';

/**
 * AuthManager handles OAuth authentication flows and token lifecycle management
 */
export class AuthManager {
  private tokenStore: TokenStore;
  private providerConfigs: Map<string, ProviderConfig>;
  private fileWatcher?: FSWatcher;

  constructor(tokenStore: TokenStore, providers: Record<string, ProviderConfig>) {
    this.tokenStore = tokenStore;
    this.providerConfigs = new Map(Object.entries(providers));
  }

  /**
   * Get provider configuration
   */
  private getProviderConfig(provider: string): ProviderConfig {
    const config = this.providerConfigs.get(provider);
    if (!config) {
      throw new Error(`Provider ${provider} not configured`);
    }
    if (!config.enabled) {
      throw new Error(`Provider ${provider} is disabled`);
    }
    return config;
  }

  /**
   * Initiate OAuth device flow for a provider
   */
  async initiateDeviceFlow(provider: string): Promise<DeviceFlowInfo> {
    const config = this.getProviderConfig(provider);
    
    if (!config.authEndpoint || !config.clientId) {
      throw new Error(`Provider ${provider} does not support device flow or missing configuration`);
    }

    logger.info({ provider }, 'Initiating device flow');

    try {
      const response = await axios.post(config.authEndpoint, {
        client_id: config.clientId,
        scope: 'openid profile email'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const deviceFlowInfo: DeviceFlowInfo = {
        deviceCode: response.data.device_code,
        userCode: response.data.user_code,
        verificationUrl: response.data.verification_uri || response.data.verification_url,
        expiresIn: response.data.expires_in
      };

      logger.info({ provider, userCode: deviceFlowInfo.userCode }, 'Device flow initiated');
      
      return deviceFlowInfo;
    } catch (error: any) {
      logger.error({ provider, error: error.message }, 'Failed to initiate device flow');
      throw new Error(`Failed to initiate device flow for ${provider}: ${error.message}`);
    }
  }

  /**
   * Complete device flow by polling for token
   */
  async completeDeviceFlow(provider: string, deviceCode: string): Promise<TokenSet> {
    const config = this.getProviderConfig(provider);
    
    if (!config.tokenEndpoint || !config.clientId) {
      throw new Error(`Provider ${provider} missing token endpoint or client ID`);
    }

    logger.info({ provider }, 'Completing device flow');

    const pollInterval = 5000; // 5 seconds
    const maxAttempts = 120; // 10 minutes total
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const response = await axios.post(config.tokenEndpoint, {
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }, {
          headers: {
            'Content-Type': 'application/json'
          }
        });

        const tokenSet: TokenSet = {
          accessToken: response.data.access_token,
          refreshToken: response.data.refresh_token,
          expiresAt: Date.now() + (response.data.expires_in * 1000),
          provider
        };

        await this.tokenStore.saveToken(provider, tokenSet);
        logger.info({ provider }, 'Device flow completed successfully');
        
        return tokenSet;
      } catch (error: any) {
        const errorCode = error.response?.data?.error;
        
        if (errorCode === 'authorization_pending') {
          // User hasn't authorized yet, continue polling
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        } else if (errorCode === 'slow_down') {
          // Slow down polling
          await new Promise(resolve => setTimeout(resolve, pollInterval * 2));
          continue;
        } else if (errorCode === 'expired_token') {
          logger.error({ provider }, 'Device code expired');
          throw new Error(`Device code expired for ${provider}`);
        } else if (errorCode === 'access_denied') {
          logger.error({ provider }, 'User denied authorization');
          throw new Error(`User denied authorization for ${provider}`);
        } else {
          logger.error({ provider, error: error.message }, 'Failed to complete device flow');
          throw new Error(`Failed to complete device flow for ${provider}: ${error.message}`);
        }
      }
    }

    throw new Error(`Device flow timed out for ${provider}`);
  }

  /**
   * Refresh an expired access token
   */
  async refreshToken(provider: string): Promise<TokenSet> {
    const config = this.getProviderConfig(provider);
    const currentToken = await this.tokenStore.getToken(provider);

    if (!currentToken) {
      throw new Error(`No token found for provider ${provider}`);
    }

    if (!currentToken.refreshToken) {
      throw new Error(`No refresh token available for provider ${provider}`);
    }

    if (!config.tokenEndpoint || !config.clientId) {
      throw new Error(`Provider ${provider} missing token endpoint or client ID`);
    }

    logger.info({ provider }, 'Refreshing token');

    try {
      const response = await axios.post(config.tokenEndpoint, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: currentToken.refreshToken,
        grant_type: 'refresh_token'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const tokenSet: TokenSet = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || currentToken.refreshToken,
        expiresAt: Date.now() + (response.data.expires_in * 1000),
        provider
      };

      await this.tokenStore.saveToken(provider, tokenSet);
      logger.info({ provider }, 'Token refreshed successfully');
      
      return tokenSet;
    } catch (error: any) {
      logger.error({ provider, error: error.message }, 'Failed to refresh token');
      
      // If refresh fails, delete the invalid token
      await this.tokenStore.deleteToken(provider);
      
      throw new Error(`Failed to refresh token for ${provider}: ${error.message}. Please re-authenticate.`);
    }
  }

  /**
   * Sync token from an external file
   */
  async syncTokenFromFile(filePath: string, provider: string): Promise<void> {
    logger.info({ filePath, provider }, 'Syncing token from file');

    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const tokenData = JSON.parse(fileContent);

      // Validate token data
      if (!tokenData.access_token && !tokenData.accessToken) {
        throw new Error('Token file missing access_token field');
      }

      const tokenSet: TokenSet = {
        accessToken: tokenData.access_token || tokenData.accessToken,
        refreshToken: tokenData.refresh_token || tokenData.refreshToken,
        expiresAt: tokenData.expires_at || tokenData.expiresAt || (Date.now() + 3600000), // Default 1 hour
        provider
      };

      // Validate token is not expired
      if (Date.now() >= tokenSet.expiresAt) {
        logger.warn({ provider, filePath }, 'Token from file is expired');
        throw new Error('Token from file is expired');
      }

      await this.tokenStore.saveToken(provider, tokenSet);
      logger.info({ provider, filePath }, 'Token synced successfully from file');
    } catch (error: any) {
      logger.error({ provider, filePath, error: error.message }, 'Failed to sync token from file');
      // Don't throw - system should continue running even if sync fails
    }
  }

  /**
   * Start watching token files for changes
   */
  startFileWatcher(filePaths: string[]): void {
    if (this.fileWatcher) {
      logger.warn('File watcher already started');
      return;
    }

    if (filePaths.length === 0) {
      logger.info('No token files to watch');
      return;
    }

    logger.info({ filePaths }, 'Starting file watcher');

    this.fileWatcher = watch(filePaths, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    this.fileWatcher.on('add', async (path) => {
      logger.info({ path }, 'Token file added');
      // Extract provider from file path or use default
      const provider = this.extractProviderFromPath(path);
      await this.syncTokenFromFile(path, provider);
    });

    this.fileWatcher.on('change', async (path) => {
      logger.info({ path }, 'Token file changed');
      const provider = this.extractProviderFromPath(path);
      await this.syncTokenFromFile(path, provider);
    });

    this.fileWatcher.on('error', (error) => {
      logger.error({ error: error.message }, 'File watcher error');
    });

    logger.info('File watcher started successfully');
  }

  /**
   * Stop the file watcher
   */
  async stopFileWatcher(): Promise<void> {
    if (this.fileWatcher) {
      await this.fileWatcher.close();
      this.fileWatcher = undefined;
      logger.info('File watcher stopped');
    }
  }

  /**
   * Extract provider name from file path
   * This is a simple heuristic - can be improved based on actual file naming conventions
   */
  private extractProviderFromPath(path: string): string {
    const fileName = path.toLowerCase();
    
    if (fileName.includes('openai')) {
      return 'openai';
    } else if (fileName.includes('gemini') || fileName.includes('google')) {
      return 'gemini';
    }
    
    // Default to openai if can't determine
    return 'openai';
  }

  /**
   * Get a valid token for a provider, refreshing if necessary
   */
  async getValidToken(provider: string): Promise<TokenSet> {
    const isExpired = await this.tokenStore.isTokenExpired(provider);
    
    if (isExpired) {
      const token = await this.tokenStore.getToken(provider);
      if (token && token.refreshToken) {
        // Try to refresh
        return await this.refreshToken(provider);
      } else {
        throw new Error(`Token expired for provider ${provider} and no refresh token available. Please re-authenticate.`);
      }
    }

    const token = await this.tokenStore.getToken(provider);
    if (!token) {
      throw new Error(`No token found for provider ${provider}. Please authenticate.`);
    }

    return token;
  }
}
