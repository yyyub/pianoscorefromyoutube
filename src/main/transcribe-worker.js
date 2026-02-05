const { parentPort, workerData } = require('worker_threads');
const { BasicPitch, addPitchBendsToNoteEvents, outputToNotesPoly, noteFramesToTime } = require('@spotify/basic-pitch');
const { generateFileData } = require('@spotify/basic-pitch/cjs/toMidi');
const tf = require('@tensorflow/tfjs');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const fileManager = require('./file-manager');
const audioConverter = require('./audio-converter');

let isCancelled = false;
let currentProcess = null;

function sendProgress(percent, message) {
  if (parentPort) {
    parentPort.postMessage({ type: 'progress', percent, message });
  }
}

function sendResult(payload) {
  if (parentPort) {
    parentPort.postMessage({ type: 'result', payload });
  }
}

function sendError(message) {
  if (parentPort) {
    parentPort.postMessage({ type: 'error', message });
  }
}

async function loadModelFromDisk() {
  const modelDir = path.join(__dirname, '..', '..', 'node_modules', '@spotify', 'basic-pitch', 'model');
  const modelPath = path.join(modelDir, 'model.json');

  const modelJson = await fs.readJson(modelPath);
  if (!modelJson || !modelJson.modelTopology || !modelJson.weightsManifest) {
    throw new Error('Invalid Basic Pitch model files');
  }

  const weightSpecs = [];
  const weightBuffers = [];

  for (const group of modelJson.weightsManifest) {
    if (group.weights) {
      weightSpecs.push(...group.weights);
    }
    if (group.paths) {
      for (const relativePath of group.paths) {
        const weightPath = path.join(modelDir, relativePath);
        const weightBuffer = await fs.readFile(weightPath);
        weightBuffers.push(weightBuffer);
      }
    }
  }

  const combinedWeights = Buffer.concat(weightBuffers);
  const weightData = combinedWeights.buffer.slice(
    combinedWeights.byteOffset,
    combinedWeights.byteOffset + combinedWeights.byteLength
  );

  const modelArtifacts = {
    modelTopology: modelJson.modelTopology,
    weightSpecs,
    weightData,
    format: modelJson.format,
    generatedBy: modelJson.generatedBy,
    convertedBy: modelJson.convertedBy
  };

  const handler = tf.io.fromMemory(modelArtifacts);
  return tf.loadGraphModel(handler);
}

async function decodeAudioToFloat32(audioPath) {
  const isInstalled = await audioConverter.checkFfmpegInstalled();
  if (!isInstalled) {
    throw new Error('FFmpeg is not installed. Please install FFmpeg from https://ffmpeg.org/download.html');
  }

  const ffmpegBinary = audioConverter.ffmpegPath || 'ffmpeg';

  return new Promise((resolve, reject) => {
    sendProgress(20, 'Decoding audio for AI...');

    const args = [
      '-i', audioPath,
      '-f', 'f32le',
      '-ac', '1',
      '-ar', '22050',
      '-hide_banner',
      '-loglevel', 'error',
      '-'
    ];

    currentProcess = spawn(ffmpegBinary, args, { windowsHide: true });

    const stdoutChunks = [];
    let stderr = '';

    currentProcess.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    currentProcess.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    currentProcess.on('error', (error) => {
      reject(new Error(`FFmpeg decode error: ${error.message}`));
    });

    currentProcess.on('close', (code) => {
      currentProcess = null;

      if (isCancelled) {
        reject(new Error('Transcription cancelled'));
        return;
      }

      if (code !== 0) {
        reject(new Error(`FFmpeg decode failed: ${stderr || `exit code ${code}`}`));
        return;
      }

      const buffer = Buffer.concat(stdoutChunks);
      if (buffer.length === 0) {
        reject(new Error('Decoded audio is empty'));
        return;
      }
      if (buffer.length % 4 !== 0) {
        reject(new Error('Decoded audio has invalid byte length'));
        return;
      }

      const float32 = new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / 4
      );

      resolve(float32);
    });
  });
}

function applyQualityFilters(notes, mode) {
  if (!notes || notes.length === 0) return notes;

  if (mode === 'high') {
    const minDuration = 0.08;
    const minVelocity = 0.15;
    const maxPolyphony = 8;

    const filtered = notes.filter(note => (
      note.durationSeconds >= minDuration && note.amplitude >= minVelocity
    ));

    filtered.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

    const grouped = [];
    let group = [];
    let lastTime = null;
    const eps = 0.02;

    filtered.forEach(note => {
      if (lastTime === null || Math.abs(note.startTimeSeconds - lastTime) <= eps) {
        group.push(note);
      } else {
        grouped.push(group);
        group = [note];
      }
      lastTime = note.startTimeSeconds;
    });
    if (group.length) grouped.push(group);

    const reduced = grouped.flatMap(g => g
      .sort((a, b) => b.amplitude - a.amplitude)
      .slice(0, maxPolyphony)
    );

    return reduced;
  }

  return notes;
}

async function run() {
  try {
    await fileManager.initialize();

    sendProgress(10, 'Loading audio file...');
    const audioPath = workerData.audioPath;
    const options = workerData.options || {};
    const outputFilename = fileManager.generateUniqueFilename('.mid');
    const outputPath = fileManager.getTempPath(outputFilename);

    const modelPromise = await loadModelFromDisk();
    const basicPitch = new BasicPitch(modelPromise);

    const audioData = await decodeAudioToFloat32(audioPath);

    if (isCancelled) {
      throw new Error('Transcription cancelled');
    }

    const frames = [];
    const onsets = [];
    const contours = [];

    sendProgress(30, 'Analyzing audio with AI...');

    await basicPitch.evaluateModel(
      audioData,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (percent) => {
        if (isCancelled) {
          return;
        }
        const scaled = 30 + Math.round(percent * 50);
        sendProgress(scaled, `Analyzing audio with AI: ${Math.round(percent * 100)}%`);
      }
    );

    if (isCancelled) {
      throw new Error('Transcription cancelled');
    }

    sendProgress(85, 'Generating MIDI...');

    const onsetThresh = options.qualityMode === 'high' ? 0.35 : 0.25;
    const frameThresh = options.qualityMode === 'high' ? 0.35 : 0.25;
    const minNoteLen = options.qualityMode === 'high' ? 8 : 5;

    const rawNotes = outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minNoteLen);
    const notesWithBends = addPitchBendsToNoteEvents(contours, rawNotes);
    const timedNotes = noteFramesToTime(notesWithBends);
    const pianoNotes = timedNotes.filter(note => note.pitchMidi >= 21 && note.pitchMidi <= 108);
    const finalNotes = applyQualityFilters(pianoNotes, options.qualityMode);
    const midiData = generateFileData(finalNotes);

    await fs.writeFile(outputPath, Buffer.from(midiData));
    sendProgress(100, 'Transcription complete');

    sendResult({
      filePath: outputPath,
      filename: outputFilename
    });
  } catch (error) {
    sendError(error.message || String(error));
  }
}

if (parentPort) {
  parentPort.on('message', (message) => {
    if (message && message.type === 'cancel') {
      isCancelled = true;
      if (currentProcess) {
        currentProcess.kill('SIGKILL');
      }
    }
  });
}

run();
