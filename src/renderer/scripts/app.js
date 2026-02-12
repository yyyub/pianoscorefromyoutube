// Main application logic for renderer process
let isProcessing = false;
let generatedPdfPath = null;
let generatedOutputDir = null;
let latestRecommendation = null;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  setupIPCListeners();
  loadHistory();
});

function initializeEventListeners() {
  const startBtn = document.getElementById('start-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const urlInput = document.getElementById('youtube-url');
  const clearLogBtn = document.getElementById('clear-log-btn');
  const openPdfBtn = document.getElementById('open-pdf-btn');
  const openFolderBtn = document.getElementById('open-folder-btn');
  const useSeparationToggle = document.getElementById('use-separation');
  const qualityModeSelect = document.getElementById('quality-mode');
  const sourceTypeSelect = document.getElementById('source-type');
  const targetPrioritySelect = document.getElementById('target-priority');
  const issueOffbeatToggle = document.getElementById('issue-offbeat');
  const issueWrongNotesToggle = document.getElementById('issue-wrong-notes');
  const applyRecommendedBtn = document.getElementById('apply-recommended-btn');

  const refreshRecommendation = () => {
    latestRecommendation = getRecommendation({
      sourceType: sourceTypeSelect ? sourceTypeSelect.value : 'unknown',
      targetPriority: targetPrioritySelect ? targetPrioritySelect.value : 'balanced',
      offbeat: issueOffbeatToggle ? issueOffbeatToggle.checked : false,
      wrongNotes: issueWrongNotesToggle ? issueWrongNotesToggle.checked : false
    });
    renderRecommendation(latestRecommendation);
  };

  // Start processing
  startBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();

    if (!validateYouTubeUrl(url)) {
      showUrlError('유효한 YouTube URL을 입력하세요');
      return;
    }

    clearUrlError();

    if (!latestRecommendation) {
      refreshRecommendation();
    }

    if (latestRecommendation) {
      addLog(`권장: ${latestRecommendation.summary}`, 'info');
    }

    await startProcessing(url, {
      useSeparation: useSeparationToggle ? useSeparationToggle.checked : false,
      qualityMode: qualityModeSelect ? qualityModeSelect.value : 'normal',
      sourceType: sourceTypeSelect ? sourceTypeSelect.value : 'unknown',
      targetPriority: targetPrioritySelect ? targetPrioritySelect.value : 'balanced',
      issueOffbeat: issueOffbeatToggle ? issueOffbeatToggle.checked : false,
      issueWrongNotes: issueWrongNotesToggle ? issueWrongNotesToggle.checked : false
    });
  });

  // Cancel processing
  cancelBtn.addEventListener('click', async () => {
    await window.electronAPI.cancelProcessing();
    addLog('처리가 취소되었습니다.', 'warning');
    resetUI();
  });

  // Enter key in URL input
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !isProcessing) {
      startBtn.click();
    }
  });

  // Clear log
  clearLogBtn.addEventListener('click', () => {
    clearLog();
  });

  // Open generated PDF
  openPdfBtn.addEventListener('click', async () => {
    if (generatedPdfPath) {
      await window.electronAPI.openPdf(generatedPdfPath);
    }
  });

  // Open output folder (open the song's subfolder if available)
  openFolderBtn.addEventListener('click', async () => {
    const dir = generatedOutputDir || await window.electronAPI.getOutputDir();
    if (dir) {
      await window.electronAPI.openPdf(dir);
    }
  });

  // Help and about links
  document.getElementById('help-link').addEventListener('click', (e) => {
    e.preventDefault();
    showHelpDialog();
  });

  document.getElementById('about-link').addEventListener('click', (e) => {
    e.preventDefault();
    showAboutDialog();
  });

  // Rhythm game buttons
  document.getElementById('rhythm-game-btn').addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof rhythmGameUI !== 'undefined') rhythmGameUI.show();
  });

  const rhythmGameResultBtn = document.getElementById('rhythm-game-result-btn');
  if (rhythmGameResultBtn) {
    rhythmGameResultBtn.addEventListener('click', () => {
      if (typeof rhythmGameUI !== 'undefined') rhythmGameUI.show();
    });
  }

  if (applyRecommendedBtn) {
    applyRecommendedBtn.addEventListener('click', () => {
      if (!latestRecommendation) {
        refreshRecommendation();
      }
      applyRecommendation(latestRecommendation, useSeparationToggle, qualityModeSelect);
    });
  }

  [sourceTypeSelect, targetPrioritySelect, issueOffbeatToggle, issueWrongNotesToggle].forEach(el => {
    if (!el) return;
    el.addEventListener('change', refreshRecommendation);
  });

  refreshRecommendation();
  applyRecommendation(latestRecommendation, useSeparationToggle, qualityModeSelect, false);
}

