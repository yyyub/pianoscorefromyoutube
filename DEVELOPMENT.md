# Development Guide

## Architecture Overview

### Application Flow

```
User Input (YouTube URL)
    ↓
Renderer Process (UI)
    ↓ IPC Communication
Main Process (ipc-handlers.js)
    ↓
Pipeline Execution:
    1. youtube-downloader.js → Downloads video
    2. audio-converter.js → Converts to MP3
    3. transcriber.js → AI transcription to MIDI
    4. sheet-generator.js → Generates PDF
    ↓
file-manager.js → Cleanup & Save
    ↓
Renderer Process → Display Result
```

### Process Architecture

**Main Process (Node.js)**
- Handles all file system operations
- Manages external processes (yt-dlp, ffmpeg)
- Runs AI models (Basic Pitch)
- Coordinates the entire pipeline

**Renderer Process (Browser)**
- User interface (HTML/CSS/JS)
- No direct file access (security)
- Communicates via IPC bridge (preload.js)

### Security Model

- `nodeIntegration: false` - Renderer has no Node.js access
- `contextIsolation: true` - Separate contexts
- `preload.js` - Secure IPC bridge using contextBridge
- All inputs validated before processing

## Key Files Explained

### 1. main.js
**Purpose:** Electron application entry point

**Responsibilities:**
- Create BrowserWindow
- Initialize directories
- Load IPC handlers
- Cleanup on exit

**Key Code:**
```javascript
webPreferences: {
  nodeIntegration: false,    // Security
  contextIsolation: true,    // Security
  preload: path.join(__dirname, 'preload.js')
}
```

### 2. preload.js
**Purpose:** Secure IPC bridge between renderer and main

**Exposed API:**
- `startProcessing(url)` - Start conversion
- `cancelProcessing()` - Cancel operation
- `onProgress(callback)` - Progress updates
- `onError(callback)` - Error events
- `onComplete(callback)` - Completion events
- `openPdf(path)` - Open generated PDF
- `getOutputDir()` - Get output directory

### 3. src/main/ipc-handlers.js
**Purpose:** Central orchestration of the entire pipeline

**Critical Functions:**
- `processVideo(url)` - Main workflow coordinator
- `sendProgress(step, percentage, message)` - Progress reporting
- `cleanup()` - Resource cleanup

**Workflow:**
1. Download video (25% weight)
2. Convert to MP3 (15% weight)
3. Transcribe to MIDI (45% weight)
4. Generate PDF (15% weight)

### 4. src/main/youtube-downloader.js
**Purpose:** Download YouTube videos

**Dependencies:** yt-dlp-wrap

**Key Methods:**
- `initialize()` - Download yt-dlp binary
- `validateYouTubeUrl(url)` - URL validation
- `getVideoInfo(url)` - Extract metadata
- `downloadVideo(url, callback)` - Download with progress

**Notes:**
- First run downloads yt-dlp (~10MB)
- Supports progress tracking
- Handles cancellation

### 5. src/main/audio-converter.js
**Purpose:** Convert video to MP3

**Dependencies:** fluent-ffmpeg, FFmpeg binary

**Key Methods:**
- `checkFfmpegInstalled()` - Verify FFmpeg
- `convertToMp3(input, callback)` - Convert with progress
- `optimizeForTranscription(input)` - Optimize for AI

**Audio Settings:**
- Sample rate: 22050 Hz (required by Basic Pitch)
- Channels: 1 (mono)
- Bitrate: 128k
- Format: MP3

### 6. src/main/transcriber.js
**Purpose:** AI music transcription

**Dependencies:** @spotify/basic-pitch

**Key Methods:**
- `initializeModel()` - Load AI model
- `transcribeToMidi(audio, callback)` - Transcribe audio
- `processMidiForPiano(midi)` - Filter to piano range
- `filterNotesByFrequency(notes)` - Note filtering

**Processing:**
- First run downloads model (~20MB)
- Most CPU-intensive step
- Uses TensorFlow.js internally

**Note Range:**
- Piano: A0 (21) to C8 (108)
- Frequency: 27.5 Hz to 4186 Hz

### 7. src/main/sheet-generator.js
**Purpose:** Generate PDF sheet music

**Dependencies:** vexflow, canvas, puppeteer

**Key Methods:**
- `parseMidiFile(midi)` - Parse MIDI data
- `generatePianoStaff(notes)` - Create notation
- `createVexFlowScore(notes)` - Render with VexFlow
- `exportToPdf(canvas, path)` - Generate PDF

**Process:**
1. Parse MIDI notes
2. Create VexFlow staff
3. Render to canvas
4. Convert canvas to HTML
5. Use Puppeteer to generate PDF

### 8. src/main/file-manager.js
**Purpose:** File system management

**Key Methods:**
- `generateUniqueFilename(ext)` - UUID-based names
- `getTempPath(filename)` - Temp file paths
- `getOutputPath(filename)` - Output file paths
- `cleanupTempFiles()` - Remove temp files
- `sanitizeFilename(name)` - Safe filenames

**Directories:**
- `temp/` - Temporary files (auto-cleaned)
- `output/` - Final PDFs (persistent)

### 9. src/renderer/scripts/app.js
**Purpose:** Main renderer logic

