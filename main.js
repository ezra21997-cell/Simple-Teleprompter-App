const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

// ─── uiohook global (non-exclusive) keyboard listener ────────────────────────
let uIOhook;
let watchKeycode = 57; // Space scan-code default

// Browser event.code → uiohook scan-code map (PC/AT Set-1 scan codes)
const CODE_TO_SCANCODE = {
  Escape:33,Space:57,Enter:28,Backspace:14,Tab:15,
  CapsLock:58,
  ShiftLeft:42,ShiftRight:54,ControlLeft:29,ControlRight:3613,
  AltLeft:56,AltRight:3640,MetaLeft:3675,MetaRight:3676,
  KeyA:30,KeyB:48,KeyC:46,KeyD:32,KeyE:18,KeyF:33,KeyG:34,
  KeyH:35,KeyI:23,KeyJ:36,KeyK:37,KeyL:38,KeyM:50,KeyN:49,
  KeyO:24,KeyP:25,KeyQ:16,KeyR:19,KeyS:31,KeyT:20,KeyU:22,
  KeyV:47,KeyW:17,KeyX:45,KeyY:21,KeyZ:44,
  Digit1:2,Digit2:3,Digit3:4,Digit4:5,Digit5:6,
  Digit6:7,Digit7:8,Digit8:9,Digit9:10,Digit0:11,
  F1:59,F2:60,F3:61,F4:62,F5:63,F6:64,
  F7:65,F8:66,F9:67,F10:68,F11:87,F12:88,
  ArrowLeft:75,ArrowRight:77,ArrowUp:72,ArrowDown:80,
  Home:71,End:79,PageUp:73,PageDown:81,
  Insert:82,Delete:83,
};

function startHook() {
  try {
    ({ uIOhook } = require('uiohook-napi'));
    uIOhook.on('keydown', (e) => {
      // Only relay when window is NOT focused — local keydown handles focused case
      if (e.keycode === watchKeycode && mainWindow && !mainWindow.isFocused()) {
        mainWindow.webContents.send('toggle-scroll');
      }
    });
    uIOhook.start();
  } catch (err) {
    console.warn('uiohook-napi unavailable, global hotkey disabled:', err.message);
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 500,
    backgroundColor: '#1a1a1a',
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    hasShadow: true,
    roundedCorners: true,
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  startHook();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  try { if (uIOhook) uIOhook.stop(); } catch (e) {}
});

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('window-close', () => mainWindow && mainWindow.close());

// Renderer sends event.code string; we convert to scan-code
ipcMain.handle('set-watch-key', (event, code) => {
  const sc = CODE_TO_SCANCODE[code];
  if (sc !== undefined) watchKeycode = sc;
});
