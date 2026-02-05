const { ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const fileManager = require('./file-manager');
const youtubeDownloader = require('./youtube-downloader');
const audioConverter = require('./audio-converter');
const transcriber = require('./transcriber');
const stemSeparator = require('./stem-separator');
const cacheManager = require('./cache-manager');

class IPCHandlers {
  constructor() {
    this.isProcessing = false;
    this.currentStep = 0;
    this.mainWindow = null;
    this.tempFiles = [];
  }

  initialize(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupHandlers();
  }

  setupHandlers() {
    // Main processing handler
    ipcMain.handle('start-processing', async (event, payload) => {
      if (this.isProcessing) {
        throw new Error('Processing already in progress');
      }

      this.isProcessing = true;
      this.tempFiles = [];

      try {
        await this.processVideo(payload);
      } catch (error) {
        this.isProcessing = false;
        this.sendError(error.message);
        await this.cleanup();
        throw error;
      } finally {
        this.isProcessing = false;
      }
    });

    // Cancel processing handler
    ipcMain.handle('cancel-processing', async () => {
      if (!this.isProcessing) {
        return;
      }

      // Cancel all active processes
      youtubeDownloader.cancel();
      audioConverter.cancel();
      transcriber.cancel();
      sheetGenerator.cancel();

      this.isProcessing = false;
      await this.cleanup();
    });

    // Open PDF handler
    ipcMain.handle('open-pdf', async (event, filePath) => {
      try {
        await shell.openPath(filePath);
      } catch (error) {
        console.error('Failed to open PDF:', error);
      }
    });

    // Get output directory handler
    ipcMain.handle('get-output-dir', async () => {
      return fileManager.getOutputDir();
    });
  }

  async processVideo(payload) {
    try {
      const url = typeof payload === 'string' ? payload : payload.url;
      const options = typeof payload === 'string' ? {} : (payload.options || {});

      // Initialize managers
      await fileManager.initialize();
      await cacheManager.initialize();

      let audioPath;
      let videoTitle;
      let usedCache = false;

      // Check cache first
      const cached = await cacheManager.getCachedAudio(url);

      if (cached) {
        // Use cached audio
        this.currentStep = 1;
        this.sendProgress(1, 100, 'Using cached audio (skip download)');
        this.currentStep = 2;
        this.sendProgress(2, 100, 'Using cached audio (skip conversion)');

        audioPath = cached.audioPath;
        videoTitle = cached.videoTitle;
        usedCache = true;

        console.log('Using cached audio:', audioPath);
      } else {
        // Step 1: Download video (25% of progress)
        this.currentStep = 1;
        this.sendProgress(1, 0, 'Starting download...');

        const downloadResult = await youtubeDownloader.downloadVideo(
          url,
          (percent, message) => {
            this.sendProgress(1, percent, message);
          }
        );

        this.tempFiles.push(downloadResult.filePath);
        videoTitle = downloadResult.videoInfo.title;

        // Step 2: Convert to MP3 (40% of progress)
        this.currentStep = 2;
        this.sendProgress(2, 0, 'Starting audio conversion...');

        const audioResult = await audioConverter.convertToMp3(
          downloadResult.filePath,
          (percent, message) => {
            this.sendProgress(2, percent, message);
          }
        );

        this.tempFiles.push(audioResult.filePath);
        audioPath = audioResult.filePath;

        // Delete video file after conversion
        await fileManager.deleteFile(downloadResult.filePath);

        // Cache the audio file
        await cacheManager.cacheAudio(url, audioPath, videoTitle);
        console.log('Audio cached for future use');
      }

      // Save MP3 to output folder (always do this)
      const mp3Filename = fileManager.sanitizeFilename(`${videoTitle || 'audio'}.mp3`);
      await fileManager.copyToOutput(audioPath, mp3Filename);

      // Step 3: Transcribe to MIDI (70% of progress)
      this.currentStep = 3;
      this.sendProgress(3, 0, 'Starting AI transcription...');

      let transcribeInputPath = audioPath;
      let separationCleanupDir = null;

      if (options.useSeparation) {
        this.sendProgress(3, 0, 'Separating vocals (Demucs)...');
        const separationResult = await stemSeparator.separateToAccompaniment(
          audioPath,
          (percent, message) => {
            this.sendProgress(3, Math.min(20, Math.round(percent * 0.2)), message);
          }
        );
        transcribeInputPath = separationResult.filePath;
        separationCleanupDir = separationResult.cleanupDir;
      }

      const midiResult = await transcriber.transcribeToMidi(
        transcribeInputPath,
        (percent, message) => {
          const scaled = options.useSeparation
            ? Math.min(100, 20 + Math.round(percent * 0.8))
            : percent;
          this.sendProgress(3, scaled, message);
        },
        options
      );

      this.tempFiles.push(midiResult.filePath);

      // Clean up separation output if used
      if (separationCleanupDir) {
        await fs.remove(separationCleanupDir);
      }

      // Only delete temp audio if not using cache
      if (!usedCache && audioPath) {
        await fileManager.deleteFile(audioPath);
      }

      // Step 4: Export MIDI to output (100% of progress)
      this.currentStep = 4;
      this.sendProgress(4, 0, 'Saving MIDI file...');

      // Add difficulty level to filename
      const difficultyLabel = {
        'beginner': '[초급]',
        'intermediate': '[중급]',
        'advanced': '[고급]'
      };
      const difficultyTag = difficultyLabel[options.qualityMode] || '[중급]';
      const midiFilename = fileManager.sanitizeFilename(`$${difficultyTag} {videoTitle || 'transcription'}.mid`);
      const finalMidiPath = await fileManager.moveToOutput(midiResult.filePath, midiFilename);

      this.sendProgress(4, 100, 'MIDI saved');

      // Send completion event
      this.sendComplete(finalMidiPath, midiFilename);

      // Final cleanup
      await this.cleanup();
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  sendProgress(step, percentage, message) {
    if (!this.mainWindow) return;

    // Calculate overall progress
    const stepWeights = {
      1: 0.25, // Download
      2: 0.15, // Convert
      3: 0.45, // Transcribe
      4: 0.15  // Generate
    };

    let overallProgress = 0;
    for (let i = 1; i < step; i++) {
      overallProgress += stepWeights[i] * 100;
    }
    overallProgress += stepWeights[step] * percentage;

    this.mainWindow.webContents.send('progress-update', {
      step,
      percentage: Math.round(overallProgress),
      message
    });
  }

  sendError(message) {
    if (!this.mainWindow) return;

    this.mainWindow.webContents.send('error-occurred', {
      message
    });
  }

  sendComplete(pdfPath, filename) {
    if (!this.mainWindow) return;

    this.mainWindow.webContents.send('processing-complete', {
      pdfPath,
      filename
    });
  }

  async cleanup() {
    // Clean up any remaining temp files
    await fileManager.cleanupTempFiles();
    this.tempFiles = [];
  }
}

const ipcHandlers = new IPCHandlers();

// Initialize when required
const { BrowserWindow } = require('electron');
setTimeout(() => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow) {
    ipcHandlers.initialize(mainWindow);
  }
}, 1000);

module.exports = ipcHandlers;