function setupIPCListeners() {
  // Progress updates
  window.electronAPI.onProgress((data) => {
    updateProgress(data.step, data.percentage, data.message);
  });

  // Error events
  window.electronAPI.onError((data) => {
    addLog(`오류: ${data.message}`, 'error');
    resetUI();
    isProcessing = false;
  });

  // Completion events
  window.electronAPI.onComplete((data) => {
    generatedPdfPath = data.pdfPath;
    generatedOutputDir = data.outputDir || null;
    showSuccess(data.pdfPath, data.filename);
    isProcessing = false;
  });
}

async function startProcessing(url, options) {
  if (isProcessing) return;

  isProcessing = true;
  prepareUI();
  addLog(`처리 시작: ${url}`, 'info');

  try {
    await window.electronAPI.startProcessing({ url, options });
  } catch (error) {
    addLog(`오류 발생: ${error.message}`, 'error');
    resetUI();
    isProcessing = false;
  }
}

function validateYouTubeUrl(url) {
  if (!url) return false;

  const patterns = [
    /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
    /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]{11}/
  ];

  return patterns.some(pattern => pattern.test(url));
}

function prepareUI() {
  // Disable input and controls
  document.getElementById('youtube-url').disabled = true;
  document.getElementById('start-btn').disabled = true;
  document.getElementById('cancel-btn').disabled = false;
  const controlIds = [
    'use-separation',
    'quality-mode',
    'source-type',
    'target-priority',
    'issue-offbeat',
    'issue-wrong-notes',
    'apply-recommended-btn'
  ];
  controlIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
  });

  // Show progress section
  document.getElementById('progress-section').classList.add('active');

  // Hide result section
  document.getElementById('result-section').classList.remove('active');

  // Reset progress
  resetProgress();
}

function resetUI() {
  // Enable input and controls
  document.getElementById('youtube-url').disabled = false;
  document.getElementById('start-btn').disabled = false;
  document.getElementById('cancel-btn').disabled = true;
  const controlIds = [
    'use-separation',
    'quality-mode',
    'source-type',
    'target-priority',
    'issue-offbeat',
    'issue-wrong-notes',
    'apply-recommended-btn'
  ];
  controlIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });

  // Reset progress
  resetProgress();

  isProcessing = false;
}

function showSuccess(pdfPath, filename) {
  // Hide progress section
  document.getElementById('progress-section').classList.remove('active');

  // Show result section
  const resultSection = document.getElementById('result-section');
  const resultMessage = document.getElementById('result-message');
  resultSection.classList.add('active');
  resultMessage.textContent = `${filename} 파일이 생성되었습니다.`;

  // Enable input
  document.getElementById('youtube-url').disabled = false;
  document.getElementById('start-btn').disabled = false;
  document.getElementById('cancel-btn').disabled = true;
  const controlIds = [
    'use-separation',
    'quality-mode',
    'source-type',
    'target-priority',
    'issue-offbeat',
    'issue-wrong-notes',
    'apply-recommended-btn'
  ];
  controlIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });

  addLog(`변환 완료: ${filename}`, 'success');
  loadHistory();
}

function showUrlError(message) {
  const input = document.getElementById('youtube-url');
  const errorSpan = document.getElementById('url-error');

  input.classList.add('error');
  errorSpan.textContent = message;
}

function clearUrlError() {
  const input = document.getElementById('youtube-url');
  const errorSpan = document.getElementById('url-error');

  input.classList.remove('error');
  errorSpan.textContent = '';
}

