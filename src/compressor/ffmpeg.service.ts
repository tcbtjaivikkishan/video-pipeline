import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import * as fs from 'fs';
import { PipelineConfig } from '../config';

// Configure FFmpeg binary path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

export interface CompressionResult {
  outputPath: string;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  compressionRatio: string;
  durationSeconds?: number;
}

export class FFmpegCompressorService {
  constructor(private config: PipelineConfig) {}

  /**
   * Compresses a video using H.264 + AAC + +faststart
   */
  async compressVideo(
    inputPath: string,
    outputPath: string,
    onProgress?: (percent: number, fps: number, timeMark: string) => void,
  ): Promise<CompressionResult> {
    const inputStats = fs.statSync(inputPath);
    const originalSizeBytes = inputStats.size;

    console.log(
      `🗜️ [FFmpeg] Starting compression: ${inputPath} (${(originalSizeBytes / (1024 * 1024)).toFixed(1)} MB)`,
    );

    const maxWidth = this.config.compression.maxWidth;
    const crf = this.config.compression.crf;
    const preset = this.config.compression.preset;
    const audioBitrate = this.config.compression.audioBitrate;

    return new Promise((resolve, reject) => {
      let durationSeconds = 0;

      const command = ffmpeg(inputPath)
        .outputOptions([
          `-c:v libx264`,
          `-crf ${crf}`,
          `-preset ${preset}`,
          `-vf scale='min(${maxWidth},iw)':-2`, // Scale down if wider than maxWidth, keep even height
          `-c:a aac`,
          `-b:a ${audioBitrate}`,
          `-movflags +faststart`, // Essential: puts moov atom at beginning for streaming
          `-pix_fmt yuv420p`, // Standard format for maximum mobile compatibility
        ])
        .output(outputPath)
        .on('codecData', (data) => {
          if (data.duration) {
            const parts = data.duration.split(':');
            if (parts.length === 3) {
              durationSeconds =
                parseFloat(parts[0]) * 3600 +
                parseFloat(parts[1]) * 60 +
                parseFloat(parts[2]);
            }
          }
        })
        .on('progress', (progress) => {
          let percent = progress.percent || 0;
          // Calculate percent from timemark if fluent-ffmpeg percent is missing/inaccurate
          if (percent === 0 && durationSeconds > 0 && progress.timemark) {
            const parts = progress.timemark.split(':');
            if (parts.length === 3) {
              const currentSeconds =
                parseFloat(parts[0]) * 3600 +
                parseFloat(parts[1]) * 60 +
                parseFloat(parts[2]);
              percent = Math.min(100, Math.floor((currentSeconds / durationSeconds) * 100));
            }
          }
          if (onProgress) {
            onProgress(Math.floor(percent), progress.currentFps || 0, progress.timemark || '');
          }
        })
        .on('end', () => {
          const outputStats = fs.statSync(outputPath);
          const compressedSizeBytes = outputStats.size;
          const ratio = (
            ((originalSizeBytes - compressedSizeBytes) / originalSizeBytes) *
            100
          ).toFixed(1);

          console.log(
            `✅ [FFmpeg] Compression finished! ${(originalSizeBytes / (1024 * 1024)).toFixed(1)} MB → ${(compressedSizeBytes / (1024 * 1024)).toFixed(1)} MB (${ratio}% reduction)`,
          );

          resolve({
            outputPath,
            originalSizeBytes,
            compressedSizeBytes,
            compressionRatio: `${ratio}%`,
            durationSeconds,
          });
        })
        .on('error', (err: Error) => {
          console.error('❌ [FFmpeg] Error during compression:', err.message);
          reject(err);
        });

      command.run();
    });
  }
}
