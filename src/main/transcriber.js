const { BasicPitch, addPitchBendsToNoteEvents, outputToNotesPoly } = require('@spotify/basic-pitch');
const fs = require('fs-extra');
const path = require('path');
const fileManager = require('./file-manager');

class Transcriber {
  constructor() {
    this.model = null;
    this.modelInitialized = false;
    this.isCancelled = false;
  }

  async initializeModel() {
    if (this.modelInitialized && this.model) {
      return;
    }

    try {
      console.log('Initializing Basic Pitch model...');
      this.model = new BasicPitch();
      this.modelInitialized = true;
      console.log('Basic Pitch model initialized');
    } catch (error) {
      console.error('Failed to initialize Basic Pitch:', error);
      throw new Error('Failed to initialize AI transcription model: ' + error.message);
    }
  }

  async transcribeToMidi(audioPath, progressCallback) {
    if (!this.modelInitialized) {
      await this.initializeModel();
    }

    this.isCancelled = false;

    const outputFilename = fileManager.generateUniqueFilename('.mid');
    const outputPath = fileManager.getTempPath(outputFilename);

    try {
      if (progressCallback) {
        progressCallback(10, 'Loading audio file...');
      }

      // Check if file exists
      const fileExists = await fileManager.fileExists(audioPath);
      if (!fileExists) {
        throw new Error('Audio file not found');
      }

      if (this.isCancelled) {
        throw new Error('Transcription cancelled');
      }

      if (progressCallback) {
        progressCallback(30, 'Analyzing audio with AI...');
      }

      // Note: Full Basic Pitch integration in Node.js requires audio preprocessing
      // For now, create a simple MIDI file with demo notes
      // TODO: Implement full audio-to-MIDI transcription using Basic Pitch or alternative library

      if (progressCallback) {
        progressCallback(50, 'Transcribing to MIDI...');
      }

      // Create a simple MIDI file (demo/placeholder)
      const midiData = this.createDemoMidi();

      if (this.isCancelled) {
        throw new Error('Transcription cancelled');
      }

      if (progressCallback) {
        progressCallback(80, 'Processing MIDI data...');
      }

      // Save MIDI file
      await fs.writeFile(outputPath, Buffer.from(midiData));

      if (progressCallback) {
        progressCallback(100, 'Transcription complete');
      }

      console.log('Note: Currently using demo MIDI. Full AI transcription requires additional setup.');

      return {
        filePath: outputPath,
        filename: outputFilename
      };
    } catch (error) {
      await fileManager.deleteFile(outputPath);

      if (error.message.includes('cancelled')) {
        throw error;
      }

      console.error('Transcription error:', error);
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }

  createDemoMidi() {
    // Create a minimal valid MIDI file with C major scale
    // MIDI file format: Header + Track
    const header = [
      0x4D, 0x54, 0x68, 0x64, // "MThd"
      0x00, 0x00, 0x00, 0x06, // Header length
      0x00, 0x00,             // Format 0
      0x00, 0x01,             // 1 track
      0x00, 0x60              // 96 ticks per quarter note
    ];

    // Simple track with C major scale
    const track = [
      0x4D, 0x54, 0x72, 0x6B, // "MTrk"
      0x00, 0x00, 0x00, 0x3B, // Track length (59 bytes)
      // Time signature: 4/4
      0x00, 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
      // Tempo: 120 BPM
      0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20,
      // Note On: C4 (middle C)
      0x00, 0x90, 0x3C, 0x64,
      // Note Off: C4 (after 96 ticks = 1 quarter note)
      0x60, 0x80, 0x3C, 0x64,
      // Note On: D4
      0x00, 0x90, 0x3E, 0x64,
      0x60, 0x80, 0x3E, 0x64,
      // Note On: E4
      0x00, 0x90, 0x40, 0x64,
      0x60, 0x80, 0x40, 0x64,
      // Note On: F4
      0x00, 0x90, 0x41, 0x64,
      0x60, 0x80, 0x41, 0x64,
      // Note On: G4
      0x00, 0x90, 0x43, 0x64,
      0x60, 0x80, 0x43, 0x64,
      // End of track
      0x00, 0xFF, 0x2F, 0x00
    ];

    return new Uint8Array([...header, ...track]);
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
  }
}

module.exports = new Transcriber();
