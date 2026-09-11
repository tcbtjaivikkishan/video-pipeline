import * as fs from 'fs';
import * as path from 'path';
import { PipelineConfig } from './config';
import { ZohoAuthService } from './zoho/auth.service';
import { WorkDriveService, WorkDriveFile } from './zoho/workdrive.service';
import { R2StorageService, R2UploadResult } from './storage/r2.service';
import { StateService, ProcessedVideoRecord } from './tracker/state.service';

/**
 * Extract clean class filename (e.g. "CLASS 1.mp4", "CLASS 2.1.mp4", "CLASS 31.mp4")
 */
export function formatVideoKey(fileName: string): string {
  const match = fileName.match(/CLASS\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (match) {
    return `CLASS ${match[1]}.mp4`;
  }
  // Fallback for non-class videos
  const clean = fileName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${clean}.mp4`;
}

export class VideoPipeline {
  private authService: ZohoAuthService;
  private workDriveService: WorkDriveService;
  private r2Service: R2StorageService;
  private stateService: StateService;

  constructor(private config: PipelineConfig) {
    this.authService = new ZohoAuthService(config);
    this.workDriveService = new WorkDriveService(config, this.authService);
    this.r2Service = new R2StorageService(config);
    this.stateService = new StateService();
  }

  /**
   * Process a single video file through the entire pipeline:
   * Download → Upload to R2 → Cleanup → Record State
   */
  async processVideo(video: WorkDriveFile): Promise<ProcessedVideoRecord> {
    console.log(`\n============================================================`);
    console.log(`🎬 Processing: "${video.name}" (ID: ${video.id})`);
    console.log(`📦 WorkDrive Size: ${(video.sizeBytes / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`============================================================`);

    const rawExt = video.extn || 'mp4';
    const tempDir = this.config.automation.tempDir;
    const rawFilePath = path.join(tempDir, `${video.id}_raw.${rawExt}`);

    try {
      // 1. Download from Zoho WorkDrive
      console.log(`\n[1/2] ⬇️ Downloading from WorkDrive...`);
      await this.workDriveService.downloadFile(
        video.id,
        rawFilePath,
        (percent, mb) => {
          process.stdout.write(`\r   Downloading: ${percent}% (${mb.toFixed(1)} MB)`);
        },
      );
      process.stdout.write('\n');

      // 2. Upload to Cloudflare R2
      console.log(`\n[2/2] ☁️ Uploading to Cloudflare R2...`);
      const targetFileName = formatVideoKey(video.name);
      const r2Key = `videos/${targetFileName}`;

      const uploadResult: R2UploadResult = await this.r2Service.uploadVideo(
        rawFilePath,
        r2Key,
        (percent, mb) => {
          process.stdout.write(`\r   Uploading to R2: ${percent}% (${mb.toFixed(1)} MB)`);
        },
      );
      process.stdout.write('\n');

      // 3. Record state in processed-videos.json
      const record: ProcessedVideoRecord = {
        workDriveFileId: video.id,
        fileName: video.name,
        originalSizeBytes: uploadResult.sizeBytes,
        r2Key: uploadResult.r2Key,
        r2Url: uploadResult.r2Url,
        processedAt: new Date().toISOString(),
      };

      this.stateService.recordSuccess(record);

      console.log(`\n✨ Success: "${video.name}" is live at: ${uploadResult.r2Url}`);
      return record;
    } finally {
      // 4. Cleanup local temp file
      this.cleanupFile(rawFilePath);
    }
  }

  /**
   * Scan folder and process all pending videos
   */
  async runFolderSync(limit?: number): Promise<ProcessedVideoRecord[]> {
    console.log(`\n🚀 Starting WorkDrive folder scan...`);
    const allVideos = await this.workDriveService.listFolderVideos();

    // Sort videos numerically by class number (Class 1 -> Class 31)
    allVideos.sort((a, b) => {
      const matchA = a.name.match(/CLASS\s*([0-9]+(?:\.[0-9]+)?)/i);
      const matchB = b.name.match(/CLASS\s*([0-9]+(?:\.[0-9]+)?)/i);
      const numA = matchA ? parseFloat(matchA[1]) : 9999;
      const numB = matchB ? parseFloat(matchB[1]) : 9999;
      return numA - numB;
    });

    // Filter out already processed videos
    const pendingVideos = allVideos.filter(
      (video) => !this.stateService.isProcessed(video.id),
    );

    console.log(
      `📊 Total videos found: ${allVideos.length} | Already processed: ${allVideos.length - pendingVideos.length} | Pending: ${pendingVideos.length}`,
    );

    if (pendingVideos.length === 0) {
      console.log(`🎉 All videos in folder are already processed! Nothing to do.`);
      this.stateService.updateLastRun();
      return [];
    }

    const toProcess = limit && limit > 0 ? pendingVideos.slice(0, limit) : pendingVideos;
    if (limit && limit > 0) {
      console.log(`⚡ Limit flag active: Processing first ${toProcess.length} video(s)...`);
    }

    const processedResults: ProcessedVideoRecord[] = [];

    for (let i = 0; i < toProcess.length; i++) {
      const video = toProcess[i];
      console.log(
        `\n[Item ${i + 1} of ${toProcess.length}] ---------------------------------`,
      );
      try {
        const result = await this.processVideo(video);
        processedResults.push(result);
        // Allow garbage collector to reclaim memory between large video uploads
        if (global.gc) {
          global.gc();
        }
      } catch (err: any) {
        console.error(
          `❌ Failed to process video "${video.name}" (${video.id}):`,
          err.message,
        );
        // Continue with next video
      }
    }

    return processedResults;
  }

  private cleanupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err: any) {
      console.warn(`⚠️ [Cleanup] Could not delete temp file ${filePath}:`, err.message);
    }
  }

  async testConnection(): Promise<void> {
    console.log('\n🔍 Testing Zoho WorkDrive and Cloudflare R2 connections...\n');

    // 1. Test Zoho Auth & WorkDrive
    try {
      console.log('Testing Zoho Access Token...');
      const token = await this.authService.getAccessToken();
      console.log(`✅ Zoho Token valid: ${token.substring(0, 10)}...`);

      console.log(`Testing WorkDrive Folder access (${this.config.zoho.folderId})...`);
      const videos = await this.workDriveService.listFolderVideos();
      console.log(`✅ WorkDrive Folder accessible! Found ${videos.length} video(s).`);
      if (videos.length > 0) {
        videos.slice(0, 3).forEach((v, idx) => {
          console.log(`   ${idx + 1}. ${v.name} (${(v.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
        });
      }
    } catch (err: any) {
      console.error(`❌ Zoho / WorkDrive test failed: ${err.message}`);
    }

    // 2. Test Cloudflare R2
    try {
      console.log('\nTesting Cloudflare R2 connection...');
      const r2Ok = await this.r2Service.testConnection();
      if (r2Ok) {
        console.log(`✅ Cloudflare R2 bucket "${this.config.r2.bucketName}" is accessible!`);
      }
    } catch (err: any) {
      console.error(`❌ Cloudflare R2 test failed: ${err.message}`);
    }
  }
}
