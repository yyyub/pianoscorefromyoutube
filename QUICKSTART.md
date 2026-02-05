# Quick Start Guide

## ⚡ Get Started in 5 Minutes

### Prerequisites Checklist

Before you start, make sure you have:

- [ ] Node.js installed (version 16+)
  - Check: `node --version`
  - Install: https://nodejs.org/

- [ ] FFmpeg installed (REQUIRED!)
  - Check: `ffmpeg -version`
  - Install: https://ffmpeg.org/download.html
  - **Windows**: Add to PATH after installing
  - **macOS**: `brew install ffmpeg`
  - **Linux**: `sudo apt-get install ffmpeg`

- [ ] Internet connection (for downloads)

### Installation Steps

```bash
# 1. Navigate to project directory
cd D:\music

# 2. Install dependencies (if not already done)
npm install

# 3. Verify setup
node validate.js

# 4. Launch the app
npm start
```

### First Test Run

1. **Launch the app**
   ```bash
   npm start
   ```

2. **Enter a YouTube URL**
   - Example: Any piano video URL
   - Format: `https://www.youtube.com/watch?v=...`

3. **Click "변환 시작" (Start Conversion)**

4. **Wait for processing** (2-5 minutes)
   - Step 1: Downloading video...
   - Step 2: Converting to MP3...
   - Step 3: AI transcription... (longest step)
   - Step 4: Generating PDF...

5. **View the result**
   - PDF will open automatically
   - Or check the `output` folder

### Troubleshooting First Run

#### "FFmpeg is not installed"
```bash
# Verify FFmpeg is in PATH
ffmpeg -version

# If not found:
# Windows: Add C:\ffmpeg\bin to PATH, restart terminal
# macOS/Linux: Install FFmpeg, restart terminal
```

#### App won't start
```bash
# Reinstall dependencies
rm -rf node_modules
npm install

# Try again
npm start
```

#### Download fails
- Check internet connection
- Verify YouTube URL is valid and public
- Try a different video

### What Happens on First Run?

1. **yt-dlp download** (~10MB)
   - Downloads automatically
   - Cached for future use

2. **Basic Pitch model** (~20MB)
   - Downloads on first transcription
   - Cached for future use

3. **These only happen ONCE!**
   - Future runs will be faster

### Expected Processing Times

| Video Length | Download | Convert | Transcribe | Generate | Total   |
|--------------|----------|---------|------------|----------|---------|
| 1 minute     | 10s      | 5s      | 15s        | 10s      | ~40s    |
| 3 minutes    | 20s      | 10s     | 60s        | 15s      | ~2m     |
| 5 minutes    | 30s      | 15s     | 120s       | 20s      | ~3m     |

*Times vary based on internet speed and computer performance*

### File Locations

```
D:\music\
├── temp\           → Temporary files (auto-deleted)
├── output\         → Your PDF files are here! 📄
└── node_modules\   → Dependencies
```

### Tips for Best Results

✅ **DO:**
- Use piano-only videos
- Use clear, high-quality audio
- Use videos under 5 minutes (for faster processing)
- Check that FFmpeg is installed first

❌ **DON'T:**
- Use heavily mixed music (poor transcription)
- Use videos longer than 10 minutes (slow)
- Close the app during processing
- Delete files from `temp` while processing

### Quick Commands

```bash
# Start the app
npm start

# Validate setup
node validate.js

# Build installer
npm run build

# Check FFmpeg
ffmpeg -version

# Check Node.js
node --version
```

### Help & Documentation

- **README.md** - Full user guide
- **SETUP.md** - Detailed installation
- **DEVELOPMENT.md** - Developer guide
- **PROJECT_STATUS.md** - Implementation status

### Common First-Time Questions

**Q: How long does it take?**
A: 2-5 minutes for a 3-minute video

**Q: Do I need to install anything else?**
A: Just FFmpeg (critical!)

**Q: Where are my PDFs saved?**
A: In the `output` folder

**Q: Can I cancel during processing?**
A: Yes, click the "취소" (Cancel) button

**Q: Does this work offline?**
A: No, internet required for downloads

**Q: Is my data private?**
A: Yes, everything runs locally on your computer

### Success Checklist

After your first successful run:

- [ ] App launched without errors
- [ ] Downloaded a YouTube video
- [ ] Saw progress through all 4 steps
- [ ] PDF generated in `output` folder
- [ ] PDF opened and showed sheet music
- [ ] Temp files were cleaned up

### Next Steps

Once you've completed a successful test:

1. Try different piano videos
2. Experiment with various styles
3. Check the generated PDFs
4. Report any issues or improvements

---

## 🎹 Ready? Let's Go!

```bash
npm start
```

**Paste a YouTube URL and watch the magic happen!** ✨

---

Need help? Check **SETUP.md** for detailed troubleshooting.
