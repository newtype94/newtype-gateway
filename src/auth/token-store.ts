import { promises as fs } from 'fs';
import { dirname } from 'path';
import type { TokenStore, TokenSet } from '../types/token.js';

/**
 * File-based implementation of TokenStore
 * Stores tokens in a JSON file on the local filesystem
 */
export class FileTokenStore implements TokenStore {
  private filePath: string;
  private tokens: Map<string, TokenSet>;
  private initialized: boolean = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.tokens = new Map();
  }

  /**
   * Initialize the token store by loading existing tokens from file
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Convert the stored object back to a Map
      if (parsed && typeof parsed === 'object') {
        for (const [provider, tokenSet] of Object.entries(parsed)) {
          this.tokens.set(provider, tokenSet as TokenSet);
        }
      }
    } catch (error: any) {
      // If file doesn't exist or is invalid, start with empty store
      if (error.code !== 'ENOENT') {
        console.warn(`Failed to load tokens from ${this.filePath}:`, error.message);
      }
    }

    this.initialized = true;
  }

  /**
   * Persist the current tokens to file
   */
  private async persist(): Promise<void> {
    // Convert Map to plain object for JSON serialization
    const tokensObject = Object.fromEntries(this.tokens);
    const data = JSON.stringify(tokensObject, null, 2);

    // Ensure directory exists
    const dir = dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write to file
    await fs.writeFile(this.filePath, data, 'utf-8');
  }

  async saveToken(provider: string, tokenSet: TokenSet): Promise<void> {
    await this.initialize();
    this.tokens.set(provider, tokenSet);
    await this.persist();
  }

  async getToken(provider: string): Promise<TokenSet | null> {
    await this.initialize();
    return this.tokens.get(provider) || null;
  }

  async deleteToken(provider: string): Promise<void> {
    await this.initialize();
    this.tokens.delete(provider);
    await this.persist();
  }

  async getAllTokens(): Promise<Map<string, TokenSet>> {
    await this.initialize();
    // Return a copy to prevent external modifications
    return new Map(this.tokens);
  }

  async isTokenExpired(provider: string): Promise<boolean> {
    await this.initialize();
    const tokenSet = this.tokens.get(provider);
    
    if (!tokenSet) {
      return true; // No token means it's "expired"
    }

    // Check if current time is past the expiration time
    return Date.now() >= tokenSet.expiresAt;
  }
}
