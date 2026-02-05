const Vex = require('vexflow');
const { createCanvas } = require('canvas');
const puppeteer = require('puppeteer');
const { Midi } = require('@tonejs/midi');
const fs = require('fs-extra');
const path = require('path');
const fileManager = require('./file-manager');

class SheetGenerator {
  constructor() {
    this.isCancelled = false;
  }

  async parseMidiFile(midiPath) {
    try {
      const midiBuffer = await fs.readFile(midiPath);
      const midi = new Midi(midiBuffer);

      const tempo = midi.header.tempos && midi.header.tempos.length > 0
        ? midi.header.tempos[0].bpm
        : 120;

      const timeSigEntry = midi.header.timeSignatures && midi.header.timeSignatures.length > 0
        ? midi.header.timeSignatures[0].timeSignature
        : [4, 4];

      const timeSignature = `${timeSigEntry[0]}/${timeSigEntry[1]}`;

      const notes = [];
      midi.tracks.forEach(track => {
        track.notes.forEach(note => {
          notes.push({
            midi: note.midi,
            time: note.time,
            duration: note.duration,
            velocity: note.velocity
          });
        });
      });

      return {
        notes,
        timeSignature,
        tempo,
        keySignature: 'C'
      };
    } catch (error) {
      throw new Error(`Failed to parse MIDI file: ${error.message}`);
    }
  }

  quantize(value, step) {
    return Math.max(step, Math.round(value / step) * step);
  }

  beatsToDuration(beats) {
    const options = [
      { beats: 4, dur: 'w' },
      { beats: 2, dur: 'h' },
      { beats: 1, dur: 'q' },
      { beats: 0.5, dur: '8' },
      { beats: 0.25, dur: '16' }
    ];

    let best = options[options.length - 1];
    let minDiff = Infinity;
    for (const option of options) {
      const diff = Math.abs(beats - option.beats);
      if (diff < minDiff) {
        minDiff = diff;
        best = option;
      }
    }

    return best;
  }

  splitBeats(beats) {
    const segments = [];
    const options = [4, 2, 1, 0.5, 0.25];
    let remaining = beats;

    for (const option of options) {
      while (remaining >= option - 1e-6) {
        segments.push(option);
        remaining -= option;
      }
    }

    if (remaining > 1e-3) {
      segments.push(0.25);
    }

    return segments;
  }

