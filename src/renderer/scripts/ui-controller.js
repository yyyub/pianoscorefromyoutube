// UI Controller - Manages UI state and updates

// ─── ETA Tracking State ────────────────────────────

let processStartTime = null;
let lastPercentage = 0;
let lastUpdateTime = null;
let lastDisplayedETA = '';
let lastETAUpdateTime = 0;
let currentTrackingStep = 0;

// Per-step timing history: records how long each step actually took
// Used to estimate remaining steps based on past runs
let stepHistory = {}; // { stepNum: { startTime, endTime, duration } }
let stepStartTime = null;

// Exponential moving average for smoothing
let emaSpeed = null; // ms per 1% (exponential moving average)
const EMA_ALPHA = 0.3; // smoothing factor: 0 = ignore new data, 1 = only new data

function formatETA(remainingMs) {
  if (remainingMs <= 0 || !isFinite(remainingMs)) return '';
  const totalSec = Math.round(remainingMs / 1000);
  if (totalSec < 5) return '곧 완료';
  // Round to nearest 5 seconds for stability
  const rounded = Math.ceil(totalSec / 5) * 5;
  if (rounded < 60) return `약 ${rounded}초 남음`;
  const min = Math.floor(rounded / 60);
  const sec = rounded % 60;
  if (sec === 0) return `약 ${min}분 남음`;
  return `약 ${min}분 ${sec}초 남음`;
}

function getETA(step, percentage) {
  if (!processStartTime || percentage <= 0 || percentage >= 100) return '';

  const now = Date.now();

  // Reset EMA when step changes
  if (step !== currentTrackingStep) {
    // Record previous step duration
    if (currentTrackingStep > 0 && stepStartTime) {
      stepHistory[currentTrackingStep] = {
        duration: now - stepStartTime
      };
    }
    currentTrackingStep = step;
    stepStartTime = now;
    emaSpeed = null;
    lastPercentage = percentage;
    lastUpdateTime = now;
    return lastDisplayedETA; // Keep showing previous ETA during transition
  }

  // Calculate speed for this update
  if (lastUpdateTime && percentage > lastPercentage) {
    const timeDiff = now - lastUpdateTime;
    const percentDiff = percentage - lastPercentage;

    // Ignore obviously wrong measurements (e.g., step jump causing >50% jump)
    if (percentDiff < 20 && timeDiff > 100) {
      const speed = timeDiff / percentDiff; // ms per 1%

      if (emaSpeed === null) {
        emaSpeed = speed;
      } else {
        emaSpeed = EMA_ALPHA * speed + (1 - EMA_ALPHA) * emaSpeed;
      }
    }
  }

  if (emaSpeed === null) return lastDisplayedETA;

  // Estimate remaining time
  const remainingPercent = 100 - percentage;
  const remainingMs = emaSpeed * remainingPercent;

  // Throttle display updates: only update every 2 seconds to prevent flickering
  const etaText = formatETA(remainingMs);
  if (now - lastETAUpdateTime > 2000 || !lastDisplayedETA) {
    lastDisplayedETA = etaText;
    lastETAUpdateTime = now;
  }

  return lastDisplayedETA;
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
  lastDisplayedETA = '';
  lastETAUpdateTime = 0;
  currentTrackingStep = 0;
  stepHistory = {};
  stepStartTime = null;
  emaSpeed = null;

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
    stepStartTime = now;
    currentTrackingStep = step;
  }

  // Update progress bar
  updateProgressBar(percentage);

  // Calculate ETA only for step 3 (transcription) since it's the only long step
  const eta = step === 3 ? getETA(step, percentage) : '';
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
