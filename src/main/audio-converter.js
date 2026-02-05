const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const fileManager = require('./file-manager');
const fs = require('fs-extra');

const execAsync = promisify(exec);

class AudioConverter {
  constructor() {
    this.isCancelled = false;
    this.currentCommand = null;
    this.ffmpegPath = null;
    this.ffprobePath = null;
  }

  findFfmpegPath() {
    // Common FFmpeg installation paths on Windows
    const possiblePaths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\ffmpeg\\ffmpeg.exe',
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'ffmpeg.exe')
    ];

    for (const ffmpegPath of possiblePaths) {
      if (fs.existsSync(ffmpegPath)) {
        const ffprobePath = ffmpegPath.replace('ffmpeg.exe', 'ffprobe.exe');
        console.log('Found FFmpeg at:', ffmpegPath);
        return { ffmpegPath, ffprobePath };
      }
    }

    return null;
  }

  async checkFfmpegInstalled() {
    try {
      // First try to find FFmpeg in common paths
      const paths = this.findFfmpegPath();
      if (paths) {
        this.ffmpegPath = paths.ffmpegPath;
        this.ffprobePath = paths.ffprobePath;

        // Set FFmpeg path for fluent-ffmpeg
        ffmpeg.setFfmpegPath(this.ffmpegPath);
        ffmpeg.setFfprobePath(this.ffprobePath);

        console.log('FFmpeg configured:', this.ffmpegPath);
        return true;
      }

      // Fallback: check if ffmpeg is in PATH
      await execAsync('ffmpeg -version');
      console.log('FFmpeg found in system PATH');
      return true;
    } catch (error) {
      return false;
    }
  }

  async convertToMp3(inputPath, progressCallback) {
    const isInstalled = await this.checkFfmpegInstalled();
    if (!isInstalled) {
      throw new Error('FFmpeg is not installed. Please install FFmpeg from https://ffmpeg.org/download.html');
    }

    this.isCancelled = false;

    const outputFilename = fileManager.generateUniqueFilename('.mp3');
    const outputPath = fileManager.getTempPath(outputFilename);

    return new Promise((resolve, reject) => {
      if (progressCallback) {
        progressCallback(0, 'Starting audio conversion...');
      }

      this.currentCommand = ffmpeg(inputPath)
        .audioFrequency(22050) // Sample rate for Basic Pitch
        .audioBitrate('128k')
        .audioChannels(1) // Mono for better transcription
        .audioCodec('libmp3lame')
        .format('mp3')
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          if (this.isCancelled) {
            this.currentCommand.kill();
            return;
          }

          const percent = Math.round(progress.percent || 0);
          if (progressCallback && !isNaN(percent)) {
            progressCallback(percent, `Converting to MP3: ${percent}%`);
          }
        })
        .on('end', () => {
          if (this.isCancelled) {
            fileManager.deleteFile(outputPath);
            reject(new Error('Conversion cancelled'));
            return;
          }

          resolve({
            filePath: outputPath,
            filename: outputFilename
          });
        })
        .on('error', (error) => {
          fileManager.deleteFile(outputPath);
          reject(new Error(`Conversion error: ${error.message}`));
        })
        .save(outputPath);
    });
  }

  async optimizeForTranscription(inputPath, progressCallback) {
    // This method converts audio to the optimal format for Basic Pitch
    // 22050 Hz sample rate, mono, MP3 format
    return this.convertToMp3(inputPath, progressCallback);
  }

  cancel() {
    this.isCancelled = true;
    if (this.currentCommand) {
      this.currentCommand.kill('SIGKILL');
    }
  }

  async getAudioDuration(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (error, metadata) => {
        if (error) {
          reject(error);
        } else {
          resolve(metadata.format.duration);
        }
      });
    });
  }
}

module.exports = new AudioConverter();
