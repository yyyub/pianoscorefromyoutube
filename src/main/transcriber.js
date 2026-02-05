const path = require('path');
const { Worker } = require('worker_threads');

class Transcriber {
  constructor() {
    this.isCancelled = false;
    this.worker = null;
  }

  async transcribeToMidi(audioPath, progressCallback, options = {}) {
    this.isCancelled = false;
    if (this.worker) {
      throw new Error('Transcription already in progress');
    }

    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, 'transcribe-worker.js');
      const worker = new Worker(workerPath, { workerData: { audioPath, options } });
      this.worker = worker;

      let lastProgressAt = 0;
      const reportProgress = (percent, message) => {
        const now = Date.now();
        if (percent === 100 || now - lastProgressAt > 250) {
          lastProgressAt = now;
          if (progressCallback) {
            progressCallback(percent, message);
          }
        }
      };

      const cleanup = () => {
        this.worker = null;
      };

      worker.on('message', (message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'progress') {
          reportProgress(message.percent, message.message);
          return;
        }
        if (message.type === 'result') {
          cleanup();
          resolve(message.payload);
          return;
        }
        if (message.type === 'error') {
          cleanup();
          reject(new Error(`Transcription failed: ${message.message}`));
        }
      });

      worker.on('error', (error) => {
        cleanup();
        reject(new Error(`Transcription failed: ${error.message}`));
      });

      worker.on('exit', (code) => {
        if (this.isCancelled) {
          cleanup();
          return;
        }
        if (code !== 0) {
          cleanup();
          reject(new Error(`Transcription failed: worker exited with code ${code}`));
        }
      });
    });
  }

  async processMidiForPiano(midiData) {
    // Filter notes to piano range (A0 to C8)
    // MIDI notes 21 (A0) to 108 (C8)
    const minNote = 21;
    const maxNote = 108;

    // This would process the MIDI data to filter by note range
    // For now, we assume the MIDI is already suitable for piano
    return midiData;
  }

  filterNotesByFrequency(notes, minFreq = 27.5, maxFreq = 4186) {
    // A0 = 27.5 Hz, C8 = 4186 Hz (piano range)
    return notes.filter(note => {
      const freq = this.midiNoteToFrequency(note.pitch);
      return freq >= minFreq && freq <= maxFreq;
    });
  }

  midiNoteToFrequency(midiNote) {
    // Convert MIDI note number to frequency in Hz
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  cancel() {
    this.isCancelled = true;
    if (this.worker) {
      this.worker.postMessage({ type: 'cancel' });
      this.worker.terminate();
      this.worker = null;
    }
  }
}

module.exports = new Transcriber();
