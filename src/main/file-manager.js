const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sanitize = require('sanitize-filename');

class FileManager {
  constructor() {
    this.rootDir = path.join(__dirname, '..', '..');
    this.tempDir = path.join(this.rootDir, 'temp');
    this.outputDir = path.join(this.rootDir, 'output');
  }

  async initialize() {
    await fs.ensureDir(this.tempDir);
    await fs.ensureDir(this.outputDir);
  }

  generateUniqueFilename(extension) {
    const uuid = uuidv4();
    return `${uuid}${extension}`;
  }

  getTempPath(filename) {
    return path.join(this.tempDir, filename);
  }

  getOutputPath(filename) {
    return path.join(this.outputDir, sanitize(filename));
  }

  sanitizeFilename(filename) {
    return sanitize(filename, { replacement: '_' });
  }

  async cleanupTempFiles(keepFiles = []) {
    try {
      const files = await fs.readdir(this.tempDir);

      for (const file of files) {
        if (!keepFiles.includes(file)) {
          const filePath = path.join(this.tempDir, file);
          await fs.remove(filePath);
        }
      }
    } catch (error) {
      console.error('Error cleaning temp files:', error);
    }
  }

  async deleteFile(filePath) {
    try {
      await fs.remove(filePath);
    } catch (error) {
      console.error(`Error deleting file ${filePath}:`, error);
    }
  }

  async moveToOutput(sourcePath, filename) {
    let outputPath = this.getOutputPath(filename);

    // Check if file exists and add timestamp if needed
    if (await this.fileExists(outputPath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const ext = path.extname(filename);
      const nameWithoutExt = path.basename(filename, ext);
      const newFilename = `${nameWithoutExt}_${timestamp}${ext}`;
      outputPath = this.getOutputPath(newFilename);
    }

    await fs.move(sourcePath, outputPath, { overwrite: false });
    return outputPath;
  }

  async copyToOutput(sourcePath, filename) {
    let outputPath = this.getOutputPath(filename);

    // Check if file exists and add timestamp if needed
    if (await this.fileExists(outputPath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const ext = path.extname(filename);
      const nameWithoutExt = path.basename(filename, ext);
      const newFilename = `${nameWithoutExt}_${timestamp}${ext}`;
      outputPath = this.getOutputPath(newFilename);
    }

    await fs.copy(sourcePath, outputPath);
    return outputPath;
  }

  async checkDiskSpace(requiredMb = 100) {
    // Basic implementation - could be enhanced with proper disk space checking
    try {
      const stats = await fs.stat(this.tempDir);
      return true; // Simplified - assume space is available
    } catch (error) {
      return false;
    }
  }

  async emptyTempDir() {
    try {
      await fs.emptyDir(this.tempDir);
    } catch (error) {
      console.error('Error emptying temp directory:', error);
    }
  }

  getOutputDir() {
    return this.outputDir;
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = new FileManager();
