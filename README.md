# 🎬 Automated Video Pipeline (Zoho WorkDrive → FFmpeg → Cloudflare R2)

An automated background service that:
1. Scans your **Zoho WorkDrive Folder** (`TCBT वृक्षायुर्वेद विज्ञान CLASSES`).
2. Detects new/unprocessed videos (~1 GB raw footage).
3. Downloads the video stream automatically.
4. Compresses it with **FFmpeg** (`H.264`, `CRF 23`, `scale 720p/1080p`, `AAC 128k`, and `-movflags +faststart`) to reduce file size by **~90%** (1 GB → ~70–100 MB) and enable instant web/mobile streaming.
5. Uploads directly to **Cloudflare R2** via parallel multipart uploads with **$0 egress fees**.
6. Cleans up temporary disk files and tracks processed items in `processed-videos.json` to prevent duplicate processing.

---

## 🔑 How to Add WorkDrive Scope to Your Zoho Token

Zoho refresh tokens are permanently tied to the scopes granted when the initial authorization code was generated. You cannot edit an existing token in-place; instead, you generate a new authorization code containing **both** your Inventory and WorkDrive scopes, and exchange it for your updated `ZOHO_REFRESH_TOKEN`:

### Step-by-Step Instructions:

1. **Go to Zoho API Console:**
   - Open [https://api-console.zoho.in/](https://api-console.zoho.in/)
   - Click on your existing client application (or **Self Client**).

2. **Generate Code with Both Scopes:**
   - In the **Generate Code** tab, paste the combined scopes into the Scope field:
     ```text
     ZohoInventory.FullAccess.ALL,WorkDrive.files.ALL,WorkDrive.workspace.ALL
     ```
   - Time Duration: Select **10 minutes**.
   - Scope Description: Enter `Inventory and WorkDrive Video Pipeline`.
   - Click **Generate**.
   - Copy the generated code (this is your `code` / grant token).

3. **Exchange for the Refresh Token:**
   Run this `curl` command in your terminal (replace `YOUR_CODE`, `CLIENT_ID`, and `CLIENT_SECRET`):
   ```bash
   curl -X POST https://accounts.zoho.in/oauth/v2/token \
     -d "code=YOUR_CODE" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "grant_type=authorization_code"
   ```
   *Or make a POST request in Postman.*

4. **Copy the new `refresh_token`:**
   The response will contain:
   ```json
   {
     "access_token": "1000....",
     "refresh_token": "1000.xxxx....",
     "api_domain": "https://www.zohoapis.in",
     "token_type": "Bearer",
     "expires_in": 3600
   }
   ```
   This new `refresh_token` can now access **both** Zoho Inventory and Zoho WorkDrive!

---

## ☁️ Cloudflare R2 Credentials Setup

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **R2**.
2. Create a bucket named `product-videos` (or whatever you prefer).
3. Under **Bucket Settings → Public Access**, attach a custom domain (e.g., `media.yourdomain.com`) or enable the `r2.dev` public URL.
4. Go back to R2 Overview → **Manage R2 API Tokens** → **Create API Token**.
   - Permission: **Object Read & Write**
   - Save the:
     - `Account ID`
     - `Access Key ID`
     - `Secret Access Key`

---

## 🚀 Installation & Setup

1. Open terminal in the pipeline folder:
   ```powershell
   cd c:\Users\ASUS\Desktop\server\video-pipeline
   ```

2. Install dependencies:
   ```bash
   npm install
   ```
   *(Note: `ffmpeg-static` is included, which downloads the Windows `ffmpeg.exe` binary automatically inside `node_modules`. You do NOT need to install FFmpeg globally or configure Windows PATH!)*

3. Configure environment variables:
   Copy `.env.example` to `.env`:
   ```powershell
   cp .env.example .env
   ```
   Fill in your credentials. The folder ID `gg2nb30e2f74022da4c78b2a2a21827e18611` for **TCBT वृक्षायुर्वेद विज्ञान CLASSES** is already preset!

---

## 🏃‍♂️ Usage

### 1. Test Connections
Verify that Zoho WorkDrive and Cloudflare R2 are accessible:
```bash
npm run test-connection
```

### 2. Run Once (Batch Process)
Scans the folder, processes all unprocessed videos, and exits:
```bash
npm start
```

### 3. Watch / Daemon Mode (Continuous Automation)
Keeps running in the background and checks for newly uploaded videos every 15 minutes (configurable in `.env` via `POLL_INTERVAL_MINUTES`):
```bash
npm run watch
```

---

## 📁 Deduplication (`processed-videos.json`)

Each successfully processed video is recorded in `processed-videos.json`:
```json
{
  "lastRunAt": "2026-09-11T12:00:00.000Z",
  "videos": {
    "file_resource_id_123": {
      "workDriveFileId": "file_resource_id_123",
      "fileName": "TCBT_Class_01.mp4",
      "originalSizeBytes": 1073741824,
      "compressedSizeBytes": 83886080,
      "compressionRatio": "92.2%",
      "r2Key": "videos/tcbt_class_01_file_res.mp4",
      "r2Url": "https://media.yourdomain.com/videos/tcbt_class_01_file_res.mp4",
      "processedAt": "2026-09-11T12:05:00.000Z"
    }
  }
}
```
Videos recorded here will **never be downloaded or processed again**.

---

## 📱 Frontend Integration (Web & Mobile)

The compressed MP4 files feature `-movflags +faststart`, allowing video to start buffering and playing **instantly** without waiting for the full file to download.

### Web (Next.js / HTML5 `<video>`):
```tsx
<video
  controls
  playsInline
  preload="metadata"
  className="w-full aspect-video rounded-lg"
>
  <source src="https://media.yourdomain.com/videos/tcbt_class_01_file_res.mp4" type="video/mp4" />
</video>
```

### Mobile App (React Native `react-native-video`):
```tsx
import Video from 'react-native-video';

<Video
  source={{ uri: 'https://media.yourdomain.com/videos/tcbt_class_01_file_res.mp4' }}
  controls={true}
  resizeMode="contain"
  bufferConfig={{
    minBufferMs: 2500,
    maxBufferMs: 10000,
    bufferForPlaybackMs: 1500,
  }}
  style={{ width: '100%', height: 240 }}
/>
```
