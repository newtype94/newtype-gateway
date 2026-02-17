import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import fc from 'fast-check';
import { FileTokenStore } from '../src/auth/token-store.js';
import type { TokenSet } from '../src/types/token.js';

describe('FileTokenStore', () => {
  const testDir = join(process.cwd(), 'tests', '.test-data');
  const testFilePath = join(testDir, 'tokens-test.json');
  let store: FileTokenStore;

  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });
    store = new FileTokenStore(testFilePath);
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('saveToken and getToken', () => {
    it('should save and retrieve a token', async () => {
      const tokenSet: TokenSet = {
        provider: 'openai',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
      };

      await store.saveToken('openai', tokenSet);
      const retrieved = await store.getToken('openai');

      expect(retrieved).toEqual(tokenSet);
    });

    it('should return null for non-existent provider', async () => {
      const retrieved = await store.getToken('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should overwrite existing token', async () => {
      const tokenSet1: TokenSet = {
        provider: 'openai',
        accessToken: 'token-1',
        expiresAt: Date.now() + 3600000,
      };

      const tokenSet2: TokenSet = {
        provider: 'openai',
        accessToken: 'token-2',
        refreshToken: 'refresh-2',
        expiresAt: Date.now() + 7200000,
      };

      await store.saveToken('openai', tokenSet1);
      await store.saveToken('openai', tokenSet2);
      
      const retrieved = await store.getToken('openai');
      expect(retrieved).toEqual(tokenSet2);
    });
  });

  describe('deleteToken', () => {
    it('should delete a token', async () => {
      const tokenSet: TokenSet = {
        provider: 'gemini',
        accessToken: 'test-token',
        expiresAt: Date.now() + 3600000,
      };

      await store.saveToken('gemini', tokenSet);
      await store.deleteToken('gemini');
      
      const retrieved = await store.getToken('gemini');
      expect(retrieved).toBeNull();
    });

    it('should not throw when deleting non-existent token', async () => {
      await expect(store.deleteToken('non-existent')).resolves.not.toThrow();
    });
  });

  describe('getAllTokens', () => {
    it('should return all stored tokens', async () => {
      const token1: TokenSet = {
        provider: 'openai',
        accessToken: 'token-1',
        expiresAt: Date.now() + 3600000,
      };

      const token2: TokenSet = {
        provider: 'gemini',
        accessToken: 'token-2',
        expiresAt: Date.now() + 3600000,
      };

      await store.saveToken('openai', token1);
      await store.saveToken('gemini', token2);

      const allTokens = await store.getAllTokens();
      
      expect(allTokens.size).toBe(2);
      expect(allTokens.get('openai')).toEqual(token1);
      expect(allTokens.get('gemini')).toEqual(token2);
    });

    it('should return empty map when no tokens exist', async () => {
      const allTokens = await store.getAllTokens();
      expect(allTokens.size).toBe(0);
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for valid token', async () => {
      const tokenSet: TokenSet = {
        provider: 'openai',
        accessToken: 'test-token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
      };

      await store.saveToken('openai', tokenSet);
      const expired = await store.isTokenExpired('openai');
      
      expect(expired).toBe(false);
    });

    it('should return true for expired token', async () => {
      const tokenSet: TokenSet = {
        provider: 'openai',
        accessToken: 'test-token',
        expiresAt: Date.now() - 1000, // 1 second ago
      };

      await store.saveToken('openai', tokenSet);
      const expired = await store.isTokenExpired('openai');
      
      expect(expired).toBe(true);
    });

    it('should return true for non-existent token', async () => {
      const expired = await store.isTokenExpired('non-existent');
      expect(expired).toBe(true);
    });
  });

  describe('persistence', () => {
    it('should persist tokens across instances', async () => {
      const tokenSet: TokenSet = {
        provider: 'openai',
        accessToken: 'persistent-token',
        refreshToken: 'persistent-refresh',
        expiresAt: Date.now() + 3600000,
      };

      await store.saveToken('openai', tokenSet);

      // Create a new instance pointing to the same file
      const newStore = new FileTokenStore(testFilePath);
      const retrieved = await newStore.getToken('openai');

      expect(retrieved).toEqual(tokenSet);
    });
  });

  describe('property-based tests', () => {
    /**
     * Feature: llm-gateway, Property 1: Token storage round-trip
     * For all valid token sets, saving then retrieving produces the same data.
     */
    it('Property 1: token storage round-trip', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            accessToken: fc.string({ minLength: 1, maxLength: 200 }),
            refreshToken: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
            expiresAt: fc.integer({ min: Date.now(), max: Date.now() + 86400000 }),
            provider: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
          }),
          async (tokenSet) => {
            const providerKey = tokenSet.provider;
            await store.saveToken(providerKey, tokenSet as TokenSet);
            const retrieved = await store.getToken(providerKey);
            expect(retrieved).toEqual(tokenSet);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
