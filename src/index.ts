import { loadConfig } from './config';
import { VideoPipeline } from './pipeline';

async function main() {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const isWatch = args.includes('--watch');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     🎬 ZOHO WORKDRIVE → CLOUDFLARE R2 PIPELINE            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  let config;
  try {
    config = loadConfig();
  } catch (err: any) {
    console.error(`\n❌ Configuration Error: ${err.message}`);
    console.error(`👉 Please copy .env.example to .env and fill in your credentials.\n`);
    process.exit(1);
  }

  const pipeline = new VideoPipeline(config);

  if (isTest) {
    await pipeline.testConnection();
    return;
  }

  if (isWatch) {
    const intervalMinutes = config.automation.pollIntervalMinutes;
    console.log(
      `\n👀 Watch mode enabled: Checking folder every ${intervalMinutes} minute(s)...`,
    );

    const runLoop = async () => {
      try {
        await pipeline.runFolderSync();
      } catch (err: any) {
        console.error('❌ Pipeline run error:', err.message);
      }
      console.log(
        `\n⏳ Next check in ${intervalMinutes} minute(s) at ${new Date(Date.now() + intervalMinutes * 60 * 1000).toLocaleTimeString()}...`,
      );
    };

    // Run immediately once
    await runLoop();

    // Schedule recurring runs
    setInterval(runLoop, intervalMinutes * 60 * 1000);
    return;
  }

  // Parse --limit N or --limit=N
  let limit: number | undefined;
  const limitIdx = args.findIndex((a) => a === '--limit' || a.startsWith('--limit='));
  if (limitIdx !== -1) {
    const val = args[limitIdx].includes('=')
      ? args[limitIdx].split('=')[1]
      : args[limitIdx + 1];
    if (val && !isNaN(parseInt(val, 10))) {
      limit = parseInt(val, 10);
    }
  }

  // Single-run mode
  try {
    const results = await pipeline.runFolderSync(limit);
    if (results.length > 0) {
      console.log(`\n============================================================`);
      console.log(`🎉 Pipeline run completed! Processed ${results.length} video(s):`);
      results.forEach((r, idx) => {
        const mb = (r.originalSizeBytes / (1024 * 1024)).toFixed(1);
        const sizeInfo = r.compressedSizeBytes
          ? `${mb}MB → ${(r.compressedSizeBytes / (1024 * 1024)).toFixed(1)}MB (-${r.compressionRatio})`
          : `${mb}MB`;
        console.log(
          ` ${idx + 1}. ${r.fileName} (${sizeInfo})\n    URL: ${r.r2Url}`,
        );
      });
      console.log(`============================================================\n`);
    }
  } catch (err: any) {
    console.error(`\n❌ Pipeline execution failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
