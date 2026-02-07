// Main application logic for renderer process
let isProcessing = false;
let generatedPdfPath = null;
let generatedOutputDir = null;

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

  // Start processing
  startBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();

    if (!validateYouTubeUrl(url)) {
      showUrlError('유효한 YouTube URL을 입력하세요');
      return;
    }

    clearUrlError();
    await startProcessing(url, {
      useSeparation: useSeparationToggle ? useSeparationToggle.checked : false,
      qualityMode: qualityModeSelect ? qualityModeSelect.value : 'normal'
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
  // Disable input
  document.getElementById('youtube-url').disabled = true;
  document.getElementById('start-btn').disabled = true;
  document.getElementById('cancel-btn').disabled = false;

  // Show progress section
  document.getElementById('progress-section').classList.add('active');

  // Hide result section
  document.getElementById('result-section').classList.remove('active');

  // Reset progress
  resetProgress();
}

function resetUI() {
  // Enable input
  document.getElementById('youtube-url').disabled = false;
  document.getElementById('start-btn').disabled = false;
  document.getElementById('cancel-btn').disabled = true;

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
