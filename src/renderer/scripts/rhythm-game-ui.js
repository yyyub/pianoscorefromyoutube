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
    const speedLabel = document.getElementById('speed-value');
    speedSlider.addEventListener('input', () => {
      speedLabel.textContent = speedSlider.value;
      if (this.game) this.game.setNoteSpeed(parseInt(speedSlider.value));
    });

    // Audio offset slider
    const offsetSlider = document.getElementById('audio-offset');
    const offsetLabel = document.getElementById('offset-value');
    offsetSlider.addEventListener('input', () => {
      const val = parseInt(offsetSlider.value);
      offsetLabel.textContent = (val >= 0 ? '+' : '') + val + 'ms';
      if (this.game) this.game.setAudioOffset(val);
    });

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
          this.game.setNoteSpeed(newSpeed);
          speedSlider.value = newSpeed;
          speedLabel.textContent = newSpeed;
          this._showSpeedIndicator(newSpeed);
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const newSpeed = Math.max(100, this.game.noteSpeed - 50);
          this.game.setNoteSpeed(newSpeed);
          speedSlider.value = newSpeed;
          speedLabel.textContent = newSpeed;
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
    Object.values(this.views).forEach(v => v.style.display = 'none');
    this.views[viewName].style.display = 'flex';
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
    this._bgVideo.style.display = 'block';
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
    this._bgVideo.style.display = 'none';
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

    hudScore.textContent = '0';
    hudCombo.style.display = 'none';
    hudJudgment.style.display = 'none';

    if (this.game) {
      this.game.destroy();
    }

    this.game = new RhythmGame(canvas);

    // Apply settings
    const speed = parseInt(document.getElementById('note-speed').value) || 400;
    this.game.setNoteSpeed(speed);

    const offset = parseInt(document.getElementById('audio-offset').value) || 0;
    this.game.setAudioOffset(offset);

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

    // Background video
    if (this.currentVideoPath) {
      this._loadBgVideo(this.currentVideoPath);
    } else {
      this._stopBgVideo();
    }

    // HUD callbacks
    this.game.onScoreUpdate = (score, combo, judgment) => {
      hudScore.textContent = score.toLocaleString();

      if (combo > 0) {
        hudCombo.textContent = combo + ' COMBO';
        hudCombo.style.display = 'block';
        hudCombo.classList.remove('combo-pop');
        void hudCombo.offsetWidth;
        hudCombo.classList.add('combo-pop');
      } else {
        hudCombo.style.display = 'none';
      }

      const colors = { perfect: '#FFD700', great: '#00FF88', good: '#4D96FF', miss: '#FF4444' };
      const labels = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
      hudJudgment.textContent = labels[judgment];
      hudJudgment.style.color = colors[judgment];
      hudJudgment.style.display = 'block';
      hudJudgment.classList.remove('judgment-pop');
      void hudJudgment.offsetWidth;
      hudJudgment.classList.add('judgment-pop');
      clearTimeout(this._judgmentTimeout);
      this._judgmentTimeout = setTimeout(() => { hudJudgment.style.display = 'none'; }, 500);
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

  // ─── Results ───────────────────────────────────

  _showResults(results) {
    this._showView('results');

    const statsEl = document.getElementById('results-stats');
    const gradeColors = { S: '#FFD700', A: '#00FF88', B: '#4D96FF', C: '#FFD93D', D: '#FF6B6B' };
    const modeLabel = results.gameMode === 'vocal' ? 'Vocal Mode' : 'Piano Mode';
    const modeColor = results.gameMode === 'vocal' ? '#FF6B9D' : '#4D96FF';

    let completionHtml = '';
    if (results.gameMode === 'vocal') {
      const completion = results.totalNotes > 0
        ? Math.round((results.judgments.perfect + results.judgments.great) / results.totalNotes * 100)
        : 0;
      completionHtml = `<div class="results-completion" style="color:#FF6B9D;font-size:1.1rem;font-weight:700;margin-bottom:8px;">Song Completion: ${completion}%</div>`;
    }

    statsEl.innerHTML = `
      <div class="results-mode" style="color:${modeColor};font-size:0.85rem;font-weight:600;margin-bottom:12px;letter-spacing:1px;">${modeLabel}</div>
      <div class="results-grade" style="color:${gradeColors[results.grade] || '#fff'}">${results.grade}</div>
      <div class="results-score">${results.score.toLocaleString()}</div>
      <div class="results-accuracy">Accuracy: ${results.accuracy}%</div>
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
      </div>
      <div class="results-combo">Max Combo: ${results.maxCombo}</div>
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
