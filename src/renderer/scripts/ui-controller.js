// UI Controller - Manages UI state and updates

let processStartTime = null;
let lastPercentage = 0;
let lastUpdateTime = null;
let recentSpeeds = []; // Array of ms per 1% progress

function formatETA(remainingMs) {
  if (remainingMs <= 0 || !isFinite(remainingMs)) return '';
  const totalSec = Math.ceil(remainingMs / 1000);
  if (totalSec < 5) return '곧 완료';
  if (totalSec < 60) return `약 ${totalSec}초 남음`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (sec === 0) return `약 ${min}분 남음`;
  return `약 ${min}분 ${sec}초 남음`;
}

function getETA(percentage) {
  if (!processStartTime || percentage <= 0 || percentage >= 100) return '';

  const now = Date.now();

  // Calculate speed for this update (ms per 1% progress)
  if (lastUpdateTime && lastPercentage < percentage) {
    const timeDiff = now - lastUpdateTime;
    const percentDiff = percentage - lastPercentage;
    const speed = timeDiff / percentDiff; // ms per 1%

    // Keep only last 5 measurements for moving average (more responsive)
    recentSpeeds.push(speed);
    if (recentSpeeds.length > 5) {
      recentSpeeds.shift();
    }
  }

  // Need at least 2 measurements
  if (recentSpeeds.length < 2) return '';

  // Calculate average speed (ignore outliers by removing min/max if we have enough samples)
  let speeds = [...recentSpeeds];
  if (speeds.length >= 4) {
    speeds.sort((a, b) => a - b);
    speeds = speeds.slice(1, -1); // Remove min and max
  }
  const avgSpeed = speeds.reduce((sum, s) => sum + s, 0) / speeds.length;

  // Estimate remaining time
  const remainingPercent = 100 - percentage;
  const remainingMs = avgSpeed * remainingPercent;

  return formatETA(remainingMs);
}

function addLog(message, type = 'info') {
  const logContainer = document.getElementById('log-container');
  const logMessage = document.createElement('div');
  logMessage.className = `log-message log-${type}`;

  const timestamp = new Date().toLocaleTimeString('ko-KR');
  logMessage.textContent = `[${timestamp}] ${message}`;

  logContainer.appendChild(logMessage);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function clearLog() {
  const logContainer = document.getElementById('log-container');
  logContainer.innerHTML = '<div class="log-message log-info">로그가 지워졌습니다.</div>';
}

function updateProgressBar(percentage) {
  const progressBar = document.getElementById('progress-bar');
  progressBar.style.width = `${percentage}%`;
}

function updateProgressText(text) {
  const progressText = document.getElementById('progress-text');
  progressText.textContent = text;
}

function updateStepStatus(stepNumber, status, statusText) {
  const step = document.querySelector(`.progress-step[data-step="${stepNumber}"]`);
  if (!step) return;

  const stepStatus = step.querySelector('.step-status');

  // Remove all status classes
  step.classList.remove('active', 'completed');

  // Add new status class
  if (status === 'active') {
    step.classList.add('active');
  } else if (status === 'completed') {
    step.classList.add('completed');
  }

  // Update status text
  if (statusText) {
    stepStatus.textContent = statusText;
  }
}

function resetProgress() {
  // Reset progress bar
  updateProgressBar(0);
  updateProgressText('준비 완료');
  processStartTime = null;
  lastPercentage = 0;
  lastUpdateTime = null;
  recentSpeeds = [];

  // Reset ETA display
  const etaEl = document.getElementById('eta-text');
  if (etaEl) etaEl.textContent = '';

  // Reset all steps
  for (let i = 1; i <= 4; i++) {
    updateStepStatus(i, 'pending', '대기 중');
  }
}

function updateProgress(step, percentage, message) {
  const now = Date.now();

  // Start timer on first progress
  if (!processStartTime && percentage > 0) {
    processStartTime = now;
    lastUpdateTime = now;
  }

  // Update progress bar
  updateProgressBar(percentage);

  // Calculate and update ETA (only for step 3 = transcription)
  let eta = '';
  if (step === 3) {
    eta = getETA(percentage);
  }
  updateProgressText(eta ? `${message}  |  ${eta}` : message);

  // Update ETA element if exists
  const etaEl = document.getElementById('eta-text');
  if (etaEl) etaEl.textContent = eta;

  // Update last values for next calculation
  lastPercentage = percentage;
  lastUpdateTime = now;

  // Update step status
  if (step > 0) {
    // Mark current step as active
    updateStepStatus(step, 'active', '진행 중');

    // Mark previous steps as completed
    for (let i = 1; i < step; i++) {
      updateStepStatus(i, 'completed', '완료');
    }

    // Mark future steps as pending
    for (let i = step + 1; i <= 4; i++) {
      updateStepStatus(i, 'pending', '대기 중');
    }
  }

  // Add log (without ETA to keep logs clean)
  addLog(message, 'info');
}

function setUIEnabled(enabled) {
  const urlInput = document.getElementById('youtube-url');
  const startBtn = document.getElementById('start-btn');
  const cancelBtn = document.getElementById('cancel-btn');

  urlInput.disabled = !enabled;
  startBtn.disabled = !enabled;
  cancelBtn.disabled = enabled;
}
