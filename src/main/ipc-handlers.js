const { ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
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

    // List MIDI files for rhythm game
    ipcMain.handle('list-midi-files', async () => {
      await fileManager.initialize();
      const outputDir = fileManager.getOutputDir();
      const results = [];

      try {
        const entries = await fs.readdir(outputDir, { withFileTypes: true });

        for (const entry of entries) {
          // Handle both subfolders (output/<folder>/*.mid) and root-level mid files
          if (entry.isDirectory()) {
            const folderPath = path.join(outputDir, entry.name);
            const files = await fs.readdir(folderPath);
            const audioFile = files.find(f => f.toLowerCase().endsWith('.mp3') && f !== 'instrumental.mp3' && f !== 'vocals.mp3');
            const videoFile = files.find(f => f.toLowerCase().endsWith('.mp4'));

            // Detect vocal game data
            const hasInstrumental = files.includes('instrumental.mp3');
            const hasVocalChart = files.includes('vocal-chart.mid');
            const hasVocals = files.includes('vocals.mp3');
            const hasVocalData = hasInstrumental && hasVocalChart && hasVocals;

            for (const file of files) {
              if (path.extname(file).toLowerCase() !== '.mid') continue;
              if (file === 'vocal-chart.mid') continue; // Skip vocal chart from piano list
              const diffMatch = file.match(/^\[(.*?)\]/);
              const item = {
                path: path.join(folderPath, file),
                name: file,
                folder: entry.name,
                difficulty: diffMatch ? diffMatch[1] : 'unknown'
              };
              if (audioFile) item.audioPath = path.join(folderPath, audioFile);
              if (videoFile) item.videoPath = path.join(folderPath, videoFile);
              // Attach vocal game data paths if available
              if (hasVocalData) {
                item.hasVocalData = true;
                item.instrumentalPath = path.join(folderPath, 'instrumental.mp3');
                item.vocalsAudioPath = path.join(folderPath, 'vocals.mp3');
                item.vocalChartPath = path.join(folderPath, 'vocal-chart.mid');
              }
              results.push(item);
            }

            // If folder has vocal data but no piano MIDI, still add as vocal-only entry
            if (hasVocalData && !files.some(f => f.endsWith('.mid') && f !== 'vocal-chart.mid')) {
              results.push({
                path: path.join(folderPath, 'vocal-chart.mid'),
                name: entry.name,
                folder: entry.name,
                difficulty: 'vocal',
                vocalOnly: true,
                hasVocalData: true,
                instrumentalPath: path.join(folderPath, 'instrumental.mp3'),
                vocalsAudioPath: path.join(folderPath, 'vocals.mp3'),
                vocalChartPath: path.join(folderPath, 'vocal-chart.mid'),
                videoPath: videoFile ? path.join(folderPath, videoFile) : null
              });
            }
          } else if (entry.name.toLowerCase().endsWith('.mid')) {
            // Root-level .mid file
            results.push({
              path: path.join(outputDir, entry.name),
              name: entry.name,
              folder: 'output',
              difficulty: 'unknown'
            });
          }
        }
      } catch (err) {
        console.error('Failed to list MIDI files:', err);
      }

      return results;
    });

    // Open file dialog to import external MIDI file
    ipcMain.handle('import-midi-file', async () => {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(this.mainWindow, {
        title: 'MIDI 파일 선택',
        filters: [{ name: 'MIDI Files', extensions: ['mid', 'midi'] }],
        properties: ['openFile']
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const midiPath = result.filePaths[0];
      const folder = path.dirname(midiPath);
      const name = path.basename(midiPath);

      // Look for audio/video files in the same directory
      const siblingFiles = await fs.readdir(folder);
      const audioFile = siblingFiles.find(f => f.toLowerCase().endsWith('.mp3'));
      const videoFile = siblingFiles.find(f => f.toLowerCase().endsWith('.mp4'));

      const item = {
        path: midiPath,
        name,
        folder: path.basename(folder),
        difficulty: 'unknown'
      };
      if (audioFile) item.audioPath = path.join(folder, audioFile);
      if (videoFile) item.videoPath = path.join(folder, videoFile);
      return item;
    });

    // Load and parse MIDI file for rhythm game
    ipcMain.handle('load-midi-for-game', async (event, midiPath) => {
      const { Midi } = require('@tonejs/midi');
      const buffer = await fs.readFile(midiPath);
      const midi = new Midi(buffer);

      return {
        header: {
          bpm: midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120,
          timeSignature: midi.header.timeSignatures.length > 0
            ? midi.header.timeSignatures[0].timeSignature
            : [4, 4],
          duration: midi.duration
        },
        tracks: midi.tracks.map(track => ({
          name: track.name,
          channel: track.channel,
          notes: track.notes.map(note => ({
            midi: note.midi,
            time: note.time,
            duration: note.duration,
            velocity: note.velocity
          }))
        }))
      };
    });

    // Read audio file as buffer for Web Audio API
    ipcMain.handle('read-audio-file', async (event, audioPath) => {
      const buffer = await fs.readFile(audioPath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    });

    // Prepare vocal rhythm game: URL → download → separate → transcribe → save
    ipcMain.handle('prepare-vocal-game', async (event, url) => {
      try {
        await fileManager.initialize();
        await cacheManager.initialize();

        const sendVocalProgress = (percent, message) => {
          if (this.mainWindow) {
            this.mainWindow.webContents.send('vocal-game-progress', { percent, message });
          }
        };

        // Check if already processed (output folder has instrumental + vocal-chart)
        const cached = await cacheManager.getCachedAudio(url);
        if (cached && cached.videoTitle) {
          const folderName = cached.videoTitle;
          const outputSubDir = path.join(fileManager.getOutputDir(), fileManager.sanitizeFilename(folderName));
          const instrumentalPath = path.join(outputSubDir, 'instrumental.mp3');
          const vocalChartPath = path.join(outputSubDir, 'vocal-chart.mid');
          const vocalsPath = path.join(outputSubDir, 'vocals.mp3');

          if (await fs.pathExists(instrumentalPath) && await fs.pathExists(vocalChartPath) && await fs.pathExists(vocalsPath)) {
            sendVocalProgress(100, '캐시 사용 (이미 처리된 곡)');
            const { Midi } = require('@tonejs/midi');
            const midiBuffer = await fs.readFile(vocalChartPath);
            const midi = new Midi(midiBuffer);
            const videoPath = await this._findVideoInFolder(outputSubDir);

            return {
              instrumentalPath,
              vocalsPath,
              midiData: this._parseMidiToJson(midi),
              videoPath,
              title: folderName
            };
          }
        }

        // Step 1: Download video (0-15%)
        sendVocalProgress(0, '다운로드 시작...');
        const downloadResult = await youtubeDownloader.downloadVideo(url, (percent, message) => {
          sendVocalProgress(Math.round(percent * 0.15), message);
        });
        const videoTitle = downloadResult.videoInfo.title;
        const videoFilePath = downloadResult.filePath;

        // Step 2: Convert to MP3 (15-25%)
        sendVocalProgress(15, '오디오 변환 중...');
        const audioResult = await audioConverter.convertToMp3(downloadResult.filePath, (percent, message) => {
          sendVocalProgress(15 + Math.round(percent * 0.10), message);
        });
        const audioPath = audioResult.filePath;

        // Cache the raw audio
        await cacheManager.cacheAudio(url, audioPath, videoTitle);

        // Step 3: Demucs 4-stem separation (25-65%)
        sendVocalProgress(25, '음원 분리 중 (Demucs AI)...');
        const separationResult = await stemSeparator.separateStems(audioPath, (percent, message) => {
          sendVocalProgress(25 + Math.round(percent * 0.40), message);
        });

        // Step 4: Transcribe vocals to MIDI (65-90%)
        sendVocalProgress(65, '보컬 멜로디 분석 중...');
        const vocalMidiResult = await transcriber.transcribeToMidi(
          separationResult.melodyPath,
          (percent, message) => {
            sendVocalProgress(65 + Math.round(percent * 0.25), message);
          },
          { qualityMode: 'advanced' }
        );

        // Step 5: Save to output folder (90-100%)
        sendVocalProgress(90, '파일 저장 중...');
        const folderName = videoTitle || 'vocal-game';
        const outputSubDir = await fileManager.createOutputSubDir(folderName);

        // Save instrumental
        const instrumentalDest = path.join(outputSubDir, 'instrumental.mp3');
        if (separationResult.instrumentalPath && await fs.pathExists(separationResult.instrumentalPath)) {
          await fs.copy(separationResult.instrumentalPath, instrumentalDest);
        }

        // Save vocals as MP3
        const vocalsDest = path.join(outputSubDir, 'vocals.mp3');
        const ffmpegBin = await stemSeparator.getFfmpegBinary();
        await new Promise((resolve, reject) => {
          const proc = spawn(ffmpegBin, [
            '-y', '-i', separationResult.melodyPath,
            '-ac', '2', '-ar', '44100', '-b:a', '192k', vocalsDest
          ], { windowsHide: true });
          proc.on('error', reject);
          proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`vocals convert failed (${code})`)));
        });

        // Save vocal chart MIDI
        const vocalChartDest = path.join(outputSubDir, 'vocal-chart.mid');
        await fs.copy(vocalMidiResult.filePath, vocalChartDest);

        // Save video
        let videoDestPath = null;
        if (videoFilePath && await fs.pathExists(videoFilePath)) {
          const videoCopyName = `${fileManager.sanitizeFilename(folderName)}.mp4`;
          videoDestPath = path.join(outputSubDir, videoCopyName);
          await fs.copy(videoFilePath, videoDestPath);
          await fileManager.deleteFile(videoFilePath);
        }

        // Clean up separation temp dir
        if (separationResult.cleanupDir) {
          await fs.remove(separationResult.cleanupDir);
        }

        // Clean up temp audio
        await fileManager.deleteFile(audioResult.filePath);

        sendVocalProgress(100, '준비 완료!');

        // Parse and return MIDI data
        const { Midi } = require('@tonejs/midi');
        const midiBuffer = await fs.readFile(vocalChartDest);
        const midi = new Midi(midiBuffer);

        return {
          instrumentalPath: instrumentalDest,
          vocalsPath: vocalsDest,
          midiData: this._parseMidiToJson(midi),
          videoPath: videoDestPath,
          title: videoTitle
        };
      } catch (error) {
        console.error('Vocal game preparation failed:', error);
        throw error;
      }
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

  _parseMidiToJson(midi) {
    return {
      header: {
        bpm: midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120,
        timeSignature: midi.header.timeSignatures.length > 0
          ? midi.header.timeSignatures[0].timeSignature
          : [4, 4],
        duration: midi.duration
      },
      tracks: midi.tracks.map(track => ({
        name: track.name,
        channel: track.channel,
        notes: track.notes.map(note => ({
          midi: note.midi,
          time: note.time,
          duration: note.duration,
          velocity: note.velocity
        }))
      }))
    };
  }

  async _findVideoInFolder(folderPath) {
    try {
      const files = await fs.readdir(folderPath);
      const videoFile = files.find(f => f.toLowerCase().endsWith('.mp4'));
      return videoFile ? path.join(folderPath, videoFile) : null;
    } catch {
      return null;
    }
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
      let videoFilePath = null; // Keep MP4 path for rhythm game background video
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
        videoFilePath = downloadResult.filePath;

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

        // Keep video file for rhythm game background (will be copied to output folder)

        // Cache the raw audio
        await cacheManager.cacheAudio(url, audioPath, videoTitle);
        console.log('Raw audio cached');
      }

      // Step 3: AI Processing (separation + transcription)
      this.currentStep = 3;
      let transcribeOptions = { ...options };
      let separationCleanupDir = null;
      const shouldUseSeparation = Boolean(options.useSeparation) && options.sourceType !== 'piano-cover';

      if (options.useSeparation && !shouldUseSeparation) {
        this.sendProgress(3, 0, '피아노 커버 감지: 음원 분리 없이 전사합니다...');
      }

      if (shouldUseSeparation) {
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
      const audioForTranscribe = shouldUseSeparation ? null : audioPath;
      const midiResult = await transcriber.transcribeToMidi(
        audioForTranscribe,
        (percent, message) => {
          const base = shouldUseSeparation ? 15 : 0;
          const range = shouldUseSeparation ? 85 : 100;
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

      // Copy video file to subfolder for rhythm game background
      if (videoFilePath && await fs.pathExists(videoFilePath)) {
        const videoCopyName = `${fileManager.sanitizeFilename(folderName)}.mp4`;
        await fileManager.copyToDir(videoFilePath, outputSubDir, videoCopyName);
        // Now safe to delete the temp video
        await fileManager.deleteFile(videoFilePath);
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
