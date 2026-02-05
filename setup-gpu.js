const { spawn } = require('child_process');
const path = require('path');

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, {
      cwd: __dirname,
      stdio: 'inherit'
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}`));
      } else {
        resolve();
      }
    });

    proc.on('error', reject);
  });
}

async function setupGPU() {
  console.log('Setting up GPU support...');

  try {
    // Uninstall CPU versions
    console.log('Removing CPU versions of PyTorch...');
    await runCommand('uv', ['pip', 'uninstall', 'torch', 'torchaudio']).catch(() => {
      console.log('PyTorch already uninstalled or not found');
    });

    // Install CUDA versions
    console.log('Installing PyTorch with CUDA 11.8 support...');
    await runCommand('uv', [
      'pip',
      'install',
      '--index-url',
      'https://download.pytorch.org/whl/cu118',
      'torch==2.7.1+cu118',
      'torchaudio==2.7.1+cu118'
    ]);

    console.log('GPU setup complete!');
  } catch (error) {
    console.error('GPU setup failed:', error.message);
    process.exit(1);
  }
}

setupGPU();
