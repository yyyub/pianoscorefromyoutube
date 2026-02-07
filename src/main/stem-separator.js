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

  async getFfmpegBinary() {
    const dir = await this.findFfmpegPath();
    if (dir) {
      return path.join(dir, 'ffmpeg.exe');
    }
    return 'ffmpeg';
  }

  /**
   * Mix bass.wav + other.wav into a single accompaniment file using FFmpeg.
   */
  async mixStemsToAccompaniment(bassPath, otherPath, outputPath) {
    const ffmpegBin = await this.getFfmpegBinary();

    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i', bassPath,
        '-i', otherPath,
        '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest',
        '-ac', '1',
        '-ar', '22050',
        outputPath
      ];

      const proc = spawn(ffmpegBin, args, { windowsHide: true });
      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('error', (err) => reject(new Error(`FFmpeg mix error: ${err.message}`)));
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg mix failed (code ${code}): ${stderr}`));
        } else {
          resolve(outputPath);
        }
      });
    });
  }

  /**
   * Separate audio into vocals (melody) and accompaniment (bass + other).
   * Uses full 4-stem Demucs: vocals, drums, bass, other.
   * Returns { melodyPath, accompPath, cleanupDir }.
   */
  async separateStems(inputPath, progressCallback) {
    this.isCancelled = false;

    const runId = Date.now().toString();
    const outputDir = fileManager.getTempPath(`demucs-${runId}`);

    await fs.ensureDir(outputDir);

    // Copy input to temp with safe ASCII filename (fix Korean encoding issue on Windows)
    const safeInputName = `input-${runId}.mp3`;
    const safeInputPath = fileManager.getTempPath(safeInputName);
    await fs.copy(inputPath, safeInputPath);

    // Find FFmpeg path before creating the Promise
    const ffmpegDir = await this.findFfmpegPath();

    const runnerPath = path.join(__dirname, 'demucs_runner.py');

    // Use Python from virtual environment directly
    const pythonPath = path.join(fileManager.rootDir, '.venv', 'Scripts', 'python.exe');

    // Check if Python exists before spawning (must be outside Promise constructor)
    if (!await fs.pathExists(pythonPath)) {
      throw new Error(`Python not found at: ${pythonPath}. Please ensure virtual environment is set up.`);
    }

    // Run Demucs 4-stem separation
    await new Promise((resolve, reject) => {
      if (progressCallback) {
        progressCallback(0, '음원 분리 중 (Demucs AI)...');
      }

      const args = [
        runnerPath,
        '--input', safeInputPath,
        '--output', outputDir,
        '--model', 'htdemucs'
      ];

      console.log('Running Demucs 4-stem with Python:', pythonPath);
      console.log('Input file:', inputPath);
      console.log('Output dir:', outputDir);

      // Add FFmpeg to PATH for Demucs
      const env = { ...process.env };

      if (ffmpegDir) {
        env.PATH = `${ffmpegDir};${env.PATH}`;
      }

      try {
        this.currentProcess = spawn(pythonPath, args, {
          windowsHide: true,
          cwd: fileManager.rootDir,
          env: env,
          shell: true
        });
      } catch (spawnError) {
        reject(new Error(`Failed to spawn Python process: ${spawnError.message}`));
        return;
      }

      let stdout = '';
      let stderr = '';

      this.currentProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      this.currentProcess.stderr.on('data', (chunk) => {
        const data = chunk.toString();
        stderr += data;

        if (data.includes('%') && progressCallback) {
          const match = data.match(/(\d+)%/);
          if (match) {
            const percent = parseInt(match[1], 10);
            progressCallback(percent, `음원 분리 중 (${percent}%)...`);
          }
        }
      });

      this.currentProcess.on('error', (error) => {
        reject(new Error(`Demucs failed to start: ${error.message}`));
      });

      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;

        if (this.isCancelled) {
          reject(new Error('Separation cancelled'));
          return;
        }

        if (code !== 0) {
          const errorLines = stderr.split('\n').filter(line =>
            !line.includes('%|') &&
            !line.includes('[00:') &&
            line.trim() !== ''
          ).join('\n');
          reject(new Error(`Demucs failed (code ${code}): ${errorLines}`));
          return;
        }

        resolve();
      });
    });

    // Delete temp input file
    await fileManager.deleteFile(safeInputPath);

    // Verify 4-stem output files exist (use safe input name for stem dir)
    const baseName = path.parse(safeInputPath).name;
    const stemDir = path.join(outputDir, 'htdemucs', baseName);

    const vocalsPath = path.join(stemDir, 'vocals.wav');
    const bassPath = path.join(stemDir, 'bass.wav');
    const otherPath = path.join(stemDir, 'other.wav');

    const [vocalsExists, bassExists, otherExists] = await Promise.all([
      fileManager.fileExists(vocalsPath),
      fileManager.fileExists(bassPath),
      fileManager.fileExists(otherPath)
    ]);

    if (!vocalsExists || !bassExists || !otherExists) {
      throw new Error('Demucs 4-stem output not found. Please confirm Demucs is installed.');
    }

    // Mix bass + other → accompaniment
    if (progressCallback) {
      progressCallback(95, '반주 트랙 합성 중...');
    }

    const accompPath = path.join(stemDir, 'accomp.wav');
    await this.mixStemsToAccompaniment(bassPath, otherPath, accompPath);

    if (progressCallback) {
      progressCallback(100, '음원 분리 완료');
    }

    return {
      melodyPath: vocalsPath,
      accompPath: accompPath,
      cleanupDir: outputDir
    };
  }

  cancel() {
    this.isCancelled = true;
    if (this.currentProcess) {
      this.currentProcess.kill('SIGKILL');
    }
  }
}

module.exports = new StemSeparator();
