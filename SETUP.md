# Setup Guide - YouTube to Piano Sheet Music

## Complete Installation Instructions

### Step 1: Install Prerequisites

#### 1.1 Node.js (Required)

Download and install Node.js version 16 or higher:
- Visit: https://nodejs.org/
- Download the LTS (Long Term Support) version
- Run the installer and follow the instructions
- Verify installation:
  ```bash
  node --version
  npm --version
  ```

#### 1.2 FFmpeg (REQUIRED - Application will not work without it!)

FFmpeg is essential for audio conversion. Choose your platform:

**Windows:**
1. Download FFmpeg from: https://ffmpeg.org/download.html
   - Or use this direct link: https://github.com/BtbN/FFmpeg-Builds/releases
2. Extract the downloaded archive (e.g., `ffmpeg-master-latest-win64-gpl.zip`)
3. Move the extracted folder to `C:\ffmpeg`
4. Add FFmpeg to PATH:
   - Open "Edit the system environment variables"
   - Click "Environment Variables"
   - Under "System variables", find "Path" and click "Edit"
   - Click "New" and add: `C:\ffmpeg\bin`
   - Click OK on all dialogs
5. Restart your terminal/command prompt
6. Verify installation:
   ```bash
   ffmpeg -version
   ```

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**Linux (Fedora):**
```bash
sudo dnf install ffmpeg
```

### Step 2: Install Application Dependencies

1. Open terminal/command prompt in the project directory

2. Install all Node.js dependencies:
   ```bash
   npm install
   ```

   This will install:
   - Electron (desktop framework)
   - yt-dlp-wrap (YouTube downloader)
   - fluent-ffmpeg (audio processing)
   - @spotify/basic-pitch (AI transcription)
   - vexflow (music notation)
   - puppeteer (PDF generation)
   - And other dependencies

3. Wait for installation to complete (may take 2-5 minutes)

### Step 3: Verify Installation

Run the validation script:
```bash
node validate.js
```

You should see all green checkmarks (✅). If any checks fail, review the error messages.

### Step 4: Launch the Application

```bash
npm start
```

The application window should open. If you see any errors:
- Check that FFmpeg is installed: `ffmpeg -version`
- Verify all dependencies installed: `npm install`
- Check Node.js version: `node --version` (should be 16+)

## First Time Use

1. The first time you download a video, yt-dlp will download its binary (automatic, ~10MB)
2. The first time you transcribe, Basic Pitch will download its AI model (automatic, ~20MB)
3. Subsequent uses will be faster as these are cached

## Testing the Application

### Quick Test

1. Launch the app: `npm start`
2. Use a short piano video URL, for example:
   ```
   https://www.youtube.com/watch?v=[any-piano-video]
   ```
3. Click "변환 시작" (Start Conversion)
4. Wait for the process to complete (2-5 minutes)
5. Check the `output` folder for the generated PDF

### What to Expect

**Processing Time for 3-minute video:**
- Download: 15-30 seconds
- Convert: 5-15 seconds
- Transcribe: 30-120 seconds (depends on computer speed)
- Generate PDF: 10-30 seconds
- **Total: 1-3 minutes**

## Troubleshooting

### "FFmpeg is not installed" Error

**Solution:**
- Make sure FFmpeg is installed
- Verify it's in your system PATH: `ffmpeg -version`
- On Windows, restart your terminal after adding to PATH
- Restart the application

### "Failed to download video" Error

**Possible causes:**
- Internet connection issue
- Invalid YouTube URL
- Video is private or restricted
- Geographic restrictions

**Solutions:**
- Check your internet connection
- Verify the URL is correct and public
- Try a different video

### "Transcription failed" Error

**Possible causes:**
- Audio file is corrupted
- Out of memory (very long videos)
- Basic Pitch model not loaded

**Solutions:**
- Try a shorter video
- Restart the application
- Check available disk space

### Application Won't Start

**Solutions:**
1. Delete `node_modules` folder
2. Run `npm install` again
3. Try running `npm start`

### Permission Errors

**Windows:**
- Run terminal as Administrator
- Check antivirus isn't blocking the app

**macOS/Linux:**
- Check file permissions: `chmod +x node_modules/.bin/*`

## Development Mode

Run with developer tools open:
```bash
npm start
```

The DevTools will automatically open if `NODE_ENV=development`.

## Building for Distribution

To create installers:
```bash
npm run build
```

This will create platform-specific installers in the `dist` folder:
- Windows: `.exe` installer
- macOS: `.dmg` disk image
- Linux: `.AppImage`

## System Requirements

**Minimum:**
- CPU: Dual-core 2.0 GHz
- RAM: 4 GB
- Storage: 500 MB free space
- Internet: Required for downloads

**Recommended:**
- CPU: Quad-core 2.5 GHz or better
- RAM: 8 GB or more
- Storage: 2 GB free space
- Internet: Broadband connection

## File Locations

- **Temp files**: `./temp/` (auto-cleaned)
- **Output PDFs**: `./output/`
- **yt-dlp binary**: `./node_modules/yt-dlp-wrap/bin/`
- **Basic Pitch model**: Downloaded to system cache on first use

## Getting Help

If you encounter issues:

1. Check this SETUP.md guide
2. Read README.md for usage instructions
3. Verify all prerequisites are installed
4. Run `node validate.js` to check project structure
5. Check console logs for error messages

## Performance Tips

- Close other applications to free up memory
- Use shorter videos (under 5 minutes) for faster processing
- Best results with clear piano audio
- Avoid heavily compressed or low-quality audio

## Security Notes

- The app does not collect any data
- All processing happens locally on your computer
- Downloaded videos are automatically deleted after processing
- Only the final PDF is kept in the `output` folder

---

Ready to start? Run `npm start` and enjoy converting YouTube videos to piano sheet music!
