const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const sanitize = require('sanitize-filename');

class CacheManager {
  constructor() {
    this.rootDir = path.join(__dirname, '..', '..');
    this.cacheDir = path.join(this.rootDir, 'cache');
    this.cacheIndexFile = path.join(this.cacheDir, 'index.json');
    this.cacheIndex = {};
  }

  async initialize() {
    await fs.ensureDir(this.cacheDir);

    // Load cache index
    if (await fs.pathExists(this.cacheIndexFile)) {
      try {
        this.cacheIndex = await fs.readJson(this.cacheIndexFile);
      } catch (error) {
        console.error('Failed to load cache index:', error);
        this.cacheIndex = {};
      }
    }
  }

  generateUrlHash(url) {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  async saveIndex() {
    try {
      await fs.writeJson(this.cacheIndexFile, this.cacheIndex, { spaces: 2 });
    } catch (error) {
      console.error('Failed to save cache index:', error);
    }
  }

  async getCachedAudio(url) {
    const urlHash = this.generateUrlHash(url);
    const entry = this.cacheIndex[urlHash];

    if (!entry || !entry.audioPath) {
      return null;
    }

    // Check if file still exists
    const exists = await fs.pathExists(entry.audioPath);
    if (!exists) {
      delete this.cacheIndex[urlHash];
      await this.saveIndex();
      return null;
    }

    return {
      audioPath: entry.audioPath,
      videoTitle: entry.videoTitle,
      timestamp: entry.timestamp
    };
  }

  async cacheAudio(url, audioPath, videoTitle) {
    const urlHash = this.generateUrlHash(url);
    const safeName = sanitize(videoTitle || urlHash, { replacement: '_' });
    const cachedPath = path.join(this.cacheDir, `${safeName}.mp3`);

    // Copy audio file to cache
    await fs.copy(audioPath, cachedPath);

    // Update index
    this.cacheIndex[urlHash] = {
      url,
      audioPath: cachedPath,
      videoTitle,
      timestamp: Date.now()
    };

    await this.saveIndex();
    return cachedPath;
  }

  async clearOldCache(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    // Clear cache entries older than maxAge (default 7 days)
    const now = Date.now();
    let cleaned = 0;

    for (const [hash, entry] of Object.entries(this.cacheIndex)) {
      if (now - entry.timestamp > maxAgeMs) {
        // Delete file
        if (entry.audioPath && await fs.pathExists(entry.audioPath)) {
          await fs.remove(entry.audioPath);
        }
        delete this.cacheIndex[hash];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.saveIndex();
      console.log(`Cleaned ${cleaned} old cache entries`);
    }
  }

  async clearAllCache() {
    // Remove all cached files
    await fs.emptyDir(this.cacheDir);
    this.cacheIndex = {};
    await this.saveIndex();
    console.log('All cache cleared');
  }

  async getCacheStats() {
    const entries = Object.keys(this.cacheIndex).length;
    let totalSize = 0;

    for (const entry of Object.values(this.cacheIndex)) {
      if (entry.audioPath && await fs.pathExists(entry.audioPath)) {
        const stats = await fs.stat(entry.audioPath);
        totalSize += stats.size;
      }
    }

    return {
      entries,
      totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
    };
  }
}

module.exports = new CacheManager();
