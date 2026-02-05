const { ipcMain, shell } = require('electron');
const path = require('path');
const fileManager = require('./file-manager');
const youtubeDownloader = require('./youtube-downloader');
const audioConverter = require('./audio-converter');
const transcriber = require('./transcriber');

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
    ipcMain.handle('start-processing', async (event, url) => {
      if (this.isProcessing) {
        throw new Error('Processing already in progress');
      }

      this.isProcessing = true;
      this.tempFiles = [];

      try {
        await this.processVideo(url);
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

  async processVideo(url) {
    try {
      // Initialize file manager
      await fileManager.initialize();

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
      const videoTitle = downloadResult.videoInfo.title;

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

      // Delete video file after conversion
      await fileManager.deleteFile(downloadResult.filePath);

      // Step 3: Transcribe to MIDI (70% of progress)
      this.currentStep = 3;
      this.sendProgress(3, 0, 'Starting AI transcription...');

      const midiResult = await transcriber.transcribeToMidi(
        audioResult.filePath,
        (percent, message) => {
          this.sendProgress(3, percent, message);
        }
      );

      this.tempFiles.push(midiResult.filePath);

      // Delete audio file after transcription
      await fileManager.deleteFile(audioResult.filePath);

      // Step 4: Export MIDI to output (100% of progress)
      this.currentStep = 4;
      this.sendProgress(4, 0, 'Saving MIDI file...');

      const midiFilename = fileManager.sanitizeFilename(`${videoTitle || 'transcription'}.mid`);
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
