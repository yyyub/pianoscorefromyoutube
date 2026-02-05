const fs = require('fs');
const path = require('path');

const requiredFiles = [
  'main.js',
  'preload.js',
  'package.json',
  'README.md',
  'src/main/youtube-downloader.js',
  'src/main/audio-converter.js',
  'src/main/transcriber.js',
  'src/main/sheet-generator.js',
  'src/main/file-manager.js',
  'src/main/ipc-handlers.js',
  'src/renderer/index.html',
  'src/renderer/styles/main.css',
  'src/renderer/scripts/app.js',
  'src/renderer/scripts/ui-controller.js',
  'src/renderer/scripts/progress-handler.js'
];

const requiredDirs = [
  'temp',
  'output',
  'assets/icons',
  'src/main',
  'src/renderer/styles',
  'src/renderer/scripts'
];

console.log('🔍 Validating project structure...\n');

let allValid = true;

console.log('Checking required files:');
requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  const exists = fs.existsSync(filePath);
  console.log(`${exists ? '✅' : '❌'} ${file}`);
  if (!exists) allValid = false;
});

console.log('\nChecking required directories:');
requiredDirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  const exists = fs.existsSync(dirPath);
  console.log(`${exists ? '✅' : '❌'} ${dir}`);
  if (!exists) allValid = false;
});

console.log('\nChecking package.json configuration:');
const pkg = require('./package.json');
console.log(`✅ Main entry: ${pkg.main}`);
console.log(`✅ Start script: ${pkg.scripts.start}`);
console.log(`✅ Dependencies: ${Object.keys(pkg.dependencies).length} packages`);

console.log('\n' + '='.repeat(50));
if (allValid) {
  console.log('✅ All validation checks passed!');
  console.log('🚀 Run "npm start" to launch the application');
} else {
  console.log('❌ Some validation checks failed');
  console.log('Please ensure all required files and directories exist');
}
console.log('='.repeat(50));
