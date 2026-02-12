const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Start processing a YouTube URL
  startProcessing: (url) => ipcRenderer.invoke('start-processing', url),

  // Cancel ongoing processing
  cancelProcessing: () => ipcRenderer.invoke('cancel-processing'),

  // Listen for progress updates
  onProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('progress-update', subscription);
    return () => ipcRenderer.removeListener('progress-update', subscription);
  },

  // Listen for error events
  onError: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('error-occurred', subscription);
    return () => ipcRenderer.removeListener('error-occurred', subscription);
  },

  // Listen for completion events
  onComplete: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('processing-complete', subscription);
    return () => ipcRenderer.removeListener('processing-complete', subscription);
  },

  // Open the generated PDF
  openPdf: (filePath) => ipcRenderer.invoke('open-pdf', filePath),

  // Get output directory path
  getOutputDir: () => ipcRenderer.invoke('get-output-dir'),

  // Get conversion history
  getHistory: () => ipcRenderer.invoke('get-history'),

  // Rhythm game APIs
  listMidiFiles: () => ipcRenderer.invoke('list-midi-files'),
  loadMidiForGame: (midiPath) => ipcRenderer.invoke('load-midi-for-game', midiPath),
  readAudioFile: (audioPath) => ipcRenderer.invoke('read-audio-file', audioPath),

  // Import external MIDI file via file dialog
  importMidiFile: () => ipcRenderer.invoke('import-midi-file'),

  // Vocal rhythm game: prepare song from URL
  prepareVocalGame: (url) => ipcRenderer.invoke('prepare-vocal-game', url),

  // Listen for vocal game preparation progress
  onVocalGameProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('vocal-game-progress', subscription);
    return () => ipcRenderer.removeListener('vocal-game-progress', subscription);
  },

  // Convert local file path to file:// URL for video playback
  pathToFileURL: (filePath) => {
    // Normalize Windows backslashes and encode for URL
    const normalized = filePath.replace(/\\/g, '/');
    return 'file:///' + encodeURI(normalized).replace(/#/g, '%23');
  }
});
