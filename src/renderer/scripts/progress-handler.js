// Progress Handler - Handles progress calculations and step transitions

class ProgressHandler {
  constructor() {
    this.steps = {
      1: { name: '다운로드', weight: 0.25 },
      2: { name: '변환', weight: 0.15 },
      3: { name: '전사', weight: 0.45 },
      4: { name: '악보 생성', weight: 0.15 }
    };

    this.currentStep = 0;
    this.stepProgress = 0;
  }

  calculateOverallProgress(step, stepPercentage) {
    let totalProgress = 0;

    // Add completed steps
    for (let i = 1; i < step; i++) {
      totalProgress += this.steps[i].weight * 100;
    }

    // Add current step progress
    totalProgress += this.steps[step].weight * stepPercentage;

    return Math.min(Math.round(totalProgress), 100);
  }

  getStepName(step) {
    return this.steps[step]?.name || 'Unknown';
  }

  formatProgressMessage(step, stepPercentage, detail = '') {
    const stepName = this.getStepName(step);
    const message = detail
      ? `${stepName}: ${detail} (${stepPercentage}%)`
      : `${stepName}: ${stepPercentage}%`;

    return message;
  }

  reset() {
    this.currentStep = 0;
    this.stepProgress = 0;
  }
}

// Create global instance
const progressHandler = new ProgressHandler();
