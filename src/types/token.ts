/**
 * Token and TokenStore type definitions
 */

/**
 * Information returned from OAuth device flow initiation
 */
export interface DeviceFlowInfo {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}

/**
 * Represents a set of OAuth tokens for a provider
 */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp in milliseconds
  provider: string;
}

/**
 * Interface for token storage operations
 */
export interface TokenStore {
  /**
   * Save a token set for a provider
   */
  saveToken(provider: string, tokenSet: TokenSet): Promise<void>;

  /**
   * Retrieve a token set for a provider
   */
  getToken(provider: string): Promise<TokenSet | null>;

  /**
   * Delete a token set for a provider
   */
  deleteToken(provider: string): Promise<void>;

  /**
   * Retrieve all stored tokens
   */
  getAllTokens(): Promise<Map<string, TokenSet>>;

  /**
   * Check if a token is expired
   */
  isTokenExpired(provider: string): Promise<boolean>;
}
