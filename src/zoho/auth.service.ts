import axios from 'axios';
import { PipelineConfig } from '../config';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
const EXPIRY_BUFFER_MS = 2 * 60 * 1000; // Refresh 2 minutes before actual expiry

export class ZohoAuthService {
  constructor(private config: PipelineConfig) {}

  async getAccessToken(): Promise<string> {
    if (tokenCache && Date.now() < tokenCache.expiresAt) {
      return tokenCache.accessToken;
    }

    console.log('🔑 [Zoho Auth] Requesting new access token...');

    const params = new URLSearchParams({
      refresh_token: this.config.zoho.refreshToken,
      client_id: this.config.zoho.clientId,
      client_secret: this.config.zoho.clientSecret,
      grant_type: 'refresh_token',
    });

    try {
      const response = await axios.post(
        `${this.config.zoho.accountsUrl}/oauth/v2/token`,
        params.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15_000,
        },
      );

      const data = response.data;
      if (!data.access_token) {
        throw new Error(`Zoho OAuth failed: ${JSON.stringify(data)}`);
      }

      const expiresInMs = (data.expires_in ?? 3600) * 1000;
      tokenCache = {
        accessToken: data.access_token,
        expiresAt: Date.now() + expiresInMs - EXPIRY_BUFFER_MS,
      };

      console.log('✅ [Zoho Auth] Access token refreshed successfully');
      return tokenCache.accessToken;
    } catch (err: any) {
      const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Failed to refresh Zoho token: ${msg}`);
    }
  }

  clearTokenCache(): void {
    tokenCache = null;
  }
}
