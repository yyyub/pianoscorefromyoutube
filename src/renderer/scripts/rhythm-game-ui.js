// Rhythm Game UI Controller
// Manages song selection, game overlay, results screen, background video
// Supports dual mode: Piano (MIDI) and Vocal (original song with vocal gating)

class RhythmGameUI {
  constructor() {
    this.game = null;
    this.overlay = null;
    this.views = {};
    this._judgmentTimeout = null;
    this._bgVideo = null;
    this._vocalProgressUnsub = null;
    this._calibrationRunning = false;
    this._calibrationInterval = null;
    this._calibrationAudioCtx = null;
    this._calibrationBeatTimes = [];
    this._calibrationTapTimes = [];
    this._calibrationBeatIndex = 0;
    this._calibrationBoundKeydown = (e) => this._handleCalibrationKeydown(e);
    this._calibrationConfig = {
      intervalMs: 500,
      warmupBeats: 4,
      recordBeats: 12
    };

    // Current mode: 'piano' or 'vocal'
    this.currentMode = 'piano';

    // Piano mode paths
    this.currentMidiPath = null;
    this.currentAudioPath = null;
    this.currentVideoPath = null;

    // Vocal mode paths
    this.currentInstrumentalPath = null;
    this.currentVocalsPath = null;
    this.currentVocalChartPath = null;
    this.currentVocalMidiData = null;
    this.currentChartKey = null;
  }

  init() {
    this.overlay = document.getElementById('rhythm-game-overlay');
    this.views = {
      songSelect: document.getElementById('game-song-select'),
      playing: document.getElementById('game-playing'),
      results: document.getElementById('game-results')
    };
    this._bgVideo = document.getElementById('game-bg-video');

    this._setupEventListeners();
  }

  _setupEventListeners() {
    // Close button
    document.getElementById('game-close-btn').addEventListener('click', () => this.hide());

    // Mode tabs
    document.getElementById('mode-tab-piano').addEventListener('click', () => this._switchMode('piano'));
    document.getElementById('mode-tab-vocal').addEventListener('click', () => this._switchMode('vocal'));

    // Speed slider
    const speedSlider = document.getElementById('note-speed');
    speedSlider.addEventListener('input', () => {
      this._setNoteSpeed(parseInt(speedSlider.value, 10), 'main');
    });

    // Audio offset slider
    const offsetSlider = document.getElementById('audio-offset');
    offsetSlider.addEventListener('input', () => {
      this._setAudioOffset(parseInt(offsetSlider.value, 10), 'main');
    });

    const pauseSpeedSlider = document.getElementById('pause-note-speed');
    if (pauseSpeedSlider) {
      pauseSpeedSlider.addEventListener('input', () => {
        this._setNoteSpeed(parseInt(pauseSpeedSlider.value, 10), 'pause');
      });
    }

    const pauseOffsetSlider = document.getElementById('pause-audio-offset');
    if (pauseOffsetSlider) {
      pauseOffsetSlider.addEventListener('input', () => {
        this._setAudioOffset(parseInt(pauseOffsetSlider.value, 10), 'pause');
      });
    }

    const syncCalibrateBtn = document.getElementById('sync-calibrate-btn');
    if (syncCalibrateBtn) {
      syncCalibrateBtn.addEventListener('click', () => {
        if (this._calibrationRunning) {
          this._stopSyncCalibration(true);
        } else {
          this._startSyncCalibration();
        }
      });
    }

    // Import MIDI button
    document.getElementById('game-import-btn').addEventListener('click', async () => {
      const item = await window.electronAPI.importMidiFile();
      if (item) {
        this.currentMode = 'piano';
        this.currentMidiPath = item.path;
        this.currentAudioPath = item.audioPath || null;
        this.currentVideoPath = item.videoPath || null;
        this._startGame();
      }
    });

    // Vocal URL analyze button
    document.getElementById('vocal-analyze-btn').addEventListener('click', () => {
      this._startVocalAnalysis();
    });

    // Vocal URL input: Enter key
    document.getElementById('vocal-url-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._startVocalAnalysis();
    });

    // Results buttons
    document.getElementById('results-retry-btn').addEventListener('click', () => {
      this._startGame();
    });
    document.getElementById('results-back-btn').addEventListener('click', () => {
      this._stopBgVideo();
      this._showView('songSelect');
    });