**Responsibilities:**
- Event listeners
- IPC communication
- Input validation
- UI state management

**URL Validation:**
```javascript
/^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/
```

### 10. src/renderer/scripts/ui-controller.js
**Purpose:** UI state management

**Functions:**
- `addLog(message, type)` - Add log entry
- `updateProgressBar(percentage)` - Progress bar
- `updateStepStatus(step, status)` - Step indicators
- `setUIEnabled(enabled)` - Enable/disable inputs

### 11. src/renderer/scripts/progress-handler.js
**Purpose:** Progress calculation

**Step Weights:**
- Download: 25%
- Convert: 15%
- Transcribe: 45%
- Generate: 15%

**Calculation:**
```javascript
overallProgress = Σ(completed_steps) + (current_step_weight * current_progress)
```

## Adding New Features

### Example: Add Audio Normalization

1. **Create new module:** `src/main/audio-normalizer.js`
   ```javascript
   class AudioNormalizer {
     async normalize(inputPath, outputPath) {
       // Implementation
     }
   }
   module.exports = new AudioNormalizer();
   ```

2. **Update pipeline:** `src/main/ipc-handlers.js`
   ```javascript
   // After audio conversion
   const normalized = await audioNormalizer.normalize(audioResult.filePath);
   ```

3. **Update progress:** Adjust step weights
   ```javascript
   const stepWeights = {
     1: 0.20,  // Download
     2: 0.15,  // Convert
     3: 0.10,  // Normalize (new)
     4: 0.40,  // Transcribe
     5: 0.15   // Generate
   };
   ```

4. **Update UI:** Add step indicator in HTML
   ```html
   <div class="progress-step" data-step="3">
     <div class="step-icon">3</div>
     <div class="step-label">정규화</div>
   </div>
   ```

## Testing

### Unit Testing

Create test files in `test/` directory:

```javascript
const transcriber = require('../src/main/transcriber');

describe('Transcriber', () => {
  it('should filter notes by frequency', () => {
    const notes = [
      { pitch: 20, frequency: 25 },   // Below piano range
      { pitch: 60, frequency: 261.6 }, // Middle C
      { pitch: 110, frequency: 5000 }  // Above piano range
    ];

    const filtered = transcriber.filterNotesByFrequency(notes);
    expect(filtered).toHaveLength(1);
  });
});
```

### Integration Testing

Test complete workflow:

```javascript
const ipcHandlers = require('../src/main/ipc-handlers');

describe('Full Pipeline', () => {
  it('should process video end-to-end', async () => {
    const url = 'https://www.youtube.com/watch?v=test';
    const result = await ipcHandlers.processVideo(url);
    expect(result.pdfPath).toBeDefined();
  });
});
```

### Manual Testing

1. Test with various video lengths
2. Test cancellation at each step
3. Test error scenarios (no internet, invalid URL)
4. Test with different music types
5. Memory leak testing (multiple consecutive runs)

## Performance Optimization

### Current Bottlenecks

1. **Transcription (45% of time)**
   - CPU-intensive
   - TensorFlow.js operations
   - Optimization: Use WebGL backend if available

2. **Download (25% of time)**
   - Network-dependent
   - No optimization possible

3. **PDF Generation (15% of time)**
   - Puppeteer overhead
   - Optimization: Reuse browser instance

### Memory Management

**Current Usage:**
- Peak: ~400-500 MB for 3-minute video
- Baseline: ~100-150 MB

**Optimization Tips:**
- Stream large files instead of loading into memory
- Delete intermediate files immediately after use
- Close Puppeteer browser after each PDF

### Future Improvements

1. **Parallel Processing**
   - Download next video while transcribing current
   - Batch processing mode

2. **Caching**
   - Cache downloaded videos
   - Skip re-transcription if already done

3. **GPU Acceleration**
   - Use CUDA for transcription
   - Requires native modules

## Debugging

### Enable DevTools

In `main.js`:
```javascript
if (process.env.NODE_ENV === 'development') {
  mainWindow.webContents.openDevTools();
}
```

Run with:
```bash
NODE_ENV=development npm start
```

### Logging

Add detailed logging:
```javascript
// src/main/ipc-handlers.js
console.log('[IPC] Starting download:', url);
console.log('[IPC] Download complete:', downloadResult);
```

### Common Issues

**Issue:** FFmpeg not found
**Debug:** `console.log(process.env.PATH)`

**Issue:** Transcription fails
**Debug:** Check audio file size and format

**Issue:** PDF generation fails
**Debug:** Enable Puppeteer debug: `DEBUG=puppeteer:* npm start`

## Code Style

- Use async/await over promises
- Error handling with try-catch
- Descriptive variable names
- Comments for complex logic
- Consistent indentation (2 spaces)

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Make changes
4. Test thoroughly
5. Commit: `git commit -m "Add feature"`
6. Push: `git push origin feature-name`
7. Create Pull Request

## Resources

- **Electron IPC:** https://www.electronjs.org/docs/latest/tutorial/ipc
- **Basic Pitch:** https://github.com/spotify/basic-pitch
- **VexFlow:** https://www.vexflow.com/
- **yt-dlp:** https://github.com/yt-dlp/yt-dlp
- **FFmpeg:** https://ffmpeg.org/documentation.html

---

Happy coding! 🎹
