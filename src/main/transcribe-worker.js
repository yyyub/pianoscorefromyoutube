const { parentPort, workerData } = require('worker_threads');
const { BasicPitch, addPitchBendsToNoteEvents, outputToNotesPoly, noteFramesToTime } = require('@spotify/basic-pitch');
const { Midi } = require('@tonejs/midi');
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
    throw new Error('FFmpeg is not installed.');
  }

  const ffmpegBinary = audioConverter.ffmpegPath || 'ffmpeg';

  return new Promise((resolve, reject) => {
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
    currentProcess.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    currentProcess.on('error', (error) => {
      reject(new Error(`FFmpeg decode error: ${error.message}`));
    });

    currentProcess.on('close', (code) => {
      currentProcess = null;
      if (isCancelled) { reject(new Error('Cancelled')); return; }
      if (code !== 0) { reject(new Error(`FFmpeg decode failed: ${stderr}`)); return; }

      const buffer = Buffer.concat(stdoutChunks);
      if (buffer.length === 0) { reject(new Error('Decoded audio is empty')); return; }
      if (buffer.length % 4 !== 0) { reject(new Error('Invalid audio byte length')); return; }

      const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
      resolve(float32);
    });
  });
}

function quantizeTime(time, bpm, subdivision) {
  const beatDuration = 60.0 / bpm;
  const stepDuration = beatDuration / subdivision;
  return Math.round(time / stepDuration) * stepDuration;
}

function estimateBPM(notes) {
  if (!notes || notes.length < 4) return 120;

  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const intervals = [];
  for (let i = 1; i < Math.min(sorted.length, 200); i++) {
    const diff = sorted[i].startTimeSeconds - sorted[i - 1].startTimeSeconds;
    if (diff > 0.05 && diff < 2.0) {
      intervals.push(diff);
    }
  }

  if (intervals.length === 0) return 120;

  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  const bpm = Math.round(60.0 / median);

  if (bpm < 40) return 80;
  if (bpm > 240) return 120;
  return bpm;
}

