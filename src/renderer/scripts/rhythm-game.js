// Rhythm Game Engine
// 7-key falling note rhythm game: S D F [Space] J K L
// Features: long notes, judge difficulty, auto difficulty analysis

const JUDGE_PRESETS = {
  easy:      { perfect: 0.08, great: 0.14, good: 0.20, miss: 0.26 },
  normal:    { perfect: 0.05, great: 0.10, good: 0.15, miss: 0.20 },
  hard:      { perfect: 0.035, great: 0.07, good: 0.10, miss: 0.14 },
  'very-hard': { perfect: 0.02, great: 0.04, good: 0.07, miss: 0.10 }
};

class RhythmGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Lane configuration
    this.laneKeys = ['s', 'd', 'f', ' ', 'j', 'k', 'l'];
    this.laneLabels = ['S', 'D', 'F', 'SP', 'J', 'K', 'L'];
    this.laneColors = [
      '#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF',
      '#6BCB77', '#FFD93D', '#FF6B6B'
    ];

    // Timing windows (seconds) - defaults to normal
    this.perfectWindow = 0.05;
    this.greatWindow = 0.10;
    this.goodWindow = 0.15;
    this.missWindow = 0.20;

    // Long note threshold: notes longer than this are treated as long notes
    this.longNoteThreshold = 0.3; // seconds

    // Display settings
    this.noteSpeed = 400;
    this.noteHeight = 24;
    this.hitLineRatio = 0.85;

    // State
    this.gameState = 'idle';
    this.notes = [];
    this.processedNotes = new Set();
    this.longNoteHeld = {};    // noteId -> true if currently held
    this.longNoteScored = {};  // noteId -> accumulated score ticks
    this.currentTime = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.judgments = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.keyStates = {};
    this.animationId = null;
    this.lastTimestamp = 0;

    // Difficulty analysis
    this.difficultyLevel = 0; // 1-20

    // Effects
    this.judgmentEffects = [];
    this.hitEffects = [];
    this.comboAnimTime = 0;       // timestamp of last combo change (for pop animation)
    this.comboBurstEffects = [];  // big burst effects (long note complete, milestones)

    // Game mode: 'piano' (synth sounds) or 'vocal' (vocal gating)
    this.gameMode = 'piano';

    // Audio
    this.audioContext = null;
    this.audioBuffer = null;
    this.audioSource = null;
    this.audioStartTime = 0;
    this.songDuration = 0;
    this.audioOffset = 0;

    // Vocal mode audio
    this.vocalBuffer = null;
    this.vocalSource = null;
    this.vocalGainNode = null;
    this._vocalGateEndTimes = [];

    // Countdown
    this.countdownValue = 0;
    this.countdownStart = 0;

    // Callbacks
    this.onEnd = null;
    this.onScoreUpdate = null;

    // Bind
    this._boundKeyDown = (e) => this._handleKeyDown(e);
    this._boundKeyUp = (e) => this._handleKeyUp(e);
    this._boundResize = () => this._resize();
  }

  // ─── Judge Difficulty ─────────────────────────────────

  setJudgeDifficulty(preset) {
    const windows = JUDGE_PRESETS[preset] || JUDGE_PRESETS.normal;
    this.perfectWindow = windows.perfect;
    this.greatWindow = windows.great;
    this.goodWindow = windows.good;
    this.missWindow = windows.miss;
  }

  // ─── MIDI Loading ─────────────────────────────────────

  loadMidiData(midiData) {
    const allNotes = [];
    const tracks = midiData.tracks || [];

    let leftNotes = [];
    let rightNotes = [];

    for (const track of tracks) {
      const isLeft = track.name === 'Left Hand' || track.channel === 1;
      for (const note of track.notes) {
        (isLeft ? leftNotes : rightNotes).push(note.midi);
      }
    }

    const mapper = this._buildLaneMapper(leftNotes, rightNotes);

    let noteId = 0;
    for (const track of tracks) {
      const isLeft = track.name === 'Left Hand' || track.channel === 1;
      for (const note of track.notes) {
        const lane = this._noteToLane(note.midi, isLeft, mapper);
        const isLong = note.duration >= this.longNoteThreshold;
        allNotes.push({
          id: noteId++,
          lane,
          time: note.time,
          duration: note.duration,
          velocity: note.velocity,
          midi: note.midi,
          isLong
        });
      }
    }

    allNotes.sort((a, b) => a.time - b.time);

    // Deduplicate
    this.notes = [];
    for (const note of allNotes) {
      const existing = this.notes.find(n =>
        n.lane === note.lane && Math.abs(n.time - note.time) < 0.05
      );
      if (!existing) {
        this.notes.push(note);
      } else if (note.isLong && !existing.isLong) {
        // Prefer long note version
        Object.assign(existing, note);
      }
    }

    this.songDuration = midiData.header.duration || 0;
    if (this.notes.length > 0) {
      const lastNote = this.notes[this.notes.length - 1];
      this.songDuration = Math.max(this.songDuration, lastNote.time + lastNote.duration + 2);
    }

    // Auto-analyze difficulty
    this.difficultyLevel = this._analyzeDifficulty(midiData);
  }

  // ─── Difficulty Analysis ──────────────────────────────

  _analyzeDifficulty(midiData) {
    if (this.notes.length === 0) return 1;

    const duration = this.songDuration || 1;

    // Factor 1: Note density (notes per second) — max contribution: 6
    const nps = this.notes.length / duration;
    const densityScore = Math.min(6, Math.round(nps * 1.5));

    // Factor 2: Speed variation — how many rapid note transitions (< 100ms gap)
    let rapidCount = 0;
    for (let i = 1; i < this.notes.length; i++) {
      if (this.notes[i].time - this.notes[i - 1].time < 0.1) rapidCount++;
    }
    const rapidRatio = rapidCount / Math.max(1, this.notes.length);
    const speedScore = Math.min(5, Math.round(rapidRatio * 15));

    // Factor 3: Lane spread — how many lanes are actually used
    const lanesUsed = new Set(this.notes.map(n => n.lane)).size;
    const laneScore = Math.min(4, Math.round((lanesUsed / 7) * 4));

    // Factor 4: Long notes percentage — more long notes = harder
    const longCount = this.notes.filter(n => n.isLong).length;
    const longRatio = longCount / Math.max(1, this.notes.length);
    const longScore = Math.min(3, Math.round(longRatio * 6));

    // Factor 5: Polyphony (simultaneous notes in different lanes)
    let polyCount = 0;
    for (let i = 1; i < this.notes.length; i++) {
      if (Math.abs(this.notes[i].time - this.notes[i - 1].time) < 0.03 &&
          this.notes[i].lane !== this.notes[i - 1].lane) {
        polyCount++;
      }
    }
    const polyRatio = polyCount / Math.max(1, this.notes.length);
    const polyScore = Math.min(2, Math.round(polyRatio * 10));

    const total = densityScore + speedScore + laneScore + longScore + polyScore;
    return Math.max(1, Math.min(20, total));
  }

  _buildLaneMapper(leftMidis, rightMidis) {
    const hasLeft = leftMidis.length > 0;
    const hasRight = rightMidis.length > 0;

    if (!hasLeft && !hasRight) return { mode: 'empty' };

    if (!hasLeft || !hasRight) {
      const all = hasLeft ? leftMidis : rightMidis;
      const min = Math.min(...all);
      const max = Math.max(...all);
      return { mode: 'single', min, max, range: max - min || 12 };
    }

    const leftMin = Math.min(...leftMidis);
    const leftMax = Math.max(...leftMidis);
    const rightMin = Math.min(...rightMidis);
    const rightMax = Math.max(...rightMidis);

    return {
      mode: 'dual',
      leftMin, leftMax, leftRange: leftMax - leftMin || 12,
      rightMin, rightMax, rightRange: rightMax - rightMin || 12,
      overlapMin: Math.min(leftMax, rightMin),
      overlapMax: Math.max(leftMax, rightMin)
    };
  }

  _noteToLane(midiNote, isLeft, mapper) {
    if (mapper.mode === 'empty') return 3;

    if (mapper.mode === 'single') {
      const normalized = (midiNote - mapper.min) / mapper.range;
      return Math.min(6, Math.max(0, Math.floor(normalized * 7)));
    }

    if (isLeft) {
      if (midiNote >= mapper.overlapMin && midiNote <= mapper.overlapMax) return 3;
      const normalized = (midiNote - mapper.leftMin) / mapper.leftRange;
      return Math.min(2, Math.max(0, Math.floor(normalized * 3)));
    } else {
      if (midiNote >= mapper.overlapMin && midiNote <= mapper.overlapMax) return 3;
      const normalized = (midiNote - mapper.rightMin) / mapper.rightRange;
      return Math.min(2, Math.max(0, Math.floor(normalized * 3))) + 4;
    }
  }

  // ─── Audio ────────────────────────────────────────────

  async loadAudio(audioArrayBuffer) {
    if (!audioArrayBuffer) return;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.audioBuffer = await this.audioContext.decodeAudioData(audioArrayBuffer);
  }

  async loadVocalAudio(instrumentalBuffer, vocalsBuffer) {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.audioBuffer = await this.audioContext.decodeAudioData(instrumentalBuffer);
    this.vocalBuffer = await this.audioContext.decodeAudioData(vocalsBuffer);
    this.gameMode = 'vocal';
  }

  _playBackgroundAudio() {
    if (!this.audioBuffer || !this.audioContext) return;
    this.audioSource = this.audioContext.createBufferSource();
    this.audioSource.buffer = this.audioBuffer;
    this.audioSource.connect(this.audioContext.destination);
    this.audioSource.start(0);
    this.audioStartTime = this.audioContext.currentTime;

    // Vocal mode: start vocals in sync, muted via GainNode
    if (this.gameMode === 'vocal' && this.vocalBuffer) {
      this.vocalGainNode = this.audioContext.createGain();
      this.vocalGainNode.gain.value = 0;
      this.vocalSource = this.audioContext.createBufferSource();
      this.vocalSource.buffer = this.vocalBuffer;
      this.vocalSource.connect(this.vocalGainNode);
      this.vocalGainNode.connect(this.audioContext.destination);
      this.vocalSource.start(0);
      this._vocalGateEndTimes = [];
    }
  }

  _stopBackgroundAudio() {
    if (this.audioSource) {
      try { this.audioSource.stop(); } catch (e) {}
      this.audioSource = null;
    }
    if (this.vocalSource) {
      try { this.vocalSource.stop(); } catch (e) {}
      this.vocalSource = null;
    }
    this.vocalGainNode = null;
    this._vocalGateEndTimes = [];
  }

  _playHitSound(midiNote) {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0.12;
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    osc.start();
    osc.stop(this.audioContext.currentTime + 0.12);
  }

  // ─── Vocal Gating ────────────────────────────────────

  _gateVocal(note) {
    if (!this.vocalGainNode) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const endTime = now + Math.max(note.duration, 0.15);

    this._vocalGateEndTimes.push(endTime);

    // Unmute vocals with short fade-in to avoid clicks
    this.vocalGainNode.gain.cancelScheduledValues(now);
    this.vocalGainNode.gain.setValueAtTime(this.vocalGainNode.gain.value, now);
    this.vocalGainNode.gain.linearRampToValueAtTime(1.0, now + 0.01);
  }

  _updateVocalGating() {
    if (this.gameMode !== 'vocal' || !this.vocalGainNode) return;
    const now = this.audioContext.currentTime;

    // Remove expired gate times
    this._vocalGateEndTimes = this._vocalGateEndTimes.filter(t => t > now);

    // If no active notes, mute vocals
    if (this._vocalGateEndTimes.length === 0 && this.vocalGainNode.gain.value > 0.01) {
      this.vocalGainNode.gain.cancelScheduledValues(now);
      this.vocalGainNode.gain.setValueAtTime(this.vocalGainNode.gain.value, now);
      this.vocalGainNode.gain.linearRampToValueAtTime(0.0, now + 0.02);
    }
  }

  // ─── Game Control ─────────────────────────────────────

  setNoteSpeed(speed) { this.noteSpeed = speed; }

  setAudioOffset(offsetMs) { this.audioOffset = offsetMs / 1000; }

  start() {
    this.processedNotes.clear();
    this.longNoteHeld = {};
    this.longNoteScored = {};
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.judgments = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.judgmentEffects = [];
    this.hitEffects = [];
    this.comboBurstEffects = [];
    this.comboAnimTime = 0;
    this.currentTime = 0;
    this._vocalGateEndTimes = [];

    this._resize();
    this._setupInput();
    window.addEventListener('resize', this._boundResize);

    this.gameState = 'countdown';
    this.countdownValue = 3;
    this.countdownStart = performance.now();
    this.animationId = requestAnimationFrame((ts) => this._gameLoop(ts));
  }

  _startPlaying() {
    this.gameState = 'playing';
    this.lastTimestamp = performance.now();
    this._playBackgroundAudio();
  }

  pause() {
    if (this.gameState !== 'playing') return;
    this.gameState = 'paused';
    this._stopBackgroundAudio();
  }

  resume() {
    if (this.gameState !== 'paused') return;
    this.gameState = 'playing';
    this.lastTimestamp = performance.now();
    if (this.audioBuffer && this.audioContext) {
      this.audioSource = this.audioContext.createBufferSource();
      this.audioSource.buffer = this.audioBuffer;
      this.audioSource.connect(this.audioContext.destination);
      this.audioSource.start(0, this.currentTime);
      this.audioStartTime = this.audioContext.currentTime - this.currentTime;

      // Resume vocal track in sync
      if (this.gameMode === 'vocal' && this.vocalBuffer) {
        this.vocalGainNode = this.audioContext.createGain();
        this.vocalGainNode.gain.value = 0;
        this.vocalSource = this.audioContext.createBufferSource();
        this.vocalSource.buffer = this.vocalBuffer;
        this.vocalSource.connect(this.vocalGainNode);
        this.vocalGainNode.connect(this.audioContext.destination);
        this.vocalSource.start(0, this.currentTime);
        this._vocalGateEndTimes = [];
      }
    }
    this.animationId = requestAnimationFrame((ts) => this._gameLoop(ts));
  }

  stop() {
    this.gameState = 'idle';
    this._stopBackgroundAudio();
    this._removeInput();
    window.removeEventListener('resize', this._boundResize);
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  destroy() {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  getResults() {
    const total = this.judgments.perfect + this.judgments.great + this.judgments.good + this.judgments.miss;
    const accuracy = total > 0
      ? (this.judgments.perfect * 100 + this.judgments.great * 70 + this.judgments.good * 40) / total
      : 0;

    let grade = 'D';
    if (accuracy >= 95) grade = 'S';
    else if (accuracy >= 85) grade = 'A';
    else if (accuracy >= 70) grade = 'B';
    else if (accuracy >= 50) grade = 'C';

    return {
      score: this.score,
      maxCombo: this.maxCombo,
      judgments: { ...this.judgments },
      totalNotes: this.notes.length,
      accuracy: Math.round(accuracy * 10) / 10,
      grade,
      difficultyLevel: this.difficultyLevel
    };
  }

  // ─── Game Loop ────────────────────────────────────────

  _gameLoop(timestamp) {
    if (this.gameState === 'idle') return;

    if (this.gameState === 'countdown') {
      const elapsed = (timestamp - this.countdownStart) / 1000;
      this.countdownValue = 3 - Math.floor(elapsed);
      if (this.countdownValue <= 0) this._startPlaying();
      this._render();
      this.animationId = requestAnimationFrame((ts) => this._gameLoop(ts));
      return;
    }

    if (this.gameState === 'paused') {
      this._render();
      return;
    }

    if (this.gameState === 'playing') {
      if (this.audioContext && this.audioSource) {
        this.currentTime = (this.audioContext.currentTime - this.audioStartTime) + this.audioOffset;
      } else {
        const delta = (timestamp - this.lastTimestamp) / 1000;
        this.currentTime += delta;
      }
      this.lastTimestamp = timestamp;

      this._updateMissDetection();
      this._updateLongNotes();
      this._updateVocalGating();
      this._updateEffects();
      this._render();

      const allProcessed = this.processedNotes.size >= this.notes.length;
      const pastEnd = this.currentTime > this.songDuration;
      if (allProcessed || pastEnd) {
        this.gameState = 'ended';
        this._stopBackgroundAudio();
        this._removeInput();
        if (this.onEnd) this.onEnd(this.getResults());
        return;
      }
    }

    this.animationId = requestAnimationFrame((ts) => this._gameLoop(ts));
  }

  _updateMissDetection() {
    for (const note of this.notes) {
      if (this.processedNotes.has(note.id)) continue;
      if (this.longNoteHeld[note.id]) continue; // Long note in progress
      const timePassed = this.currentTime - note.time;
      if (timePassed > this.missWindow) {
        this.processedNotes.add(note.id);
        this._applyJudgment('miss', note.lane);
      }
    }
  }

  _updateLongNotes() {
    const now = performance.now();
    for (const note of this.notes) {
      if (!this.longNoteHeld[note.id]) continue;

      const endTime = note.time + note.duration;

      // Check if key is still held
      if (!this.keyStates[note.lane]) {
        // Released early — end long note, break combo
        delete this.longNoteHeld[note.id];
        this.processedNotes.add(note.id);
        this.combo = 0;
        this.comboAnimTime = now;
        if (this.onScoreUpdate) this.onScoreUpdate(this.score, this.combo, 'miss');
        continue;
      }

      // Check if long note duration ended (end cap reached hit line)
      if (this.currentTime >= endTime) {
        delete this.longNoteHeld[note.id];
        this.processedNotes.add(note.id);
        // Completion bonus: big score + combo + burst effect
        this.combo++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        const comboMult = 1 + Math.floor(this.combo / 10) * 0.1;
        this.score += Math.round(100 * comboMult);
        this.comboAnimTime = now;
        this.hitEffects.push({ lane: note.lane, time: now });
        this.comboBurstEffects.push({ lane: note.lane, time: now });
        this.judgmentEffects.push({ judgment: 'perfect', lane: note.lane, time: now });
        if (this.onScoreUpdate) this.onScoreUpdate(this.score, this.combo, 'perfect');
        continue;
      }

      // Award tick points + combo every 150ms of holding
      const ticks = Math.floor((this.currentTime - note.time) / 0.15);
      const scored = this.longNoteScored[note.id] || 0;
      if (ticks > scored) {
        const newTicks = ticks - scored;
        for (let t = 0; t < newTicks; t++) {
          this.combo++;
          this.maxCombo = Math.max(this.maxCombo, this.combo);
        }
        const comboMult = 1 + Math.floor(this.combo / 10) * 0.1;
        this.score += Math.round(15 * newTicks * comboMult);
        this.longNoteScored[note.id] = ticks;
        this.comboAnimTime = now;
        // Fire hit effect ring on every other tick to avoid clutter
        if (ticks % 2 === 0) {
          this.hitEffects.push({ lane: note.lane, time: now });
        }
        if (this.onScoreUpdate) this.onScoreUpdate(this.score, this.combo, 'perfect');
      }
    }
  }

  _updateEffects() {
    const now = performance.now();
    this.judgmentEffects = this.judgmentEffects.filter(e => now - e.time < 600);
    this.hitEffects = this.hitEffects.filter(e => now - e.time < 300);
    this.comboBurstEffects = this.comboBurstEffects.filter(e => now - e.time < 800);
  }

  // ─── Input ────────────────────────────────────────────

  _setupInput() {
    document.addEventListener('keydown', this._boundKeyDown);
    document.addEventListener('keyup', this._boundKeyUp);
  }

  _removeInput() {
    document.removeEventListener('keydown', this._boundKeyDown);
    document.removeEventListener('keyup', this._boundKeyUp);
  }

  _handleKeyDown(event) {
    if (event.repeat) return;
    const key = event.key.toLowerCase();

    if (key === 'escape') {
      if (this.gameState === 'playing') this.pause();
      return;
    }

    const laneIndex = this.laneKeys.indexOf(key);
    if (laneIndex === -1) return;
    event.preventDefault();

    this.keyStates[laneIndex] = true;

    if (this.gameState === 'playing') {
      this._checkHit(laneIndex);
    }
  }

  _handleKeyUp(event) {
    const key = event.key.toLowerCase();
    const laneIndex = this.laneKeys.indexOf(key);
    if (laneIndex === -1) return;
    event.preventDefault();
    this.keyStates[laneIndex] = false;
  }

  _checkHit(lane) {
    let closestNote = null;
    let closestDiff = Infinity;

    for (const note of this.notes) {
      if (note.lane !== lane) continue;
      if (this.processedNotes.has(note.id)) continue;
      if (this.longNoteHeld[note.id]) continue;

      const diff = Math.abs(note.time - this.currentTime);
      if (diff < closestDiff && diff <= this.missWindow) {
        closestNote = note;
        closestDiff = diff;
      }
    }

    if (!closestNote) return;

    let judgment;
    if (closestDiff <= this.perfectWindow) judgment = 'perfect';
    else if (closestDiff <= this.greatWindow) judgment = 'great';
    else if (closestDiff <= this.goodWindow) judgment = 'good';
    else judgment = 'miss';

    // For long notes: start holding instead of immediately completing
    if (closestNote.isLong && judgment !== 'miss') {
      this.longNoteHeld[closestNote.id] = true;
      this.longNoteScored[closestNote.id] = 0;
    } else {
      this.processedNotes.add(closestNote.id);
    }

    this._applyJudgment(judgment, lane);

    if (this.gameMode === 'vocal') {
      this._gateVocal(closestNote);
    } else {
      this._playHitSound(closestNote.midi);
    }

    this.hitEffects.push({ lane, time: performance.now() });
  }

  _applyJudgment(judgment, lane) {
    const points = { perfect: 300, great: 200, good: 100, miss: 0 };
    const now = performance.now();

    if (judgment === 'miss') {
      this.combo = 0;
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      // Milestone burst at 50, 100, 200, 500, 1000
      if ([50, 100, 200, 500, 1000].includes(this.combo)) {
        this.comboBurstEffects.push({ lane, time: now, milestone: true });
      }
    }

    this.comboAnimTime = now;
    const comboMultiplier = 1 + Math.floor(this.combo / 10) * 0.1;
    this.score += Math.round(points[judgment] * comboMultiplier);
    this.judgments[judgment]++;

    this.judgmentEffects.push({ judgment, lane, time: now });

    if (this.onScoreUpdate) {
      this.onScoreUpdate(this.score, this.combo, judgment);
    }
  }

  // ─── Rendering ────────────────────────────────────────

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.displayWidth = rect.width;
    this.displayHeight = rect.height;
    this.hitLineY = this.displayHeight * this.hitLineRatio;
    this.laneWidth = this.displayWidth / 7;
    this.noteWidth = this.laneWidth * 0.7;
  }

  _getLaneX(lane) { return lane * this.laneWidth + this.laneWidth / 2; }

  _getNoteY(noteTime) {
    return this.hitLineY - (noteTime - this.currentTime) * this.noteSpeed;
  }

  _render() {
    const ctx = this.ctx;
    const w = this.displayWidth;
    const h = this.displayHeight;

    // Background (opaque — video is displayed beside the canvas, not behind it)
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    // Lane backgrounds
    for (let i = 0; i < 7; i++) {
      const x = i * this.laneWidth;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(x, 0, this.laneWidth, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Hit line
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this.hitLineY);
    ctx.lineTo(w, this.hitLineY);
    ctx.stroke();

    // Hit line glow
    const grad = ctx.createLinearGradient(0, this.hitLineY - 12, 0, this.hitLineY + 12);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, this.hitLineY - 12, w, 24);

    this._drawKeyIndicators(ctx);

    if (this.gameState === 'playing' || this.gameState === 'paused') {
      this._drawNotes(ctx);
    }

    this._drawHitEffects(ctx);
    this._drawComboBursts(ctx);
    this._drawJudgmentEffects(ctx);

    if (this.gameState === 'playing' || this.gameState === 'paused') {
      this._drawCombo(ctx, w);
      this._drawProgressBar(ctx, w);
    }

    if (this.gameState === 'countdown') this._drawCountdown(ctx, w, h);
    if (this.gameState === 'paused') this._drawPauseOverlay(ctx, w, h);
  }

  _drawKeyIndicators(ctx) {
    for (let i = 0; i < 7; i++) {
      const x = this._getLaneX(i);
      const pressed = this.keyStates[i];
      const color = this.laneColors[i];
      const kw = this.laneWidth * 0.85;
      const kh = 40;
      const ky = this.hitLineY + 5;

      ctx.fillStyle = pressed ? color : 'rgba(255,255,255,0.06)';
      ctx.globalAlpha = pressed ? 0.6 : 1;
      ctx.beginPath();
      ctx.roundRect(x - kw / 2, ky, kw, kh, 6);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = pressed ? '#fff' : 'rgba(255,255,255,0.4)';
      ctx.font = 'bold 15px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.laneLabels[i], x, ky + kh / 2);

      if (pressed) {
        const glow = ctx.createRadialGradient(x, this.hitLineY, 0, x, this.hitLineY, this.laneWidth * 0.8);
        glow.addColorStop(0, color + '40');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - this.laneWidth, this.hitLineY - this.laneWidth, this.laneWidth * 2, this.laneWidth * 2);
      }
    }
  }

  _drawNotes(ctx) {
    const lookAhead = (this.displayHeight / this.noteSpeed) + 0.5;
    const lookBehind = 0.3;

    for (const note of this.notes) {
      const dt = note.time - this.currentTime;
      const endDt = (note.time + note.duration) - this.currentTime;

      // Skip notes completely out of view
      if (endDt < -lookBehind || dt > lookAhead) continue;

      const isHeld = this.longNoteHeld[note.id];
      if (this.processedNotes.has(note.id) && !isHeld) continue;

      const y = this._getNoteY(note.time);
      const x = this._getLaneX(note.lane);
      const color = this.laneColors[note.lane];
      const nw = this.noteWidth;
      const nh = this.noteHeight;

      // ─── Long note body ───
      if (note.isLong) {
        const endY = this._getNoteY(note.time + note.duration);

        if (isHeld) {
          // When held: trail from hit line up to end cap
          const trailTop = endY;
          const trailBottom = this.hitLineY;
          const trailHeight = trailBottom - trailTop;

          if (trailHeight > 0) {
            // Glowing trail body
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.roundRect(x - nw / 3, trailTop, nw * 2 / 3, trailHeight, 4);
            ctx.fill();

            // Wide glow along trail
            ctx.globalAlpha = 0.18;
            ctx.fillRect(x - nw / 2, trailTop, nw, trailHeight);

            // Gradient edge glow
            const trailGrad = ctx.createLinearGradient(x - nw / 2, 0, x + nw / 2, 0);
            trailGrad.addColorStop(0, 'rgba(0,0,0,0)');
            trailGrad.addColorStop(0.3, color + '30');
            trailGrad.addColorStop(0.7, color + '30');
            trailGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = trailGrad;
            ctx.globalAlpha = 1;
            ctx.fillRect(x - nw / 2, trailTop, nw, trailHeight);
          }
          ctx.globalAlpha = 1;

          // Pulsing glow at hit line
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
          const glowR = this.laneWidth * (0.5 + pulse * 0.4);
          const glow = ctx.createRadialGradient(x, this.hitLineY, 0, x, this.hitLineY, glowR);
          glow.addColorStop(0, color + '70');
          glow.addColorStop(0.5, color + '25');
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(x - glowR, this.hitLineY - glowR, glowR * 2, glowR * 2);

          // Pulsing ring at hit line
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.4 + pulse * 0.4;
          const ringR = 20 + pulse * 15;
          ctx.beginPath();
          ctx.arc(x, this.hitLineY, ringR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;

          // Anchor note at hit line (pulsing brightness)
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 12 + pulse * 8;
          ctx.globalAlpha = 0.8 + pulse * 0.2;
          ctx.beginPath();
          ctx.roundRect(x - nw / 2, this.hitLineY - nh / 2, nw, nh, 5);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;

          // Shine on anchor
          ctx.fillStyle = 'rgba(255,255,255,' + (0.2 + pulse * 0.15) + ')';
          ctx.beginPath();
          ctx.roundRect(x - nw / 2 + 3, this.hitLineY - nh / 2 + 3, nw - 6, nh / 2 - 3, 3);
          ctx.fill();

          // End cap (brighter when held)
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.roundRect(x - nw / 2, endY - nh / 4, nw, nh / 2, 3);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          // Not held: normal trail rendering
          const bodyTop = Math.min(y, endY);
          const bodyBottom = Math.max(y, endY);
          const bodyHeight = bodyBottom - bodyTop;

          ctx.fillStyle = color;
          ctx.globalAlpha = 0.2;
          ctx.beginPath();
          ctx.roundRect(x - nw / 3, bodyTop, nw * 2 / 3, bodyHeight, 4);
          ctx.fill();
          ctx.globalAlpha = 1;

          // End cap
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.roundRect(x - nw / 2, endY - nh / 4, nw, nh / 2, 3);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // ─── Note head ───
      if (!isHeld) {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.roundRect(x - nw / 2, y - nh / 2, nw, nh, 5);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Shine
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.roundRect(x - nw / 2 + 3, y - nh / 2 + 3, nw - 6, nh / 2 - 3, 3);
        ctx.fill();

        // Long note indicator
        if (note.isLong) {
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.font = '10px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('HOLD', x, y);
        }
      }
    }
  }

  _drawHitEffects(ctx) {
    const now = performance.now();
    for (const effect of this.hitEffects) {
      const age = (now - effect.time) / 300;
      if (age >= 1) continue;
      const x = this._getLaneX(effect.lane);
      const color = this.laneColors[effect.lane];
      const radius = 25 + age * 45;
      ctx.globalAlpha = (1 - age) * 0.6;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5 * (1 - age);
      ctx.beginPath();
      ctx.arc(x, this.hitLineY, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _drawJudgmentEffects(ctx) {
    const now = performance.now();
    const colors = { perfect: '#FFD700', great: '#00FF88', good: '#4D96FF', miss: '#FF4444' };
    const texts = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };

    for (const effect of this.judgmentEffects) {
      const age = (now - effect.time) / 600;
      if (age >= 1) continue;
      const x = this._getLaneX(effect.lane);
      const y = this.hitLineY - 60 - age * 25;
      ctx.globalAlpha = 1 - age * age;
      ctx.fillStyle = colors[effect.judgment];
      ctx.font = `bold ${14 + (1 - age) * 4}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(texts[effect.judgment], x, y);
      ctx.globalAlpha = 1;
    }
  }

  _drawCombo(ctx, w) {
    if (this.combo < 2) return;

    const now = performance.now();
    const age = Math.min(1, (now - this.comboAnimTime) / 200); // 200ms pop animation
    const popScale = age < 0.5 ? 1 + (1 - age * 2) * 0.3 : 1; // scale from 1.3 to 1.0

    // Combo color based on milestone
    let comboColor;
    if (this.combo >= 1000) comboColor = '#FF2D2D';
    else if (this.combo >= 500) comboColor = '#FF6B6B';
    else if (this.combo >= 200) comboColor = '#FFD700';
    else if (this.combo >= 100) comboColor = '#FF9F43';
    else if (this.combo >= 50) comboColor = '#00FF88';
    else if (this.combo >= 25) comboColor = '#6BCB77';
    else if (this.combo >= 10) comboColor = '#4D96FF';
    else comboColor = 'rgba(255,255,255,0.8)';

    const cx = w - 70;
    const cy = 60;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(popScale, popScale);

    // Combo number
    const fontSize = this.combo >= 100 ? 36 : 42;
    ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow/glow
    ctx.shadowColor = comboColor;
    ctx.shadowBlur = this.combo >= 50 ? 15 : 8;
    ctx.fillStyle = comboColor;
    ctx.fillText(String(this.combo), 0, 0);
    ctx.shadowBlur = 0;

    // "COMBO" label
    ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('COMBO', 0, 24);

    ctx.restore();
  }

  _drawComboBursts(ctx) {
    const now = performance.now();
    for (const burst of this.comboBurstEffects) {
      const age = (now - burst.time) / 800;
      if (age >= 1) continue;

      const x = this._getLaneX(burst.lane);
      const color = this.laneColors[burst.lane];

      // Multi-ring burst
      for (let i = 0; i < 3; i++) {
        const ringAge = Math.max(0, age - i * 0.1);
        if (ringAge >= 1) continue;
        const radius = 30 + ringAge * 80;
        ctx.globalAlpha = (1 - ringAge) * 0.5;
        ctx.strokeStyle = burst.milestone ? '#FFD700' : color;
        ctx.lineWidth = (3 - i) * (1 - ringAge);
        ctx.beginPath();
        ctx.arc(x, this.hitLineY, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Sparkle particles
      if (burst.milestone) {
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI * 2 / 8) * i + age * 2;
          const dist = 20 + age * 60;
          const px = x + Math.cos(angle) * dist;
          const py = this.hitLineY + Math.sin(angle) * dist;
          ctx.globalAlpha = (1 - age) * 0.8;
          ctx.fillStyle = '#FFD700';
          ctx.beginPath();
          ctx.arc(px, py, 3 * (1 - age), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  _drawProgressBar(ctx, w) {
    const progress = this.songDuration > 0 ? this.currentTime / this.songDuration : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 0, w, 3);
    ctx.fillStyle = '#4D96FF';
    ctx.fillRect(0, 0, w * Math.min(1, progress), 3);
  }

  _drawCountdown(ctx, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, w, h);
    const text = this.countdownValue > 0 ? String(this.countdownValue) : 'GO!';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 80px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }

  _drawPauseOverlay(ctx, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PAUSED', w / 2, h / 2 - 30);
    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('ESC - Resume  |  Q - Quit', w / 2, h / 2 + 20);
  }
}
