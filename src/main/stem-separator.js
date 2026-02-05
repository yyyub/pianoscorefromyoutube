const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { exec } = require('child_process');
const { promisify } = require('util');
const fileManager = require('./file-manager');

const execAsync = promisify(exec);

class StemSeparator {
  constructor() {
    this.isCancelled = false;
    this.currentProcess = null;
    this.ffmpegPath = null;
  }

  async findFfmpegPath() {
    if (this.ffmpegPath) {
      return this.ffmpegPath;
    }

    // Common FFmpeg installation paths on Windows
    const possiblePaths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\ffmpeg\\ffmpeg.exe',
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'ffmpeg.exe')
    ];

    for (const ffmpegPath of possiblePaths) {
      if (await fs.pathExists(ffmpegPath)) {
        this.ffmpegPath = path.dirname(ffmpegPath);
        console.log('Found FFmpeg at:', this.ffmpegPath);
        return this.ffmpegPath;
      }
    }

    // Try to find in PATH
    try {
      const { stdout } = await execAsync('where ffmpeg');
      const ffmpegExe = stdout.trim().split('\n')[0];
      if (ffmpegExe) {
        this.ffmpegPath = path.dirname(ffmpegExe);
        console.log('Found FFmpeg in PATH at:', this.ffmpegPath);
        return this.ffmpegPath;
      }
    } catch (error) {
      console.warn('FFmpeg not found in PATH');
    }

    return null;
  }

  async separateToAccompaniment(inputPath, progressCallback) {
    this.isCancelled = false;

    const runId = Date.now().toString();
    const outputDir = fileManager.getTempPath(`demucs-${runId}`);

    await fs.ensureDir(outputDir);

    // Find FFmpeg path before creating the Promise
    const ffmpegDir = await this.findFfmpegPath();

    return new Promise((resolve, reject) => {
      if (progressCallback) {
        progressCallback(0, 'Separating vocals (Demucs)...');
      }

      const runnerPath = path.join(__dirname, 'demucs_runner.py');

      // Use Python from virtual environment directly
      const pythonPath = path.join(fileManager.rootDir, '.venv', 'Scripts', 'python.exe');
      const args = [
        runnerPath,
        '--input', inputPath,
        '--output', outputDir,
        '--model', 'htdemucs'
      ];

      console.log('Running Demucs with Python:', pythonPath);
      console.log('Args:', args);
      console.log('Working directory:', fileManager.rootDir);
      console.log('Input file:', inputPath);
      console.log('Output dir:', outputDir);

      // Add FFmpeg to PATH for Demucs
      const env = { ...process.env };

      if (ffmpegDir) {
        // Add FFmpeg directory to PATH
        env.PATH = `${ffmpegDir};${env.PATH}`;
        console.log('Added FFmpeg to PATH:', ffmpegDir);
      } else {
        console.warn('FFmpeg not found, Demucs may fail to load audio files');
      }

      this.currentProcess = spawn(pythonPath, args, {
        windowsHide: true,
        cwd: fileManager.rootDir,
        env: env
      });

      let stdout = '';
      let stderr = '';

      this.currentProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      this.currentProcess.stderr.on('data', (chunk) => {
        const data = chunk.toString();
        stderr += data;

        // Demucs progress output goes to stderr, so we can parse it here
        // Progress bars contain % character, warnings contain "Warning"
        if (data.includes('%') && progressCallback) {
          // This is just progress, not an error
          const match = data.match(/(\d+)%/);
          if (match) {
            const percent = parseInt(match[1], 10);
            progressCallback(percent, `Separating vocals (${percent}%)...`);
          }
        }
      });

      this.currentProcess.on('error', (error) => {
        reject(new Error(`Demucs failed to start: ${error.message}`));
      });

      this.currentProcess.on('close', async (code) => {
        this.currentProcess = null;

        if (this.isCancelled) {
          reject(new Error('Separation cancelled'));
          return;
        }

        if (code !== 0) {
          // Log full output for debugging
          console.error('=== Demucs stderr ===');
          console.error(stderr);
          console.error('=== Demucs stdout ===');
          console.error(stdout);
          console.error('=== End of output ===');

          // Filter out progress bars from error message
          const errorLines = stderr.split('\n').filter(line =>
            !line.includes('%|') &&
            !line.includes('[00:') &&
            line.trim() !== ''
          ).join('\n');

          const fullError = `Exit code ${code}\nStderr: ${errorLines}\nStdout: ${stdout}`;
          reject(new Error(`Demucs failed: ${fullError}`));
          return;
        }

        try {
          const baseName = path.parse(inputPath).name;
          const accompanimentPath = path.join(outputDir, 'htdemucs', baseName, 'no_vocals.wav');

          const exists = await fileManager.fileExists(accompanimentPath);
          if (!exists) {
            reject(new Error('Demucs output not found. Please confirm Demucs is installed.'));
            return;
          }

          if (progressCallback) {
            progressCallback(100, 'Separation complete');
          }

          resolve({
            filePath: accompanimentPath,
            cleanupDir: outputDir
          });
        } catch (error) {
          reject(new Error(`Demucs output error: ${error.message}`));
        }
      });
    });
  }

  cancel() {
    this.isCancelled = true;
    if (this.currentProcess) {
      this.currentProcess.kill('SIGKILL');
    }
  }
}

module.exports = new StemSeparator();