async function loadHistory() {
  try {
    const history = await window.electronAPI.getHistory();
    const listEl = document.getElementById('history-list');

    if (!history || history.length === 0) {
      listEl.innerHTML = '<div class="history-empty">변환 기록이 없습니다.</div>';
      return;
    }

    listEl.innerHTML = history.map(entry => {
      const date = new Date(entry.timestamp);
      const dateStr = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
      const title = entry.title.length > 40 ? entry.title.slice(0, 40) + '...' : entry.title;
      return `<div class="history-item" data-url="${entry.url}" title="${entry.title}">
        <span class="history-title">${title}</span>
        <span class="history-date">${dateStr}</span>
      </div>`;
    }).join('');

    // Click to fill URL input
    listEl.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        if (isProcessing) return;
        const urlInput = document.getElementById('youtube-url');
        urlInput.value = item.dataset.url;
        clearUrlError();
        urlInput.focus();
      });
    });
  } catch (error) {
    console.error('Failed to load history:', error);
  }
}

function showHelpDialog() {
  addLog('도움말: FFmpeg가 시스템에 설치되어 있어야 합니다. https://ffmpeg.org/download.html', 'info');
}

function showAboutDialog() {
  addLog('YouTube to Piano Sheet Music v1.0.0 - Powered by Spotify Basic Pitch AI', 'info');
}

function getRecommendation({ sourceType, targetPriority, offbeat, wrongNotes }) {
  let useSeparation = false;
  let qualityMode = 'intermediate';
  const reasons = [];

  if (sourceType === 'original') {
    useSeparation = true;
    reasons.push('원곡은 악기/보컬이 섞여 있어 음원 분리 사용이 유리합니다.');
  } else if (sourceType === 'piano-cover') {
    useSeparation = false;
    reasons.push('피아노 커버는 분리 시 음 손실이 생길 수 있어 분리 비활성화가 안정적입니다.');
  } else {
    useSeparation = true;
    reasons.push('곡 유형이 불확실해 보수적으로 음원 분리를 권장합니다.');
  }

  if (targetPriority === 'accuracy') {
    qualityMode = 'advanced';
    reasons.push('유사도 우선이므로 고급 모드로 세부 음표를 더 보존합니다.');
  } else if (targetPriority === 'speed') {
    qualityMode = 'beginner';
    reasons.push('빠른 초안 우선이라 초급 모드로 처리량을 줄입니다.');
  } else {
    qualityMode = 'intermediate';
    reasons.push('균형 목표이므로 중급 모드를 권장합니다.');
  }

  if (offbeat) {
    qualityMode = 'advanced';
    reasons.push('엇박 문제가 체크되어 리듬 해상도 확보를 위해 고급 모드로 상향합니다.');
  }

  if (wrongNotes) {
    if (sourceType === 'piano-cover') {
      useSeparation = false;
    }
    if (targetPriority !== 'accuracy') {
      qualityMode = 'intermediate';
    }
    reasons.push('이상한 음이 많다면 과도한 분리/과소 필터링을 피하는 설정이 유리합니다.');
  }

  const qualityLabel = {
    beginner: '초급',
    intermediate: '중급',
    advanced: '고급'
  };

  const summary = `음원 분리 ${useSeparation ? 'ON' : 'OFF'} + ${qualityLabel[qualityMode]} 모드`;
  return { useSeparation, qualityMode, reasons, summary };
}

function renderRecommendation(recommendation) {
  if (!recommendation) return;

  const recommendationText = document.getElementById('recommendation-text');
  const settingSummary = document.getElementById('setting-summary');

  if (settingSummary) {
    settingSummary.textContent = `권장 설정: ${recommendation.summary}`;
  }

  if (recommendationText) {
    recommendationText.innerHTML = recommendation.reasons
      .map(reason => `<div class="recommendation-item">- ${reason}</div>`)
      .join('');
  }
}

function applyRecommendation(recommendation, useSeparationToggle, qualityModeSelect, withLog = true) {
  if (!recommendation) return;

  if (useSeparationToggle) {
    useSeparationToggle.checked = recommendation.useSeparation;
  }

  if (qualityModeSelect) {
    qualityModeSelect.value = recommendation.qualityMode;
  }

  if (withLog) {
    addLog(`권장 설정 적용: ${recommendation.summary}`, 'success');
  }
}