function mergeDuplicateNotes(notes) {
  if (!notes || notes.length === 0) return notes;

  const sorted = [...notes].sort((a, b) => {
    if (a.pitchMidi !== b.pitchMidi) return a.pitchMidi - b.pitchMidi;
    return a.startTimeSeconds - b.startTimeSeconds;
  });

  const merged = [];
  let prev = null;

  for (const note of sorted) {
    if (prev && prev.pitchMidi === note.pitchMidi) {
      const gap = note.startTimeSeconds - (prev.startTimeSeconds + prev.durationSeconds);
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

function applyQualityFilters(notes, mode, hand, bpm) {
  if (!notes || notes.length === 0) return notes;

  let minDuration, minVelocity, maxPolyphony, quantizeSubdivision;

  if (mode === 'beginner') {
    minDuration = hand === 'left' ? 0.25 : 0.20;
    minVelocity = hand === 'left' ? 0.25 : 0.30;
    maxPolyphony = 2;
    quantizeSubdivision = 2;
  } else if (mode === 'intermediate') {
    minDuration = hand === 'left' ? 0.15 : 0.10;
    minVelocity = hand === 'left' ? 0.18 : 0.20;
    maxPolyphony = 3;
    quantizeSubdivision = 4;
  } else if (mode === 'advanced') {
    minDuration = hand === 'left' ? 0.08 : 0.06;
    minVelocity = hand === 'left' ? 0.12 : 0.15;
    maxPolyphony = hand === 'left' ? 4 : 5;
    quantizeSubdivision = 8;
  } else {
    minDuration = hand === 'left' ? 0.15 : 0.10;
    minVelocity = hand === 'left' ? 0.18 : 0.20;
    maxPolyphony = 3;
    quantizeSubdivision = 4;
  }

  // Step 1: Remove short and quiet notes
  let filtered = notes.filter(note => (
    note.durationSeconds >= minDuration && note.amplitude >= minVelocity
  ));

  // Step 2: Merge overlapping notes
  filtered = mergeDuplicateNotes(filtered);

  // Step 3: Quantize timing
  filtered = filtered.map(note => {
    const qStart = quantizeTime(note.startTimeSeconds, bpm, quantizeSubdivision);
    const qEnd = quantizeTime(note.startTimeSeconds + note.durationSeconds, bpm, quantizeSubdivision);
    const qDuration = Math.max(qEnd - qStart, 60.0 / bpm / quantizeSubdivision);
    return { ...note, startTimeSeconds: qStart, durationSeconds: qDuration };
  });

  // Step 4: Limit polyphony
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

/**
 * Transcribe a single audio file using Basic Pitch.
 */
async function transcribeAudio(basicPitch, audioPath, qualityMode, progressBase, progressRange, label) {
  sendProgress(progressBase, `${label}: 오디오 디코딩...`);
  const audioData = await decodeAudioToFloat32(audioPath);

  if (isCancelled) throw new Error('Cancelled');

  const frames = [];
  const onsets = [];
  const contours = [];

  sendProgress(progressBase + 5, `${label}: AI 분석 중...`);

  await basicPitch.evaluateModel(
    audioData,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (percent) => {
      if (isCancelled) return;
      const scaled = progressBase + 5 + Math.round(percent * (progressRange - 10));
      sendProgress(scaled, `${label}: AI 분석 ${Math.round(percent * 100)}%`);
    }
  );

  if (isCancelled) throw new Error('Cancelled');

  let onsetThresh, frameThresh, minNoteLen;
  if (qualityMode === 'beginner') {
    onsetThresh = 0.55; frameThresh = 0.45; minNoteLen = 13;
  } else if (qualityMode === 'intermediate') {
    onsetThresh = 0.45; frameThresh = 0.40; minNoteLen = 11;
  } else if (qualityMode === 'advanced') {
    onsetThresh = 0.30; frameThresh = 0.30; minNoteLen = 7;
  } else {
    onsetThresh = 0.45; frameThresh = 0.40; minNoteLen = 11;
  }

  const rawNotes = outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minNoteLen);
  const notesWithBends = addPitchBendsToNoteEvents(contours, rawNotes);
  const timedNotes = noteFramesToTime(notesWithBends);

  return timedNotes.filter(note => note.pitchMidi >= 21 && note.pitchMidi <= 108);
}

async function run() {
  try {
    await fileManager.initialize();

    sendProgress(5, 'AI 모델 로딩...');
    const options = workerData.options || {};
    const outputFilename = fileManager.generateUniqueFilename('.mid');
    const outputPath = fileManager.getTempPath(outputFilename);

    const model = await loadModelFromDisk();
    const basicPitch = new BasicPitch(model);

    let rightHandNotes, leftHandNotes;

    const hasStemPaths = options.melodyPath && options.accompPath;

    if (hasStemPaths) {
      // ====== 2-PASS MODE: Vocals → right hand, Accompaniment → left hand ======
      sendProgress(10, '보컬(멜로디) 전사 중...');

      // Pass 1: Transcribe vocals → melody (right hand)
      const melodyNotes = await transcribeAudio(
        basicPitch, options.melodyPath, options.qualityMode,
        10, 40, '멜로디'
      );

      if (isCancelled) throw new Error('Cancelled');

      // Check if vocal stem has enough notes (fallback for instrumental songs)
      if (melodyNotes.length < 10) {
        console.log(`Vocal stem has only ${melodyNotes.length} notes — falling back to pitch-based split`);
        const allNotes = await transcribeAudio(
          basicPitch, options.accompPath, options.qualityMode,
          50, 40, '전체 전사'
        );
        rightHandNotes = allNotes.filter(n => n.pitchMidi >= 60);
        leftHandNotes = allNotes.filter(n => n.pitchMidi < 60);
      } else {
        // Pass 2: Transcribe accompaniment → left hand
        sendProgress(50, '반주(베이스+기타) 전사 중...');
        const accompNotes = await transcribeAudio(
          basicPitch, options.accompPath, options.qualityMode,
          50, 40, '반주'
        );

        // Right hand: melody notes (vocals, keep notes >= 48 = C3)
        rightHandNotes = melodyNotes.filter(n => n.pitchMidi >= 48);

        // Left hand: accompaniment notes (keep notes < 72 = C5 to avoid overlap with melody)
        leftHandNotes = accompNotes.filter(n => n.pitchMidi < 72);
      }
    } else {
      // ====== SINGLE-PASS MODE: Split by pitch (no separation) ======
      const audioPath = workerData.audioPath;
      sendProgress(10, 'AI 전사 중...');

      const allNotes = await transcribeAudio(
        basicPitch, audioPath, options.qualityMode,
        10, 80, '전사'
      );

      rightHandNotes = allNotes.filter(n => n.pitchMidi >= 60);
      leftHandNotes = allNotes.filter(n => n.pitchMidi < 60);
    }

    if (isCancelled) throw new Error('Cancelled');

    sendProgress(92, 'MIDI 생성 중...');

    // Estimate BPM from all notes combined
    const allNotes = [...(rightHandNotes || []), ...(leftHandNotes || [])];
    const bpm = estimateBPM(allNotes);

    // Apply quality filters per hand
    const filteredRight = applyQualityFilters(rightHandNotes, options.qualityMode, 'right', bpm);
    const filteredLeft = applyQualityFilters(leftHandNotes, options.qualityMode, 'left', bpm);

    console.log(`BPM: ${bpm}, Right hand: ${filteredRight.length} notes, Left hand: ${filteredLeft.length} notes`);

    // Create 2-track MIDI
    const midi = new Midi();
    midi.header.setTempo(bpm);

    const rightTrack = midi.addTrack();
    rightTrack.name = 'Right Hand';
    rightTrack.channel = 0;
    rightTrack.instrument.number = 0;

    filteredRight.forEach(note => {
      rightTrack.addNote({
        midi: note.pitchMidi,
        time: note.startTimeSeconds,
        duration: note.durationSeconds,
        velocity: note.amplitude,
      });
    });

    const leftTrack = midi.addTrack();
    leftTrack.name = 'Left Hand';
    leftTrack.channel = 1;
    leftTrack.instrument.number = 0;

    filteredLeft.forEach(note => {
      leftTrack.addNote({
        midi: note.pitchMidi,
        time: note.startTimeSeconds,
        duration: note.durationSeconds,
        velocity: note.amplitude,
      });
    });

    const midiData = Buffer.from(midi.toArray());

    await fs.writeFile(outputPath, midiData);
    sendProgress(100, '전사 완료');

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
