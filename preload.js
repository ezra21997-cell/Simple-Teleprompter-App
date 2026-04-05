const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close:    () => ipcRenderer.invoke('window-close'),

  // Tell main which key to watch globally (non-exclusive)
  setWatchKey: (code) => ipcRenderer.invoke('set-watch-key', code),

  // Fired by main when key is pressed while app is not focused
  onToggleScroll: (callback) => {
    ipcRenderer.removeAllListeners('toggle-scroll');
    ipcRenderer.on('toggle-scroll', callback);
  },
});
