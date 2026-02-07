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
    this.setupHandlers(); // Register IPC handlers immediately
  }

  initialize(mainWindow) {
    this.mainWindow = mainWindow;
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
      stemSeparator.cancel();

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

    // Get conversion history from cache
    ipcMain.handle('get-history', async () => {
      await cacheManager.initialize();
      const entries = Object.values(cacheManager.cacheIndex)
        .filter(entry => entry.url && entry.videoTitle)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return entries.map(entry => ({
        url: entry.url,
        title: entry.videoTitle,
        timestamp: entry.timestamp
      }));
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

      // Check cache for raw audio (always stores raw MP3, separation done each time)
      const cached = await cacheManager.getCachedAudio(url);

      if (cached) {
        // Cache hit: skip download + convert
        this.currentStep = 1;
        this.sendProgress(1, 100, '캐시 사용 (다운로드 생략)');
        this.currentStep = 2;
        this.sendProgress(2, 100, '캐시 사용 (변환 생략)');

        audioPath = cached.audioPath;
        videoTitle = cached.videoTitle;
        usedCache = true;

        console.log('Using cached audio:', audioPath);
      } else {
        // Step 1: Download video
        this.currentStep = 1;
        this.sendProgress(1, 0, '다운로드 시작...');

        const downloadResult = await youtubeDownloader.downloadVideo(
          url,
          (percent, message) => {
            this.sendProgress(1, percent, message);
          }
        );

        this.tempFiles.push(downloadResult.filePath);
        videoTitle = downloadResult.videoInfo.title;

        // Step 2: Convert to MP3
        this.currentStep = 2;
        this.sendProgress(2, 0, '오디오 변환 중...');

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

        // Cache the raw audio
        await cacheManager.cacheAudio(url, audioPath, videoTitle);
        console.log('Raw audio cached');
      }

      // Step 3: AI Processing (separation + transcription)
      this.currentStep = 3;
      let transcribeOptions = { ...options };
      let separationCleanupDir = null;

      if (options.useSeparation) {
        // 4-stem separation: vocals + bass + other (drums discarded)
        this.sendProgress(3, 0, '음원 분리 중 (Demucs AI)...');

        const cachedForSep = usedCache ? audioPath : (await cacheManager.getCachedAudio(url)).audioPath;
        const separationResult = await stemSeparator.separateStems(
          cachedForSep,
          (percent, message) => {
            this.sendProgress(3, Math.min(15, Math.round(percent * 0.15)), message);
          }
        );

        // Pass melody and accompaniment paths to transcriber
        transcribeOptions.melodyPath = separationResult.melodyPath;
        transcribeOptions.accompPath = separationResult.accompPath;
        separationCleanupDir = separationResult.cleanupDir;

        this.sendProgress(3, 15, 'AI 전사 시작...');
      } else {
        this.sendProgress(3, 0, 'AI 전사 시작...');
      }

      // Transcribe to MIDI (worker handles 2-pass if melodyPath/accompPath provided)
      const audioForTranscribe = options.useSeparation ? null : audioPath;
      const midiResult = await transcriber.transcribeToMidi(
        audioForTranscribe,
        (percent, message) => {
          const base = options.useSeparation ? 15 : 0;
          const range = options.useSeparation ? 85 : 100;
          const scaled = Math.min(100, base + Math.round(percent / 100 * range));
          this.sendProgress(3, scaled, message);
        },
        transcribeOptions
      );

      this.tempFiles.push(midiResult.filePath);

      // Clean up separation temp dir
      if (separationCleanupDir) {
        await fs.remove(separationCleanupDir);
      }

      // Step 4: Save to output subfolder
      this.currentStep = 4;
      this.sendProgress(4, 0, '파일 저장 중...');

      // Create subfolder: output/<videoTitle>/
      const folderName = videoTitle || 'transcription';
      const outputSubDir = await fileManager.createOutputSubDir(folderName);

      // Copy original audio to subfolder
      const cachedAudio = await cacheManager.getCachedAudio(url);
      if (cachedAudio) {
        const audioCopyName = `${fileManager.sanitizeFilename(folderName)}.mp3`;
        await fileManager.copyToDir(cachedAudio.audioPath, outputSubDir, audioCopyName);
      }

      // Move MIDI to subfolder
      const difficultyLabel = {
        'beginner': '[초급]',
        'intermediate': '[중급]',
        'advanced': '[고급]'
      };
      const difficultyTag = difficultyLabel[options.qualityMode] || '[중급]';
      const midiFilename = `${difficultyTag} ${fileManager.sanitizeFilename(folderName)}.mid`;
      const finalMidiPath = await fileManager.moveToDir(midiResult.filePath, outputSubDir, midiFilename);

      this.sendProgress(4, 100, '저장 완료');

      // Send completion event
      this.sendComplete(finalMidiPath, midiFilename, outputSubDir);

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

  sendComplete(pdfPath, filename, outputDir) {
    if (!this.mainWindow) return;

    this.mainWindow.webContents.send('processing-complete', {
      pdfPath,
      filename,
      outputDir
    });
  }

  async cleanup() {
    // Clean up any remaining temp files
    await fileManager.cleanupTempFiles();
    this.tempFiles = [];
  }
}

const ipcHandlers = new IPCHandlers();

module.exports = ipcHandlers;