    // Pause overlay buttons
    document.getElementById('game-resume-btn').addEventListener('click', () => {
      if (this.game) this.game.resume();
      this._resumeBgVideo();
      document.getElementById('game-pause-overlay').style.display = 'none';
    });
    document.getElementById('game-quit-btn').addEventListener('click', () => {
      if (this.game) this.game.stop();
      this._stopBgVideo();
      document.getElementById('game-pause-overlay').style.display = 'none';
      this._showView('songSelect');
    });

    // Global key handler for pause/quit and in-game speed control
    document.addEventListener('keydown', (e) => {
      if (!this.game) return;

      if (e.key.toLowerCase() === 'q' && this.game.gameState === 'paused') {
        this.game.stop();
        this._stopBgVideo();
        document.getElementById('game-pause-overlay').style.display = 'none';
        this._showView('songSelect');
        return;
      }
      if (e.key === 'Escape' && this.game.gameState === 'paused') {
        this.game.resume();
        this._resumeBgVideo();
        document.getElementById('game-pause-overlay').style.display = 'none';
        return;
      }

      if (this.game.gameState === 'playing') {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const newSpeed = Math.min(1200, this.game.noteSpeed + 50);
          this._setNoteSpeed(newSpeed, 'main');
          this._showSpeedIndicator(newSpeed);
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const newSpeed = Math.max(100, this.game.noteSpeed - 50);
          this._setNoteSpeed(newSpeed, 'main');
          this._showSpeedIndicator(newSpeed);
        }
      }
    });
  }

  // ─── Mode Switching ─────────────────────────────

  _switchMode(mode) {
    this.currentMode = mode;
    document.getElementById('mode-tab-piano').classList.toggle('active', mode === 'piano');
    document.getElementById('mode-tab-vocal').classList.toggle('active', mode === 'vocal');
    document.getElementById('piano-song-panel').style.display = mode === 'piano' ? 'block' : 'none';
    document.getElementById('vocal-song-panel').style.display = mode === 'vocal' ? 'block' : 'none';

    if (mode === 'vocal') {
      this._loadVocalSongList();
    }
  }

  async show() {
    this.overlay.style.display = 'flex';
    this._showView('songSelect');
    this._switchMode('piano');
    await this._loadSongList();
  }

  hide() {
    this._stopSyncCalibration(false);
    if (this._judgmentTimeout) {
      clearTimeout(this._judgmentTimeout);
      this._judgmentTimeout = null;
    }
    if (this.game) {
      this.game.destroy();
      this.game = null;
    }
    this._stopBgVideo();
    if (this._vocalProgressUnsub) {
      this._vocalProgressUnsub();
      this._vocalProgressUnsub = null;
    }
    this.overlay.style.display = 'none';
  }

  _showView(viewName) {
    if (viewName !== 'songSelect' && this._calibrationRunning) {
      this._stopSyncCalibration(false);
    }
    Object.values(this.views).forEach(v => v.style.display = 'none');
    this.views[viewName].style.display = 'flex';
  }

  // ─── Sync Calibration ───────────────────────────

  _setCalibrationStatus(text) {
    const statusEl = document.getElementById('sync-calibrate-status');
    if (statusEl) statusEl.textContent = text;
  }

  _setNoteSpeed(value, source = 'main') {
    const safe = Math.max(100, Math.min(1200, Number.isFinite(value) ? value : 400));

    const speedSlider = document.getElementById('note-speed');
    const speedLabel = document.getElementById('speed-value');
    const pauseSpeedSlider = document.getElementById('pause-note-speed');
    const pauseSpeedLabel = document.getElementById('pause-speed-value');

    if (source !== 'main' && speedSlider) speedSlider.value = String(safe);
    if (source !== 'pause' && pauseSpeedSlider) pauseSpeedSlider.value = String(safe);
    if (speedLabel) speedLabel.textContent = String(safe);
    if (pauseSpeedLabel) pauseSpeedLabel.textContent = String(safe);

    if (this.game) this.game.setNoteSpeed(safe);
  }

  _setAudioOffset(value, source = 'main') {
    const safe = Math.max(-200, Math.min(200, Number.isFinite(value) ? value : 0));

    const offsetSlider = document.getElementById('audio-offset');
    const offsetLabel = document.getElementById('offset-value');
    const pauseOffsetSlider = document.getElementById('pause-audio-offset');
    const pauseOffsetLabel = document.getElementById('pause-offset-value');
    const text = (safe >= 0 ? '+' : '') + safe + 'ms';

    if (source !== 'main' && offsetSlider) offsetSlider.value = String(safe);
    if (source !== 'pause' && pauseOffsetSlider) pauseOffsetSlider.value = String(safe);
    if (offsetLabel) offsetLabel.textContent = text;
    if (pauseOffsetLabel) pauseOffsetLabel.textContent = text;

    if (this.game) this.game.setAudioOffset(safe);
  }

  _startSyncCalibration() {
    if (this._calibrationRunning) return;

    const btn = document.getElementById('sync-calibrate-btn');
    if (!btn) return;

    this._calibrationRunning = true;
    this._calibrationBeatTimes = [];
    this._calibrationTapTimes = [];
    this._calibrationBeatIndex = 0;

    btn.textContent = '측정 중지';
    this._setCalibrationStatus('준비: 곧 비프음 시작');

    document.addEventListener('keydown', this._calibrationBoundKeydown);

    try {
      this._calibrationAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (err) {
      this._setCalibrationStatus('오디오 초기화 실패');
      this._stopSyncCalibration(false);
      return;
    }

    const { intervalMs, warmupBeats, recordBeats } = this._calibrationConfig;
    const totalBeats = warmupBeats + recordBeats;

    this._calibrationInterval = setInterval(() => {
      if (!this._calibrationRunning) return;

      this._calibrationBeatIndex += 1;
      const beat = this._calibrationBeatIndex;
      const isWarmup = beat <= warmupBeats;
      const measuredBeat = beat - warmupBeats;
      const isLast = beat >= totalBeats;

      this._playCalibrationBeep(isWarmup ? 900 : 1200, isWarmup ? 0.04 : 0.06);

      const now = performance.now();
      if (!isWarmup) {
        this._calibrationBeatTimes.push(now);
        this._setCalibrationStatus(`측정 중: ${measuredBeat}/${recordBeats} (Space)`);
      } else {
        this._setCalibrationStatus(`워밍업: ${beat}/${warmupBeats}`);
      }

      if (isLast) {
        this._stopSyncCalibration(false);
        this._finalizeSyncCalibration();
      }
    }, intervalMs);
  }

  _stopSyncCalibration(userCancelled) {
    if (!this._calibrationRunning && !this._calibrationInterval && !this._calibrationAudioCtx) return;

    this._calibrationRunning = false;
    document.removeEventListener('keydown', this._calibrationBoundKeydown);

    if (this._calibrationInterval) {
      clearInterval(this._calibrationInterval);
      this._calibrationInterval = null;
    }

    if (this._calibrationAudioCtx) {
      this._calibrationAudioCtx.close().catch(() => {});
      this._calibrationAudioCtx = null;
    }

    const btn = document.getElementById('sync-calibrate-btn');
    if (btn) btn.textContent = '싱크 맞추기 시작';

    if (userCancelled) {
      this._setCalibrationStatus('중지됨');
    }
  }

  _playCalibrationBeep(frequency, durationSec) {
    if (!this._calibrationAudioCtx) return;

    const ctx = this._calibrationAudioCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.01);
  }

  _handleCalibrationKeydown(e) {
    if (!this._calibrationRunning) return;
    if (e.repeat) return;

    const key = e.key.toLowerCase();
    if (key !== ' ' && key !== 'spacebar' && key !== 'enter') return;

    e.preventDefault();
    this._calibrationTapTimes.push(performance.now());
  }

  _finalizeSyncCalibration() {
    const beatTimes = this._calibrationBeatTimes;
    const tapTimes = this._calibrationTapTimes;

    if (!beatTimes.length || !tapTimes.length) {
      this._setCalibrationStatus('탭 입력 부족');
      return;
    }

    const diffs = [];
    for (const tap of tapTimes) {
      let nearest = null;
      let nearestAbs = Infinity;
      for (const beat of beatTimes) {
        const diff = tap - beat;
        const abs = Math.abs(diff);
        if (abs < nearestAbs) {
          nearestAbs = abs;
          nearest = diff;
        }
      }
      if (nearest !== null && nearestAbs <= 220) diffs.push(nearest);
    }

    if (diffs.length < 4) {
      this._setCalibrationStatus('샘플 부족: 다시 측정');
      return;
    }

    diffs.sort((a, b) => a - b);
    const cut = Math.floor(diffs.length * 0.2);
    const trimmed = diffs.slice(cut, diffs.length - cut);
    const sample = trimmed.length >= 3 ? trimmed : diffs;
    const mean = sample.reduce((sum, v) => sum + v, 0) / sample.length;

    // If taps are late (+), game offset should move negative.
    const recommended = Math.max(-200, Math.min(200, Math.round((-mean) / 10) * 10));

    this._setAudioOffset(recommended, 'main');

    this._setCalibrationStatus(`완료: ${recommended >= 0 ? '+' : ''}${recommended}ms 적용`);
  }

  // ─── Speed Indicator ───────────────────────────

  _showSpeedIndicator(speed) {
    let indicator = document.getElementById('speed-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'speed-indicator';
      indicator.className = 'speed-indicator';
      document.getElementById('game-playing').appendChild(indicator);
    }
    indicator.textContent = `Speed: ${speed}`;
    indicator.classList.remove('speed-fade');
    void indicator.offsetWidth;
    indicator.classList.add('speed-fade');
  }

  // ─── Background Video ──────────────────────────

  _loadBgVideo(videoPath) {
    if (!videoPath || !this._bgVideo) return;
    const fileUrl = window.electronAPI.pathToFileURL(videoPath);
    this._bgVideo.src = fileUrl;
    this._bgVideo.load();
  }

  _playBgVideo() {
    if (!this._bgVideo || !this._bgVideo.src) return;
    this._bgVideo.currentTime = 0;
    this._bgVideo.play().catch(() => {});
  }

  _pauseBgVideo() {
    if (this._bgVideo) this._bgVideo.pause();
  }

  _resumeBgVideo() {
    if (this._bgVideo && this._bgVideo.src) {
      this._bgVideo.play().catch(() => {});
    }
  }

  _stopBgVideo() {
    if (!this._bgVideo) return;
    this._bgVideo.pause();
    this._bgVideo.removeAttribute('src');
    this._bgVideo.load();
    const playingEl = document.getElementById('game-playing');
    if (playingEl) playingEl.classList.remove('has-video');
  }

  // ─── Piano Song List ───────────────────────────

  async _loadSongList() {
    const songList = document.getElementById('song-list');
    songList.innerHTML = '<div class="song-loading">MIDI 파일 검색 중...</div>';

    try {
      const files = await window.electronAPI.listMidiFiles();
      const pianoFiles = files ? files.filter(f => !f.vocalOnly) : [];

      if (pianoFiles.length === 0) {
        songList.innerHTML = '<div class="song-empty">변환된 MIDI 파일이 없습니다.<br>먼저 YouTube 영상을 변환해주세요.</div>';
        return;
      }

      const groups = {};
      for (const file of pianoFiles) {
        if (!groups[file.folder]) groups[file.folder] = [];
        groups[file.folder].push(file);
      }

      let html = '';
      for (const [folder, items] of Object.entries(groups)) {
        html += `<div class="song-group">`;
        html += `<div class="song-group-title">${this._escapeHtml(folder)}</div>`;
        for (const item of items) {
          const diffClass = this._getDifficultyClass(item.difficulty);
          html += `<div class="song-item" data-path="${this._escapeHtml(item.path)}" data-audio="${this._escapeHtml(item.audioPath || '')}" data-video="${this._escapeHtml(item.videoPath || '')}">`;
          html += `<span class="song-difficulty ${diffClass}">${this._escapeHtml(item.difficulty)}</span>`;
          html += `<span class="song-name">${this._escapeHtml(item.name)}</span>`;
          if (item.videoPath) {
            html += `<span class="song-video-badge">MV</span>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
      }

      songList.innerHTML = html;

      songList.querySelectorAll('.song-item').forEach(el => {
        el.addEventListener('click', () => {
          this.currentMode = 'piano';
          this.currentMidiPath = el.dataset.path;
          this.currentAudioPath = el.dataset.audio || null;
          this.currentVideoPath = el.dataset.video || null;
          this._startGame();
        });
      });
    } catch (err) {
      songList.innerHTML = `<div class="song-empty">파일 로드 실패: ${err.message}</div>`;
    }
  }

  // ─── Vocal Song List ───────────────────────────

  async _loadVocalSongList() {
    const vocalList = document.getElementById('vocal-song-list');
    vocalList.innerHTML = '<div class="song-loading">원곡 데이터 검색 중...</div>';

    try {
      const files = await window.electronAPI.listMidiFiles();
      const vocalFiles = files ? files.filter(f => f.hasVocalData) : [];

      if (vocalFiles.length === 0) {
        vocalList.innerHTML = '<div class="song-empty">처리된 원곡이 없습니다.<br>위에서 YouTube URL을 입력하여 분석하세요.</div>';
        return;
      }

      // Deduplicate by folder (one entry per song)
      const seen = new Set();
      const uniqueFiles = [];
      for (const f of vocalFiles) {
        if (!seen.has(f.folder)) {
          seen.add(f.folder);
          uniqueFiles.push(f);
        }
      }

      let html = '';
      for (const item of uniqueFiles) {
        html += `<div class="song-item vocal-song-item" data-instrumental="${this._escapeHtml(item.instrumentalPath || '')}" data-vocals="${this._escapeHtml(item.vocalsAudioPath || '')}" data-chart="${this._escapeHtml(item.vocalChartPath || '')}" data-video="${this._escapeHtml(item.videoPath || '')}">`;
        html += `<span class="song-difficulty diff-vocal">VOCAL</span>`;
        html += `<span class="song-name">${this._escapeHtml(item.folder)}</span>`;
        if (item.videoPath) {
          html += `<span class="song-video-badge">MV</span>`;
        }
        html += `</div>`;
      }

      vocalList.innerHTML = html;

      vocalList.querySelectorAll('.vocal-song-item').forEach(el => {
        el.addEventListener('click', () => {
          this.currentMode = 'vocal';
          this.currentInstrumentalPath = el.dataset.instrumental;
          this.currentVocalsPath = el.dataset.vocals;
          this.currentVocalChartPath = el.dataset.chart;
          this.currentVideoPath = el.dataset.video || null;
          this.currentVocalMidiData = null;
          this._startGame();
        });
      });
    } catch (err) {
      vocalList.innerHTML = `<div class="song-empty">로드 실패: ${err.message}</div>`;
    }
  }

  // ─── Vocal Analysis ────────────────────────────

  async _startVocalAnalysis() {
    const urlInput = document.getElementById('vocal-url-input');
    const url = urlInput.value.trim();
    if (!url) return;

    const analyzeBtn = document.getElementById('vocal-analyze-btn');
    const progressContainer = document.getElementById('vocal-progress');
    const progressBar = document.getElementById('vocal-progress-bar');
    const progressText = document.getElementById('vocal-progress-text');

    analyzeBtn.disabled = true;
    urlInput.disabled = true;
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = '준비 중...';

    // Listen for progress
    if (this._vocalProgressUnsub) this._vocalProgressUnsub();
    this._vocalProgressUnsub = window.electronAPI.onVocalGameProgress((data) => {
      progressBar.style.width = data.percent + '%';
      progressText.textContent = data.message;
    });

    try {
      const result = await window.electronAPI.prepareVocalGame(url);

      if (result) {
        this.currentMode = 'vocal';
        this.currentInstrumentalPath = result.instrumentalPath;
        this.currentVocalsPath = result.vocalsPath;
        this.currentVocalChartPath = null;
        this.currentVocalMidiData = result.midiData;
        this.currentVideoPath = result.videoPath || null;

        progressText.textContent = '게임 시작!';
        await new Promise(r => setTimeout(r, 500));

        progressContainer.style.display = 'none';
        this._startGame();
      }
    } catch (err) {
      progressText.textContent = '실패: ' + err.message;
      progressBar.style.width = '0%';
    } finally {
      analyzeBtn.disabled = false;
      urlInput.disabled = false;
      if (this._vocalProgressUnsub) {
        this._vocalProgressUnsub();
        this._vocalProgressUnsub = null;
      }
    }
  }

  // ─── Game Start ────────────────────────────────

  async _startGame() {
    this._showView('playing');
    const canvas = document.getElementById('game-canvas');
    const hudScore = document.getElementById('hud-score');
    const hudCombo = document.getElementById('hud-combo');
    const hudJudgment = document.getElementById('hud-judgment');
    const hudHpBar = document.getElementById('hud-hp-bar');
    const hudHpText = document.getElementById('hud-hp-text');

    hudScore.textContent = '0';
    hudCombo.style.display = 'none';
    hudJudgment.style.display = 'none';
    if (hudHpBar) {
      hudHpBar.style.width = '100%';
      hudHpBar.style.background = 'linear-gradient(90deg, #4D96FF, #6BCB77)';
    }
    if (hudHpText) {
      hudHpText.textContent = 'HP 100';
    }

    if (this.game) {
      this.game.destroy();
    }

    this.game = new RhythmGame(canvas);
    this.currentChartKey = this._getCurrentChartKey();

    // Apply settings
    const speed = parseInt(document.getElementById('note-speed').value, 10) || 400;
    this._setNoteSpeed(speed, 'main');

    const offset = parseInt(document.getElementById('audio-offset').value, 10) || 0;
    this._setAudioOffset(offset, 'main');

    const judgeDiff = document.getElementById('judge-difficulty').value || 'normal';
    this.game.setJudgeDifficulty(judgeDiff);

    try {
      if (this.currentMode === 'vocal') {
        await this._loadVocalGame();
      } else {
        await this._loadPianoGame();
      }
    } catch (err) {
      alert('게임 로드 실패: ' + err.message);
      this._showView('songSelect');
      return;
    }

    // Background video: side-by-side layout (notes left, video right)
    const playingEl = document.getElementById('game-playing');
    if (this.currentVideoPath) {
      playingEl.classList.add('has-video');
      this._loadBgVideo(this.currentVideoPath);
    } else {
      playingEl.classList.remove('has-video');
      this._stopBgVideo();
    }

    // HUD callbacks (combo is drawn on canvas, score + judgment on HTML HUD)
    this.game.onScoreUpdate = (score, combo, judgment, detail = null) => {
      hudScore.textContent = score.toLocaleString();
      if (detail && typeof detail.hp === 'number') {
        this._updateHpHud(detail.hp);
      }
      this._showLiveJudgment(judgment, detail);
    };

    // Pause callback
    const pauseOverlay = document.getElementById('game-pause-overlay');
    const originalPause = this.game.pause.bind(this.game);
    this.game.pause = () => {
      originalPause();
      this._pauseBgVideo();
      pauseOverlay.style.display = 'flex';
    };

    // End callback
    this.game.onEnd = (results) => {
      this._pauseBgVideo();
      results.gameMode = this.currentMode;
      results.bestRecord = this._updateBestRecord(this.currentChartKey, results);
      this._showResults(results);
    };

    this.game.start();
    setTimeout(() => { this._playBgVideo(); }, 3000);
  }

  async _loadPianoGame() {
    if (!this.currentMidiPath) throw new Error('No MIDI path');

    const midiData = await window.electronAPI.loadMidiForGame(this.currentMidiPath);
    this.game.loadMidiData(midiData);

    if (this.currentAudioPath) {
      try {
        const audioBuffer = await window.electronAPI.readAudioFile(this.currentAudioPath);
        await this.game.loadAudio(audioBuffer);
      } catch (err) {
        console.warn('Audio load failed, playing without audio:', err);
      }
    }
  }

  async _loadVocalGame() {
    // Load MIDI data (either pre-loaded from analysis or from file)
    let midiData = this.currentVocalMidiData;
    if (!midiData && this.currentVocalChartPath) {
      midiData = await window.electronAPI.loadMidiForGame(this.currentVocalChartPath);
    }
    if (!midiData) throw new Error('No vocal chart data');

    this.game.loadMidiData(midiData);

    // Load dual audio: instrumental (BGM) + vocals (gated)
    if (!this.currentInstrumentalPath || !this.currentVocalsPath) {
      throw new Error('Missing instrumental or vocals path');
    }

    const instrBuffer = await window.electronAPI.readAudioFile(this.currentInstrumentalPath);
    const vocalBuffer = await window.electronAPI.readAudioFile(this.currentVocalsPath);
    await this.game.loadVocalAudio(instrBuffer, vocalBuffer);
  }

  _updateHpHud(hp) {
    const hudHpBar = document.getElementById('hud-hp-bar');
    const hudHpText = document.getElementById('hud-hp-text');
    const clamped = Math.max(0, Math.min(100, Math.round(hp)));

    if (hudHpBar) {
      hudHpBar.style.width = `${clamped}%`;
      if (clamped > 60) {
        hudHpBar.style.background = 'linear-gradient(90deg, #4D96FF, #6BCB77)';
      } else if (clamped > 30) {
        hudHpBar.style.background = 'linear-gradient(90deg, #FFD93D, #FF9F43)';
      } else {
        hudHpBar.style.background = 'linear-gradient(90deg, #FF6B6B, #FF3B3B)';
      }
    }

    if (hudHpText) {
      hudHpText.textContent = `HP ${clamped}`;
    }
  }

  _showLiveJudgment(judgment, detail = null) {
    const hudJudgment = document.getElementById('hud-judgment');
    if (!hudJudgment || !judgment) return;

    const timingLabel = detail ? detail.timingLabel : null;
    const timingMs = detail ? detail.timingMs : null;

    let text = judgment.toUpperCase();
    if ((timingLabel === 'FAST' || timingLabel === 'SLOW') && typeof timingMs === 'number') {
      const sign = timingMs > 0 ? '+' : '';
      text = `${text} ${timingLabel} ${sign}${timingMs}ms`;
    } else if (timingLabel === 'CENTER' && typeof timingMs === 'number') {
      const sign = timingMs > 0 ? '+' : '';
      text = `${text} ${sign}${timingMs}ms`;
    }

    hudJudgment.textContent = text;
    hudJudgment.style.display = 'block';
    hudJudgment.classList.remove('judgment-pop', 'fast', 'slow', 'center');
    if (timingLabel === 'FAST') hudJudgment.classList.add('fast');
    if (timingLabel === 'SLOW') hudJudgment.classList.add('slow');
    if (timingLabel === 'CENTER') hudJudgment.classList.add('center');
    void hudJudgment.offsetWidth;
    hudJudgment.classList.add('judgment-pop');

    if (this._judgmentTimeout) clearTimeout(this._judgmentTimeout);
    this._judgmentTimeout = setTimeout(() => {
      hudJudgment.style.display = 'none';
    }, 500);
  }

  _getCurrentChartKey() {
    if (this.currentMode === 'vocal') {
      const base = this.currentVocalChartPath || this.currentVocalsPath || this.currentInstrumentalPath || 'vocal-unknown';
      return `vocal:${base}`;
    }
    const base = this.currentMidiPath || 'piano-unknown';
    return `piano:${base}`;
  }

  _loadBestRecords() {
    try {
      const raw = localStorage.getItem('rhythm-game-best-v1');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
      return {};
    } catch (_) {
      return {};
    }
  }

  _saveBestRecords(records) {
    try {
      localStorage.setItem('rhythm-game-best-v1', JSON.stringify(records));
    } catch (_) {}
  }

  _updateBestRecord(chartKey, results) {
    if (!chartKey || !results) return null;

    const records = this._loadBestRecords();
    const prev = records[chartKey] || null;
    const next = {
      score: results.score || 0,
      accuracy: results.accuracy || 0,
      maxCombo: results.maxCombo || 0,
      grade: results.grade || 'D',
      cleared: !results.failed,
      updatedAt: Date.now()
    };

    const prevScore = prev ? prev.score || 0 : 0;
    const shouldReplace = !prev || next.score > prevScore;
    if (shouldReplace) {
      records[chartKey] = next;
      this._saveBestRecords(records);
    }

    return {
      isNewRecord: shouldReplace,
      current: next,
      best: shouldReplace ? next : prev
    };
  }

  // ─── Results ───────────────────────────────────

  _showResults(results) {
    this._showView('results');

    const statsEl = document.getElementById('results-stats');
    const gradeColors = { S: '#FFD700', A: '#00FF88', B: '#4D96FF', C: '#FFD93D', D: '#FF6B6B' };
    const modeLabel = results.gameMode === 'vocal' ? 'Vocal Mode' : 'Piano Mode';
    const modeColor = results.gameMode === 'vocal' ? '#FF6B9D' : '#4D96FF';
    const clearLabel = results.failed ? 'FAILED' : 'CLEARED';
    const clearColor = results.failed ? '#FF6B6B' : '#6BCB77';
    const timing = results.timing || { fast: 0, slow: 0, avgAbsMs: 0, avgMs: 0 };

    let bestHtml = '';
    if (results.bestRecord && results.bestRecord.best) {
      const best = results.bestRecord.best;
      const tag = results.bestRecord.isNewRecord ? 'NEW BEST' : 'BEST';
      bestHtml = `
        <div class="results-best" style="margin:10px 0 14px;padding:8px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:rgba(255,255,255,0.03);">
          <div style="font-size:0.72rem;color:${results.bestRecord.isNewRecord ? '#FFD700' : 'rgba(255,255,255,0.5)'};font-weight:800;letter-spacing:0.7px;">${tag}</div>
          <div style="font-size:0.9rem;color:#fff;margin-top:3px;">${Number(best.score || 0).toLocaleString()} pts · ${best.accuracy || 0}% · ${best.grade || 'D'}</div>
        </div>
      `;
    }

    let completionHtml = '';
    if (results.gameMode === 'vocal') {
      const completion = results.totalNotes > 0
        ? Math.round((results.judgments.perfect + results.judgments.great) / results.totalNotes * 100)
        : 0;
      completionHtml = `<div class="results-completion" style="color:#FF6B9D;font-size:1.1rem;font-weight:700;margin-bottom:8px;">Song Completion: ${completion}%</div>`;
    }

    statsEl.innerHTML = `
      <div class="results-mode" style="color:${modeColor};font-size:0.85rem;font-weight:600;margin-bottom:12px;letter-spacing:1px;">${modeLabel}</div>
      <div class="results-clear" style="color:${clearColor};font-size:0.82rem;font-weight:800;letter-spacing:1px;margin-bottom:8px;">${clearLabel}</div>
      <div class="results-grade" style="color:${gradeColors[results.grade] || '#fff'}">${results.grade}</div>
      <div class="results-score">${results.score.toLocaleString()}</div>
      <div class="results-accuracy">Accuracy: ${results.accuracy}%</div>
      ${bestHtml}
      ${completionHtml}
      <div class="results-detail">
        <div class="results-row">
          <span class="results-label" style="color:#FFD700">PERFECT</span>
          <span class="results-count">${results.judgments.perfect}</span>
        </div>
        <div class="results-row">
          <span class="results-label" style="color:#00FF88">GREAT</span>
          <span class="results-count">${results.judgments.great}</span>
        </div>
        <div class="results-row">
          <span class="results-label" style="color:#4D96FF">GOOD</span>
          <span class="results-count">${results.judgments.good}</span>
        </div>
        <div class="results-row">
          <span class="results-label" style="color:#FF4444">MISS</span>
          <span class="results-count">${results.judgments.miss}</span>
        </div>
        <div class="results-row">
          <span class="results-label" style="color:#4D96FF">FAST</span>
          <span class="results-count">${timing.fast}</span>
        </div>
        <div class="results-row">
          <span class="results-label" style="color:#FF9F43">SLOW</span>
          <span class="results-count">${timing.slow}</span>
        </div>
      </div>
      <div class="results-combo">Max Combo: ${results.maxCombo}</div>
      <div class="results-combo">Avg Error: ${timing.avgAbsMs}ms (Bias ${timing.avgMs > 0 ? '+' : ''}${timing.avgMs}ms)</div>
      <div class="results-combo">End HP: ${results.hp}</div>
      <div class="results-total">Total Notes: ${results.totalNotes}</div>
      <div class="results-difficulty">Difficulty: Lv.${results.difficultyLevel || '?'} / 20</div>
    `;
  }

  _getDifficultyClass(diff) {
    if (!diff) return 'diff-medium';
    if (diff === 'vocal') return 'diff-vocal';
    if (diff.includes('초급') || diff.includes('beginner')) return 'diff-easy';
    if (diff.includes('고급') || diff.includes('advanced')) return 'diff-hard';
    return 'diff-medium';
  }

  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Global instance
const rhythmGameUI = new RhythmGameUI();
document.addEventListener('DOMContentLoaded', () => {
  rhythmGameUI.init();
});
