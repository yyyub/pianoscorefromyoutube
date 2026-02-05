// UI Controller - Manages UI state and updates

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

  // Reset all steps
  for (let i = 1; i <= 4; i++) {
    updateStepStatus(i, 'pending', '대기 중');
  }
}

function updateProgress(step, percentage, message) {
  // Update progress bar
  updateProgressBar(percentage);

  // Update progress text
  updateProgressText(message);

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

  // Add log
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
