import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { AuthManager } from '../src/auth/auth-manager.js';
import { FileTokenStore } from '../src/auth/token-store.js';
import type { TokenSet, ProviderConfig } from '../src/types/index.js';
import axios from 'axios';
import { promises as fs } from 'fs';

vi.mock('axios');
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn()
  }
}));

describe('AuthManager', () => {
  let authManager: AuthManager;
  let tokenStore: FileTokenStore;
  const testProviders: Record<string, ProviderConfig> = {
    openai: {
      enabled: true,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      authEndpoint: 'https://auth.openai.com/device',
      tokenEndpoint: 'https://auth.openai.com/token',
      apiEndpoint: 'https://api.openai.com'
    },
    gemini: {
      enabled: true,
      clientId: 'gemini-client-id',
      apiEndpoint: 'https://api.gemini.com'
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tokenStore = new FileTokenStore('/tmp/test-tokens.json');
    authManager = new AuthManager(tokenStore, testProviders);
  });

  describe('initiateDeviceFlow', () => {
    it('should initiate device flow successfully', async () => {
      const mockResponse = {
        data: {
          device_code: 'test-device-code',
          user_code: 'TEST-CODE',
          verification_uri: 'https://auth.openai.com/verify',
          expires_in: 900
        }
      };

      vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

      const result = await authManager.initiateDeviceFlow('openai');

      expect(result).toEqual({
        deviceCode: 'test-device-code',
        userCode: 'TEST-CODE',
        verificationUrl: 'https://auth.openai.com/verify',
        expiresIn: 900
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://auth.openai.com/device',
        expect.objectContaining({
          client_id: 'test-client-id'
        }),
        expect.any(Object)
      );
    });

    it('should throw error for disabled provider', async () => {
      const disabledProviders = {
        openai: { ...testProviders.openai, enabled: false }
      };
      const manager = new AuthManager(tokenStore, disabledProviders);

      await expect(manager.initiateDeviceFlow('openai')).rejects.toThrow('Provider openai is disabled');
    });

    it('should throw error for unconfigured provider', async () => {
      await expect(authManager.initiateDeviceFlow('unknown')).rejects.toThrow('Provider unknown not configured');
    });
  });

  describe('completeDeviceFlow', () => {
    it('should complete device flow successfully', async () => {
      const mockResponse = {
        data: {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600
        }
      };

      vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);
      vi.mocked(fs.readFile).mockResolvedValue('{}');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await authManager.completeDeviceFlow('openai', 'test-device-code');

      expect(result.accessToken).toBe('test-access-token');
      expect(result.refreshToken).toBe('test-refresh-token');
      expect(result.provider).toBe('openai');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should handle authorization_pending and retry', async () => {
      const pendingError = {
        response: {
          data: {
            error: 'authorization_pending'
          }
        }
      };

      const successResponse = {
        data: {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600
        }
      };

      vi.mocked(axios.post)
        .mockRejectedValueOnce(pendingError)
        .mockResolvedValueOnce(successResponse);

      vi.mocked(fs.readFile).mockResolvedValue('{}');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await authManager.completeDeviceFlow('openai', 'test-device-code');

      expect(result.accessToken).toBe('test-access-token');
      expect(axios.post).toHaveBeenCalledTimes(2);
    }, 10000); // Increase timeout to 10 seconds
  });

  describe('refreshToken', () => {
    it('should refresh token successfully', async () => {
      const existingToken: TokenSet = {
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1000,
        provider: 'openai'
      };

      // First call for getToken, second for saveToken persist
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ openai: existingToken }))
        .mockResolvedValue(JSON.stringify({ openai: existingToken }));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const mockResponse = {
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        }
      };

      vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

      const result = await authManager.refreshToken('openai');

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.provider).toBe('openai');
    });

    it('should throw error if no token exists', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{}');

      await expect(authManager.refreshToken('openai')).rejects.toThrow('No token found for provider openai');
    });

    it('should throw error if no refresh token available', async () => {
      const tokenWithoutRefresh: TokenSet = {
        accessToken: 'old-token',
        expiresAt: Date.now() - 1000,
        provider: 'openai'
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ openai: tokenWithoutRefresh }));

      await expect(authManager.refreshToken('openai')).rejects.toThrow('No refresh token available');
    });
  });

  describe('syncTokenFromFile', () => {
    it('should sync valid token from file', async () => {
      const tokenData = {
        access_token: 'file-access-token',
        refresh_token: 'file-refresh-token',
        expires_at: Date.now() + 3600000
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(tokenData));
      vi.mocked(fs.readFile).mockResolvedValue('{}');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await authManager.syncTokenFromFile('/path/to/token.json', 'openai');

      const token = await tokenStore.getToken('openai');
      expect(token?.accessToken).toBe('file-access-token');
    });

    it('should not throw error for invalid token file', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('File not found'));

      // Should not throw
      await expect(authManager.syncTokenFromFile('/invalid/path.json', 'openai')).resolves.toBeUndefined();
    });
  });

  describe('getValidToken', () => {
    it('should return valid token if not expired', async () => {
      const validToken: TokenSet = {
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
        provider: 'openai'
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ openai: validToken }));

      const result = await authManager.getValidToken('openai');

      expect(result.accessToken).toBe('valid-token');
    });

    it('should refresh token if expired', async () => {
      const expiredToken: TokenSet = {
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1000,
        provider: 'openai'
      };

      // Multiple calls: isTokenExpired, getToken in refreshToken, saveToken persist
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ openai: expiredToken }))
        .mockResolvedValueOnce(JSON.stringify({ openai: expiredToken }))
        .mockResolvedValue(JSON.stringify({ openai: expiredToken }));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const mockResponse = {
        data: {
          access_token: 'refreshed-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        }
      };

      vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

      const result = await authManager.getValidToken('openai');

      expect(result.accessToken).toBe('refreshed-token');
    });
  });

  describe('property-based tests', () => {
    /**
     * Feature: llm-gateway, Property 2: Expired token auto-refresh
     * For all expired tokens with valid refresh tokens, refreshing produces a new valid token.
     */
    it('Property 2: expired token auto-refresh', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            accessToken: fc.string({ minLength: 1, maxLength: 100 }),
            refreshToken: fc.string({ minLength: 1, maxLength: 100 }),
            expiresIn: fc.integer({ min: 60, max: 86400 }),
          }),
          async ({ accessToken, refreshToken, expiresIn }) => {
            vi.clearAllMocks();

            const expiredToken: TokenSet = {
              accessToken: 'expired-token',
              refreshToken: 'valid-refresh',
              expiresAt: Date.now() - 1000,
              provider: 'openai',
            };

            vi.mocked(fs.readFile)
              .mockResolvedValueOnce(JSON.stringify({ openai: expiredToken }))
              .mockResolvedValueOnce(JSON.stringify({ openai: expiredToken }))
              .mockResolvedValue(JSON.stringify({ openai: expiredToken }));
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);
            vi.mocked(fs.writeFile).mockResolvedValue(undefined);

            vi.mocked(axios.post).mockResolvedValueOnce({
              data: {
                access_token: accessToken,
                refresh_token: refreshToken,
                expires_in: expiresIn,
              },
            });

            const result = await authManager.refreshToken('openai');
            expect(result.accessToken).toBe(accessToken);
            expect(result.expiresAt).toBeGreaterThan(Date.now());
          }
        ),
        { numRuns: 20 }
      );
    });

    /**
     * Feature: llm-gateway, Property 3: File sync imports valid token
     * For all valid token files, syncing imports the token into the store.
     */
    it('Property 3: file sync imports valid token', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            access_token: fc.string({ minLength: 1, maxLength: 100 }),
            refresh_token: fc.string({ minLength: 1, maxLength: 100 }),
            expires_at: fc.integer({ min: Date.now() + 10000, max: Date.now() + 86400000 }),
          }),
          async (tokenData) => {
            vi.mocked(fs.readFile).mockReset();
            vi.mocked(fs.mkdir).mockReset();
            vi.mocked(fs.writeFile).mockReset();

            vi.mocked(fs.readFile)
              .mockResolvedValueOnce(JSON.stringify(tokenData))
              .mockResolvedValue('{}');
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);
            vi.mocked(fs.writeFile).mockResolvedValue(undefined);

            // Create fresh instances to avoid stale initialization state
            const freshStore = new FileTokenStore('/tmp/test-tokens.json');
            const freshManager = new AuthManager(freshStore, testProviders);

            await freshManager.syncTokenFromFile('/path/to/token.json', 'openai');

            // Verify token was stored in memory
            const saved = await freshStore.getToken('openai');
            expect(saved).not.toBeNull();
            expect(saved?.accessToken).toBe(tokenData.access_token);
          }
        ),
        { numRuns: 20 }
      );
    });

    /**
     * Feature: llm-gateway, Property 4: Invalid token handling continues
     * For all invalid token data, sync fails gracefully without throwing.
     */
    it('Property 4: invalid token handling continues system execution', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.constant('not-json'),
            fc.constant('{}'),
            fc.constant('{"foo": "bar"}'),
            fc.constant('null'),
            fc.string(),
          ),
          async (invalidContent) => {
            vi.clearAllMocks();

            vi.mocked(fs.readFile).mockResolvedValueOnce(invalidContent);

            // Should not throw - system continues running
            await expect(
              authManager.syncTokenFromFile('/invalid/path.json', 'openai')
            ).resolves.toBeUndefined();
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
