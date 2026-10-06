const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let mainWindow;

// ─── uiohook global (non-exclusive) keyboard listener ────────────────────────
let uIOhook;
let watchKeycode = 57; // Space scan-code default

// Browser event.code → uiohook scan-code map (PC/AT Set-1 scan codes)
const CODE_TO_SCANCODE = {
  Escape:1,Space:57,Enter:28,Backspace:14,Tab:15,
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
  ArrowLeft:57419,ArrowRight:57421,ArrowUp:57416,ArrowDown:57424,
  Home:60999,End:61007,PageUp:61001,PageDown:61009,
  Insert:61010,Delete:61011,
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

// ─── Speech model (Voice Follow) ──────────────────────────────────────────────
// The renderer loads the offline Vosk model from tpmodel://<file>. The first
// request downloads it into the user-data folder; later runs work offline.
const MODEL_BASE_URL = 'https://ccoreilly.github.io/vosk-browser/models/';
const MODEL_FILES = new Set(['vosk-model-small-en-us-0.15.tar.gz']);
const modelDownloads = new Map();

protocol.registerSchemesAsPrivileged([
  { scheme: 'tpmodel', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

async function ensureModel(name) {
  const dest = path.join(app.getPath('userData'), 'models', name);
  if (fs.existsSync(dest)) return dest;
  if (!modelDownloads.has(name)) {
    modelDownloads.set(name, (async () => {
      const res = await net.fetch(MODEL_BASE_URL + name);
      if (!res.ok) throw new Error('Model download failed: HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest + '.part', buf);
      await fs.promises.rename(dest + '.part', dest);
      return dest;
    })().finally(() => modelDownloads.delete(name)));
  }
  return modelDownloads.get(name);
}

function registerModelProtocol() {
  protocol.handle('tpmodel', async (request) => {
    const name = decodeURIComponent(new URL(request.url).hostname || '');
    if (!MODEL_FILES.has(name)) return new Response('Not found', { status: 404 });
    try {
      const file = await ensureModel(name);
      const res = await net.fetch(pathToFileURL(file).toString());
      return new Response(res.body, {
        headers: { 'Content-Type': 'application/gzip', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (err) {
      return new Response(String(err.message || err), { status: 502 });
    }
  });
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

  // If the page crashes, log why and reload instead of leaving a blank window
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    const line = `${new Date().toISOString()} renderer gone: ${details.reason} (exit ${details.exitCode})\n`;
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), line); } catch (e) {}
    if (details.reason !== 'clean-exit' && mainWindow) mainWindow.reload();
  });
}

app.whenReady().then(() => {
  registerModelProtocol();
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
