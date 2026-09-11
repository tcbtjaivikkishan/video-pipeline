import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from current directory
dotenv.config();

export interface PipelineConfig {
  zoho: {
    accountsUrl: string;
    workDriveApiUrl: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    folderId: string;
  };
  r2: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    publicDomain: string;
  };
  compression: {
    maxWidth: number;
    crf: number;
    preset: string;
    audioBitrate: string;
  };
  automation: {
    pollIntervalMinutes: number;
    tempDir: string;
  };
}

function getEnv(key: string, defaultValue?: string): string {
  const value = (process.env[key] || defaultValue || '').trim();
  if (!value || value === 'CHANGE_ME' || value.includes('your_') || value.includes('XXXXX')) {
    throw new Error(
      `Environment variable '${key}' is missing or still set to placeholder in .env. Please update it with your actual value.`,
    );
  }
  return value;
}

export function loadConfig(): PipelineConfig {
  const tempDir = path.resolve(process.env.TEMP_DIR || './temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  return {
    zoho: {
      accountsUrl: process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in',
      workDriveApiUrl:
        process.env.ZOHO_WORKDRIVE_API_URL || 'https://workdrive.zoho.in/api/v1',
      clientId: getEnv('ZOHO_CLIENT_ID', 'CHANGE_ME'),
      clientSecret: getEnv('ZOHO_CLIENT_SECRET', 'CHANGE_ME'),
      refreshToken: getEnv('ZOHO_REFRESH_TOKEN', 'CHANGE_ME'),
      folderId: getEnv(
        'ZOHO_WORKDRIVE_FOLDER_ID',
        'gg2nb30e2f74022da4c78b2a2a21827e18611',
      ),
    },
    r2: {
      accountId: getEnv('CLOUDFLARE_ACCOUNT_ID', 'CHANGE_ME'),
      accessKeyId: getEnv('R2_ACCESS_KEY_ID', 'CHANGE_ME'),
      secretAccessKey: getEnv('R2_SECRET_ACCESS_KEY', 'CHANGE_ME'),
      bucketName: getEnv('R2_BUCKET_NAME', 'product-videos'),
      publicDomain: process.env.R2_PUBLIC_DOMAIN || '',
    },
    compression: {
      maxWidth: parseInt(process.env.VIDEO_MAX_WIDTH || '1280', 10),
      crf: parseInt(process.env.VIDEO_CRF || '23', 10),
      preset: process.env.VIDEO_PRESET || 'medium',
      audioBitrate: process.env.AUDIO_BITRATE || '128k',
    },
    automation: {
      pollIntervalMinutes: parseInt(
        process.env.POLL_INTERVAL_MINUTES || '15',
        10,
      ),
      tempDir,
    },
  };
}