  midiToKey(midi) {
    const names = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
    const name = names[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${name}/${octave}`;
  }

  addAccidentals(staveNote, keys) {
    // VexFlow v5 in node-canvas may not expose addAccidental on StaveNote.
    // Skip accidentals to avoid runtime errors.
    return;
  }

  buildMeasures(notes, tempo, timeSignature) {
    const [numerator, denominator] = timeSignature.split('/').map(Number);
    const beatsPerMeasure = Number.isFinite(numerator) ? numerator : 4;
    const beatValue = Number.isFinite(denominator) ? denominator : 4;
    const beatDuration = 60 / tempo;
    const quantizeStep = 0.25;

    const trebleMap = new Map();
    const bassMap = new Map();

    const addToMap = (map, note) => {
      const startBeat = this.quantize(note.time / beatDuration, quantizeStep);
      let durationBeats = this.quantize(note.duration / beatDuration, quantizeStep);
      durationBeats = Math.max(quantizeStep, durationBeats);

      const measureIndex = Math.floor(startBeat / beatsPerMeasure);
      const startInMeasure = startBeat - measureIndex * beatsPerMeasure;
      const key = `${startInMeasure.toFixed(3)}:${durationBeats.toFixed(3)}`;

      if (!map.has(measureIndex)) {
        map.set(measureIndex, new Map());
      }

      const measureMap = map.get(measureIndex);
      if (!measureMap.has(key)) {
        measureMap.set(key, {
          startBeat: startInMeasure,
          durationBeats,
          notes: []
        });
      }

      measureMap.get(key).notes.push(note.midi);
    };

    notes.forEach(note => {
      if (note.midi >= 60) {
        addToMap(trebleMap, note);
      } else {
        addToMap(bassMap, note);
      }
    });

    const maxMeasure = Math.max(
      trebleMap.size ? Math.max(...trebleMap.keys()) : 0,
      bassMap.size ? Math.max(...bassMap.keys()) : 0
    );

    const buildArray = (map) => {
      const measures = [];
      for (let i = 0; i <= maxMeasure; i++) {
        const measureMap = map.get(i);
        const events = measureMap ? Array.from(measureMap.values()) : [];
        events.sort((a, b) => a.startBeat - b.startBeat);
        measures.push(events);
      }
      return measures;
    };

    return {
      measuresTreble: buildArray(trebleMap),
      measuresBass: buildArray(bassMap),
      beatsPerMeasure,
      beatValue
    };
  }

  buildTickables(events, beatsPerMeasure, restKey) {
    const tickables = [];
    let cursor = 0;

    const addRest = (beats) => {
      let remaining = beats;
      while (remaining > 1e-3) {
        const segment = Math.min(remaining, 4);
        const dur = this.beatsToDuration(segment).dur + 'r';
        tickables.push(new Vex.StaveNote({
          keys: [restKey],
          duration: dur
        }));
        remaining -= segment;
      }
    };

    events.forEach(event => {
      if (event.startBeat > cursor) {
        addRest(event.startBeat - cursor);
        cursor = event.startBeat;
      }

      let remaining = Math.min(event.durationBeats, beatsPerMeasure - cursor);
      if (remaining <= 0) {
        return;
      }

      const keys = event.notes
        .sort((a, b) => a - b)
        .map(midi => this.midiToKey(midi));

      while (remaining > 1e-3 && cursor < beatsPerMeasure - 1e-6) {
        const segment = Math.min(remaining, beatsPerMeasure - cursor);
        const { dur } = this.beatsToDuration(segment);

        const staveNote = new Vex.StaveNote({
          keys,
          duration: dur
        });

        this.addAccidentals(staveNote, keys);
        tickables.push(staveNote);

        cursor += segment;
        remaining -= segment;
      }
    });

    if (cursor < beatsPerMeasure) {
      addRest(beatsPerMeasure - cursor);
    }

    if (tickables.length === 0) {
      tickables.push(new Vex.StaveNote({ keys: [restKey], duration: 'wr' }));
    }

    return tickables;
  }

  async generatePianoStaff(notes, metadata) {
    const canvas = createCanvas(800, 1100);
    const rawContext = canvas.getContext('2d');
    const context2d = new Vex.CanvasContext(rawContext);

    rawContext.fillStyle = 'white';
    rawContext.fillRect(0, 0, canvas.width, canvas.height);

    const timeSignature = metadata.timeSignature || '4/4';
    const tempo = metadata.tempo || 120;

    const {
      measuresTreble,
      measuresBass,
      beatsPerMeasure,
      beatValue
    } = this.buildMeasures(notes, tempo, timeSignature);

    const totalMeasures = Math.max(measuresTreble.length, measuresBass.length);
    if (totalMeasures === 0) {
      return canvas;
    }

    const margin = 20;
    const measuresPerLine = 4;
    const measureWidth = (canvas.width - margin * 2) / measuresPerLine;
    const lineHeight = 160;

    let currentMeasure = 0;
    let line = 0;

    while (currentMeasure < totalMeasures && margin + line * lineHeight + 120 < canvas.height) {
      const y = margin + line * lineHeight;

      for (let i = 0; i < measuresPerLine && currentMeasure < totalMeasures; i++) {
        const x = margin + i * measureWidth;

        const trebleStave = new Vex.Stave(x, y, measureWidth);
        const bassStave = new Vex.Stave(x, y + 70, measureWidth);

        if (currentMeasure === 0 && i === 0) {
          trebleStave.addClef('treble');
          trebleStave.addTimeSignature(timeSignature);
          bassStave.addClef('bass');
          bassStave.addTimeSignature(timeSignature);
        }

        trebleStave.setContext(context2d).draw();
        bassStave.setContext(context2d).draw();

        if (i === 0) {
          new Vex.StaveConnector(trebleStave, bassStave)
            .setType(Vex.StaveConnector.type.BRACE)
            .setContext(context2d)
            .draw();
          new Vex.StaveConnector(trebleStave, bassStave)
            .setType(Vex.StaveConnector.type.SINGLE_LEFT)
            .setContext(context2d)
            .draw();
        }

        new Vex.StaveConnector(trebleStave, bassStave)
          .setType(Vex.StaveConnector.type.SINGLE_RIGHT)
          .setContext(context2d)
          .draw();

        const trebleEvents = measuresTreble[currentMeasure] || [];
        const bassEvents = measuresBass[currentMeasure] || [];

        const trebleTickables = this.buildTickables(trebleEvents, beatsPerMeasure, 'b/4');
        const bassTickables = this.buildTickables(bassEvents, beatsPerMeasure, 'd/3');

        const trebleVoice = new Vex.Voice({
          num_beats: beatsPerMeasure,
          beat_value: beatValue
        }).setStrict(false).addTickables(trebleTickables);

        const bassVoice = new Vex.Voice({
          num_beats: beatsPerMeasure,
          beat_value: beatValue
        }).setStrict(false).addTickables(bassTickables);

        const formatter = new Vex.Formatter();
        formatter.joinVoices([trebleVoice]).format([trebleVoice], measureWidth - 10);
        formatter.joinVoices([bassVoice]).format([bassVoice], measureWidth - 10);

        trebleVoice.draw(context2d, trebleStave);
        bassVoice.draw(context2d, bassStave);

        currentMeasure += 1;
      }

      line += 1;
    }

    return canvas;
  }

  async createVexFlowScore(notes, metadata) {
    try {
      // Create the piano staff with VexFlow
      const canvas = await this.generatePianoStaff(notes, metadata);
      return canvas;
    } catch (error) {
      throw new Error(`Failed to create score: ${error.message}`);
    }
  }

  async renderToCanvas(score) {
    // The score is already a canvas from VexFlow
    return score;
  }

  async exportToPdf(canvas, outputPath, videoTitle) {
    try {
      // Convert canvas to data URL
      const dataUrl = canvas.toDataURL('image/png');

      // Create HTML with the image
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              margin: 0;
              padding: 20px;
              font-family: Arial, sans-serif;
            }
            h1 {
              text-align: center;
              margin-bottom: 20px;
            }
            img {
              max-width: 100%;
              height: auto;
            }
          </style>
        </head>
        <body>
          <h1>${videoTitle || 'Piano Sheet Music'}</h1>
          <img src="${dataUrl}" alt="Sheet Music" />
          <p style="text-align: center; margin-top: 20px; color: #666;">
            Generated by YouTube to Piano Sheet Music
          </p>
        </body>
        </html>
      `;

      // Use puppeteer to convert HTML to PDF
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      await page.pdf({
        path: outputPath,
        format: 'Letter',
        printBackground: true,
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px'
        }
      });

      await browser.close();

      return outputPath;
    } catch (error) {
      throw new Error(`Failed to export PDF: ${error.message}`);
    }
  }

  async generateSheetMusic(midiPath, videoTitle, progressCallback) {
    this.isCancelled = false;

    const outputFilename = fileManager.sanitizeFilename(`${videoTitle || 'sheet-music'}.pdf`);
    const outputPath = fileManager.getTempPath(outputFilename);

    try {
      if (progressCallback) {
        progressCallback(10, 'Parsing MIDI file...');
      }

      // Parse MIDI file
      const midiData = await this.parseMidiFile(midiPath);

      if (this.isCancelled) {
        throw new Error('Sheet generation cancelled');
      }

      if (progressCallback) {
        progressCallback(30, 'Creating sheet music...');
      }

      // Create VexFlow score
      const score = await this.createVexFlowScore(midiData.notes, midiData);

      if (this.isCancelled) {
        throw new Error('Sheet generation cancelled');
      }

      if (progressCallback) {
        progressCallback(60, 'Rendering to canvas...');
      }

      // Render to canvas
      const canvas = await this.renderToCanvas(score);

      if (this.isCancelled) {
        throw new Error('Sheet generation cancelled');
      }

      if (progressCallback) {
        progressCallback(80, 'Exporting to PDF...');
      }

      // Export to PDF
      await this.exportToPdf(canvas, outputPath, videoTitle);

      if (progressCallback) {
        progressCallback(100, 'PDF generation complete');
      }

      // Move to output directory
      const finalPath = await fileManager.moveToOutput(outputPath, outputFilename);

      return {
        filePath: finalPath,
        filename: outputFilename
      };
    } catch (error) {
      await fileManager.deleteFile(outputPath);

      if (error.message.includes('cancelled')) {
        throw error;
      }

      console.error('Sheet generation error:', error);
      throw new Error(`Sheet generation failed: ${error.message}`);
    }
  }

  cancel() {
    this.isCancelled = true;
  }
}

module.exports = new SheetGenerator();
