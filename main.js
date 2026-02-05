const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs-extra');

let mainWindow;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  // Open DevTools for debugging
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function initializeApp() {
  // Ensure required directories exist
  const dirs = [
    path.join(__dirname, 'temp'),
    path.join(__dirname, 'output')
  ];

  for (const dir of dirs) {
    await fs.ensureDir(dir);
  }

  // Clean up any leftover temp files from previous sessions
  const tempDir = path.join(__dirname, 'temp');
  await fs.emptyDir(tempDir);
}

app.whenReady().then(async () => {
  await initializeApp();

  // Initialize IPC handlers
  require('./src/main/ipc-handlers');

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Cleanup temp files on exit
  const tempDir = path.join(__dirname, 'temp');
  try {
    await fs.emptyDir(tempDir);
  } catch (error) {
    console.error('Error cleaning up temp directory:', error);
  }
});
