import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs';
import { PipelineConfig } from '../config';

export interface R2UploadResult {
  r2Key: string;
  r2Url: string;
  sizeBytes: number;
}

export class R2StorageService {
  private s3Client: S3Client;

  constructor(private config: PipelineConfig) {
    const endpoint = `https://${this.config.r2.accountId}.r2.cloudflarestorage.com`;

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: this.config.r2.accessKeyId,
        secretAccessKey: this.config.r2.secretAccessKey,
      },
    });
  }

  /**
   * Test bucket connectivity
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.config.r2.bucketName }),
      );
      return true;
    } catch (err: any) {
      console.error(
        `❌ [R2 Storage] Connection check failed: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Multipart upload a video to Cloudflare R2
   */
  async uploadVideo(
    filePath: string,
    key: string,
    onProgress?: (progressPercent: number, uploadedMb: number) => void,
  ): Promise<R2UploadResult> {
    const fileStats = fs.statSync(filePath);
    const totalBytes = fileStats.size;
    const fileStream = fs.createReadStream(filePath);

    console.log(
      `☁️ [R2 Storage] Starting upload of ${key} (${(totalBytes / (1024 * 1024)).toFixed(1)} MB)...`,
    );

    const uploader = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.config.r2.bucketName,
        Key: key,
        Body: fileStream,
        ContentType: 'video/mp4',
        CacheControl: 'public, max-age=31536000, immutable',
      },
      queueSize: 2, // Keep concurrency at 2 to minimize memory usage
      partSize: 5 * 1024 * 1024, // 5 MB per part (S3 minimum) to minimize RAM footprint
      leavePartsOnError: false,
    });

    let lastReportedPercent = -1;

    uploader.on('httpUploadProgress', (progress) => {
      const loaded = progress.loaded || 0;
      const percent = Math.floor((loaded / totalBytes) * 100);
      if (percent !== lastReportedPercent && percent % 10 === 0) {
        lastReportedPercent = percent;
        const mb = loaded / (1024 * 1024);
        if (onProgress) onProgress(percent, mb);
      }
    });

    try {
      await uploader.done();
    } finally {
      fileStream.destroy();
    }

    // Determine public URL
    const publicDomain = this.config.r2.publicDomain.replace(/\/$/, '');
    const r2Url = publicDomain
      ? `${publicDomain}/${key}`
      : `https://${this.config.r2.accountId}.r2.cloudflarestorage.com/${this.config.r2.bucketName}/${key}`;

    console.log(`✅ [R2 Storage] Upload finished: ${r2Url}`);

    return {
      r2Key: key,
      r2Url,
      sizeBytes: totalBytes,
    };
  }
}
