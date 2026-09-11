import * as fs from 'fs';
import * as path from 'path';

export interface ProcessedVideoRecord {
  workDriveFileId: string;
  fileName: string;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  compressionRatio: string;
  r2Key: string;
  r2Url: string;
  processedAt: string;
}

interface StateData {
  lastRunAt: string | null;
  videos: Record<string, ProcessedVideoRecord>;
}

export class StateService {
  private stateFilePath: string;
  private state: StateData;

  constructor(baseDir = process.cwd()) {
    this.stateFilePath = path.resolve(baseDir, 'processed-videos.json');
    this.state = this.loadState();
  }

  private loadState(): StateData {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err: any) {
      console.warn(
        `⚠️ [State] Could not read ${this.stateFilePath}, starting with empty state:`,
        err.message,
      );
    }
    return { lastRunAt: null, videos: {} };
  }

  private saveState(): void {
    const tempFile = `${this.stateFilePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this.state, null, 2), 'utf-8');
    fs.renameSync(tempFile, this.stateFilePath);
  }

  isProcessed(fileId: string): boolean {
    return Boolean(this.state.videos[fileId]);
  }

  getRecord(fileId: string): ProcessedVideoRecord | undefined {
    return this.state.videos[fileId];
  }

  recordSuccess(record: ProcessedVideoRecord): void {
    this.state.videos[record.workDriveFileId] = record;
    this.state.lastRunAt = new Date().toISOString();
    this.saveState();
  }

  updateLastRun(): void {
    this.state.lastRunAt = new Date().toISOString();
    this.saveState();
  }

  getAllRecords(): ProcessedVideoRecord[] {
    return Object.values(this.state.videos);
  }
}
