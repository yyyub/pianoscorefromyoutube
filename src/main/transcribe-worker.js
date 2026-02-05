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

function quantizeTime(time, bpm, subdivision) {
  // Quantize to nearest subdivision (e.g., 16th note)
  const beatDuration = 60.0 / bpm;
  const stepDuration = beatDuration / subdivision;
  return Math.round(time / stepDuration) * stepDuration;
}

function estimateBPM(notes) {
  if (!notes || notes.length < 4) return 120;

  // Calculate intervals between note onsets
  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const intervals = [];
  for (let i = 1; i < Math.min(sorted.length, 200); i++) {
    const diff = sorted[i].startTimeSeconds - sorted[i - 1].startTimeSeconds;
    if (diff > 0.05 && diff < 2.0) {
      intervals.push(diff);
    }
  }

  if (intervals.length === 0) return 120;

  // Find the most common interval (likely the beat)
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  const bpm = Math.round(60.0 / median);

  // Clamp to reasonable range
  if (bpm < 40) return 80;
  if (bpm > 240) return 120;
  return bpm;
}

function mergeDuplicateNotes(notes) {
  if (!notes || notes.length === 0) return notes;

  // Sort by pitch then start time
  const sorted = [...notes].sort((a, b) => {
    if (a.pitchMidi !== b.pitchMidi) return a.pitchMidi - b.pitchMidi;
    return a.startTimeSeconds - b.startTimeSeconds;
  });

  const merged = [];
  let prev = null;

  for (const note of sorted) {
    if (prev && prev.pitchMidi === note.pitchMidi) {
      const gap = note.startTimeSeconds - (prev.startTimeSeconds + prev.durationSeconds);
      // Merge if gap is less than 0.05s (notes that are practically continuous)
      if (gap < 0.05) {
        prev.durationSeconds = (note.startTimeSeconds + note.durationSeconds) - prev.startTimeSeconds;
        prev.amplitude = Math.max(prev.amplitude, note.amplitude);
        continue;
      }
    }
    merged.push(note);
    prev = note;
  }

  return merged;
}

function applyQualityFilters(notes, mode) {
  if (!notes || notes.length === 0) return notes;

  let minDuration, minVelocity, maxPolyphony, quantizeSubdivision;

  // Configure based on difficulty level
  if (mode === 'beginner') {
    // 초급: 매우 쉬운 악보 - 멜로디만, 박자 정렬 강함
    minDuration = 0.20;
    minVelocity = 0.35;
    maxPolyphony = 3;
    quantizeSubdivision = 2; // 8분음표 단위
  } else if (mode === 'intermediate') {
    // 중급: 적당한 난이도 - 화음 포함, 박자 정렬 중간
    minDuration = 0.12;
    minVelocity = 0.25;
    maxPolyphony = 5;
    quantizeSubdivision = 4; // 16분음표 단위
  } else if (mode === 'advanced') {
    // 고급: 원곡에 가까움 - 복잡한 화음, 박자 정렬 약함
    minDuration = 0.08;
    minVelocity = 0.20;
    maxPolyphony = 8;
    quantizeSubdivision = 8; // 32분음표 단위
  } else {
    // Default to intermediate
    minDuration = 0.12;
    minVelocity = 0.25;
    maxPolyphony = 5;
    quantizeSubdivision = 4;
  }

  // Step 1: Remove very short and very quiet notes
  let filtered = notes.filter(note => (
    note.durationSeconds >= minDuration && note.amplitude >= minVelocity
  ));

  // Step 2: Merge duplicate/overlapping notes
  filtered = mergeDuplicateNotes(filtered);

  // Step 3: Quantize note timing (박자 정렬)
  const bpm = estimateBPM(filtered);
  filtered = filtered.map(note => {
    const qStart = quantizeTime(note.startTimeSeconds, bpm, quantizeSubdivision);
    const qEnd = quantizeTime(note.startTimeSeconds + note.durationSeconds, bpm, quantizeSubdivision);
    const qDuration = Math.max(qEnd - qStart, 60.0 / bpm / quantizeSubdivision);
    return { ...note, startTimeSeconds: qStart, durationSeconds: qDuration };
  });

  // Step 4: Limit polyphony (simultaneous notes)
  filtered.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  const grouped = [];
  let group = [];
  let lastTime = null;
  const eps = 0.03;

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

    // Adjust thresholds based on difficulty
    let onsetThresh, frameThresh, minNoteLen;
    if (options.qualityMode === 'beginner') {
      onsetThresh = 0.6;  // Very strict - only clear notes
      frameThresh = 0.5;
      minNoteLen = 13;
    } else if (options.qualityMode === 'intermediate') {
      onsetThresh = 0.5;  // Moderate
      frameThresh = 0.45;
      minNoteLen = 11;
    } else if (options.qualityMode === 'advanced') {
      onsetThresh = 0.35; // More permissive
      frameThresh = 0.35;
      minNoteLen = 7;
    } else {
      // Default to intermediate
      onsetThresh = 0.5;
      frameThresh = 0.45;
      minNoteLen = 11;
    }

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
