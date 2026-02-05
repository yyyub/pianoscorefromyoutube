const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs-extra');
const fileManager = require('./file-manager');

class YouTubeDownloader {
  constructor() {
    this.ytDlpPath = null;
    this.currentProcess = null;
    this.isCancelled = false;
  }

  async initialize() {
    try {
      // Download yt-dlp binary if not exists
      console.log('Downloading/locating yt-dlp binary...');
      const binaryPath = await YTDlpWrap.downloadFromGithub();
      this.ytDlpPath = binaryPath;

      // Initialize yt-dlp-wrap with the binary path
      this.ytDlp = new YTDlpWrap(binaryPath);

      console.log('yt-dlp initialized:', this.ytDlpPath);

      // Test if yt-dlp works
      try {
        const version = await this.ytDlp.getVersion();
        console.log('yt-dlp version:', version);
      } catch (versionError) {
        console.warn('Could not get yt-dlp version, but continuing...');
      }

      return true;
    } catch (error) {
      console.error('Failed to initialize yt-dlp:', error);
      throw new Error('Failed to initialize YouTube downloader: ' + error.message);
    }
  }

  validateYouTubeUrl(url) {
    const patterns = [
      /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/,
      /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
      /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]{11}/
    ];

    return patterns.some(pattern => pattern.test(url));
  }

  async getVideoInfo(url) {
    try {
      console.log('Fetching video info for:', url);

      // Extract just the video ID without playlist parameters
      const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (videoIdMatch) {
        const videoId = videoIdMatch[1];
        const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
        console.log('Using clean URL:', cleanUrl);
        url = cleanUrl;
      }

      // Use exec with --dump-json to get video info
      const infoString = await this.ytDlp.execPromise([
        url,
        '--dump-json',
        '--no-playlist',
        '--skip-download'
      ]);

      const info = JSON.parse(infoString);

      console.log('Video info retrieved:', {
        title: info.title,
        duration: info.duration
      });

      return {
        title: info.title || 'Unknown Title',
        duration: info.duration || 0,
        uploader: info.uploader || 'Unknown'
      };
    } catch (error) {
      console.error('Failed to get video info:', error);
      const errorMsg = error.message || error.toString();

      if (errorMsg.includes('network') || errorMsg.includes('timeout')) {
        throw new Error('Network error: Check your internet connection');
      } else if (errorMsg.includes('private') || errorMsg.includes('unavailable')) {
        throw new Error('Video is private or unavailable');
      } else {
        throw new Error('Failed to retrieve video information: ' + errorMsg);
      }
    }
  }

  async downloadVideo(url, progressCallback) {
    if (!this.validateYouTubeUrl(url)) {
      throw new Error('Invalid YouTube URL');
    }

    if (!this.ytDlpPath) {
      await this.initialize();
    }

    this.isCancelled = false;

    // Clean URL to remove playlist parameters
    const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (videoIdMatch) {
      const videoId = videoIdMatch[1];
      url = `https://www.youtube.com/watch?v=${videoId}`;
      console.log('Using clean URL for download:', url);
    }

    const filename = fileManager.generateUniqueFilename('.mp4');
    const outputPath = fileManager.getTempPath(filename);

    try {
      // Get video info first
      const videoInfo = await this.getVideoInfo(url);

      if (progressCallback) {
        progressCallback(0, 'Downloading video...');
      }

      // Download options - simplified and more robust
      const options = [
        url,
        '-f', 'best[ext=mp4]/best',
        '-o', outputPath,
        '--no-playlist',
        '--no-warnings',
        '--newline'
      ];

      return new Promise((resolve, reject) => {
        this.currentProcess = this.ytDlp.exec(options);

        let lastProgress = 0;

        this.currentProcess.on('progress', (progress) => {
          if (this.isCancelled) {
            this.currentProcess.kill();
            return;
          }

          const percent = Math.round(progress.percent || 0);
          if (percent !== lastProgress) {
            lastProgress = percent;
            if (progressCallback) {
              progressCallback(percent, `Downloading: ${percent}%`);
            }
          }
        });

        this.currentProcess.on('close', (code) => {
          if (this.isCancelled) {
            reject(new Error('Download cancelled'));
            return;
          }

          if (code === 0) {
            resolve({
              filePath: outputPath,
              filename,
              videoInfo
            });
          } else {
            reject(new Error(`Download failed with code ${code}`));
          }
        });

        this.currentProcess.on('error', (error) => {
          reject(new Error(`Download error: ${error.message}`));
        });
      });
    } catch (error) {
      await fileManager.deleteFile(outputPath);
      throw error;
    }
  }

  cancel() {
    this.isCancelled = true;
    if (this.currentProcess) {
      this.currentProcess.kill();
    }
  }
}

module.exports = new YouTubeDownloader();
