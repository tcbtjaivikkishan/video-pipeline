import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { PipelineConfig } from '../config';
import { ZohoAuthService } from './auth.service';

export interface WorkDriveFile {
  id: string;
  name: string;
  extn: string;
  sizeBytes: number;
  type: string;
  permalink?: string;
}

export class WorkDriveService {
  constructor(
    private config: PipelineConfig,
    private authService: ZohoAuthService,
  ) {}

  /**
   * List all video files inside the specified WorkDrive folder
   */
  async listFolderVideos(folderId?: string): Promise<WorkDriveFile[]> {
    const targetFolder = folderId || this.config.zoho.folderId;
    const token = await this.authService.getAccessToken();

    console.log(`📁 [WorkDrive] Scanning folder ID: ${targetFolder}`);
    const videoFiles: WorkDriveFile[] = [];
    let pageOffset = 0;
    const pageLimit = 50;

    while (true) {
      const url = `${this.config.zoho.workDriveApiUrl}/files/${targetFolder}/files?page%5Boffset%5D=${pageOffset}&page%5Blimit%5D=${pageLimit}`;

      try {
        const response = await axios.get(url, {
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            Accept: 'application/vnd.api+json',
          },
          timeout: 20_000,
        });

        const items = response.data?.data ?? [];
        if (!Array.isArray(items) || items.length === 0) {
          break;
        }

        for (const item of items) {
          const attrs = item.attributes || {};
          const name = attrs.name || '';
          const extn = (attrs.extn || path.extname(name).replace('.', '')).toLowerCase();
          const sizeBytes = attrs.storage_info?.size_in_bytes ?? 0;
          const type = attrs.type || '';

          // Check if this is a video file
          const isVideo =
            type === 'video' ||
            ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv'].includes(extn);

          if (isVideo) {
            videoFiles.push({
              id: item.id,
              name,
              extn,
              sizeBytes,
              type,
              permalink: attrs.permalink,
            });
          }
        }

        const hasMore = items.length >= pageLimit;
        if (!hasMore) break;
        pageOffset += pageLimit;
      } catch (err: any) {
        if (err.response?.status === 401) {
          console.warn('⚠️ [WorkDrive] 401 Unauthorized, clearing token cache...');
          this.authService.clearTokenCache();
        }
        const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`Failed to list WorkDrive files: ${msg}`);
      }
    }

    console.log(`🎬 [WorkDrive] Found ${videoFiles.length} video files in folder`);
    return videoFiles;
  }

  /**
   * Stream download a file from WorkDrive to a local destination with strict backpressure
   * to keep memory consumption virtually flat (< 5 MB) regardless of file size.
   */
  async downloadFile(
    fileId: string,
    destinationPath: string,
    onProgress?: (progressPercent: number, downloadedMb: number) => void,
  ): Promise<string> {
    const token = await this.authService.getAccessToken();
    const downloadUrl = `${this.config.zoho.workDriveApiUrl}/download/${fileId}`;

    console.log(`⬇️ [WorkDrive] Starting download for file ID: ${fileId}`);

    const response = await axios.get(downloadUrl, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
      },
      responseType: 'stream',
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 300_000,
    });

    const contentLengthHeader = response.headers['content-length'];
    const totalBytes = parseInt(String(contentLengthHeader || '0'), 10);
    let downloadedBytes = 0;
    let lastReportedPercent = -1;

    const tempDownloadPath = `${destinationPath}.tmp`;
    const writer = fs.createWriteStream(tempDownloadPath);

    // Transform stream tracks bytes and progress without breaking backpressure
    const progressTracker = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        downloadedBytes += chunk.length;
        if (totalBytes > 0 && onProgress) {
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);
          if (percent !== lastReportedPercent && percent % 5 === 0) {
            lastReportedPercent = percent;
            const mb = downloadedBytes / (1024 * 1024);
            onProgress(percent, mb);
          }
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(response.data, progressTracker, writer);
      if (fs.existsSync(destinationPath)) {
        fs.unlinkSync(destinationPath);
      }
      fs.renameSync(tempDownloadPath, destinationPath);
      console.log(`\n✅ [WorkDrive] Download completed: ${destinationPath}`);
      return destinationPath;
    } catch (err: any) {
      console.error('\n❌ [WorkDrive] Download stream error:', err.message);
      // Clean up partial file on failure
      try {
        if (fs.existsSync(tempDownloadPath)) {
          fs.unlinkSync(tempDownloadPath);
        }
      } catch {}
      throw err;
    }
  }
}
