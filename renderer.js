'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  script:      '',
  speed:       50,       // px/sec
  fontSize:    42,       // px
  fontFamily:  '-apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif',
  pauseKey:    'Space',  // Electron accelerator string
  rawKey:      ' ',      // raw key code / key for local listener

  scrolling:   false,
  offset:      0,        // current translateY in px (negative = scrolled up)
  maxOffset:   0,        // max scroll distance
  lastTime:    null,     // for rAF delta
  rafId:       null,
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const editView      = document.getElementById('edit-view');
const prompterView  = document.getElementById('prompter-view');
const scriptInput   = document.getElementById('script-input');
const speedSlider   = document.getElementById('speed-slider');
const speedValue    = document.getElementById('speed-value');
const fontsizeSlider = document.getElementById('fontsize-slider');
const fontsizeValue  = document.getElementById('fontsize-value');
const fontSelect    = document.getElementById('font-select');
const keyDisplay    = document.getElementById('key-display');
const keyPickerBtn  = document.getElementById('key-picker-btn');
const keyHint       = document.getElementById('key-hint');
const startBtn      = document.getElementById('start-btn');

const prompterText   = document.getElementById('prompter-text');
const prompterScroller = document.getElementById('prompter-scroller');
const backBtn        = document.getElementById('back-btn');
const playPauseBtn   = document.getElementById('play-pause-btn');
const playIcon       = document.getElementById('play-icon');
const hudSpeed       = document.getElementById('hud-speed');
const hudSpeedVal    = document.getElementById('hud-speed-val');
const hudFontsize    = document.getElementById('hud-fontsize');
const hudFontsizeVal = document.getElementById('hud-fontsize-val');
const progressFill   = document.getElementById('progress-bar-fill');
const prompterSeek   = document.getElementById('prompter-seek');

const btnMinimize = document.getElementById('btn-minimize');
const btnMaximize = document.getElementById('btn-maximize');
const btnClose    = document.getElementById('btn-close');

// ─── Window Controls ──────────────────────────────────────────────────────────
btnMinimize.addEventListener('click', () => window.electronAPI.minimize());
btnMaximize.addEventListener('click', () => window.electronAPI.maximize());
btnClose.addEventListener('click',    () => window.electronAPI.close());

// ─── Edit View Controls ───────────────────────────────────────────────────────
speedSlider.addEventListener('input', () => {
  state.speed = parseInt(speedSlider.value);
  speedValue.textContent = state.speed;
  hudSpeed.value = state.speed;
  hudSpeedVal.textContent = state.speed;
});

fontsizeSlider.addEventListener('input', () => {
  state.fontSize = parseInt(fontsizeSlider.value);
  fontsizeValue.textContent = state.fontSize + 'px';
  hudFontsize.value = state.fontSize;
  hudFontsizeVal.textContent = state.fontSize + 'px';
});

fontSelect.addEventListener('change', () => {
  state.fontFamily = fontSelect.value;
});

// ─── Key Picker ───────────────────────────────────────────────────────────────
let listeningForKey = false;

keyPickerBtn.addEventListener('click', () => {
  listeningForKey = true;
  keyPickerBtn.textContent = 'Listening…';
  keyPickerBtn.classList.add('listening');
  keyHint.classList.add('visible');
});

document.addEventListener('keydown', (e) => {
  if (!listeningForKey) return;
  e.preventDefault();
  e.stopPropagation();

  listeningForKey = false;
  keyPickerBtn.textContent = 'Change Key';
  keyPickerBtn.classList.remove('listening');
  keyHint.classList.remove('visible');

  // Store the raw key for local detection
  state.rawKey = e.key;

  // Convert to Electron accelerator string
  const accel = keyToAccelerator(e);
  state.pauseKey = accel;
  keyDisplay.textContent = accel;

  // Tell main process so the global (non-exclusive) hook watches for this key
  window.electronAPI.setWatchKey(e.code);
}, true);

function keyToAccelerator(e) {
  const parts = [];
  if (e.ctrlKey)  parts.push('Ctrl');
  if (e.altKey)   parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey)  parts.push('Super');

  const key = e.code;
  if (key === 'Space')      { parts.push('Space'); return parts.join('+'); }
  if (key.startsWith('Key')) { parts.push(key.slice(3)); return parts.join('+'); }
  if (key.startsWith('Digit')) { parts.push(key.slice(5)); return parts.join('+'); }
  if (key.startsWith('F') && key.length <= 3) { parts.push(key); return parts.join('+'); }

  const map = {
    'ArrowLeft':  'Left',  'ArrowRight': 'Right',
    'ArrowUp':    'Up',    'ArrowDown':  'Down',
    'Escape':     'Escape','Enter':      'Return',
    'Backspace':  'Backspace', 'Tab':    'Tab',
  };
  parts.push(map[key] || e.key);
  return parts.join('+');
}

// Register default Space with the global hook in main
window.electronAPI.setWatchKey('Space');

// ─── Start Prompter ───────────────────────────────────────────────────────────
startBtn.addEventListener('click', startPrompter);

// ─── Image Paste Handler ──────────────────────────────────────────────────────
scriptInput.addEventListener('paste', (e) => {
  e.preventDefault();
  const items = Array.from(e.clipboardData.items);
  const imageItem = items.find(item => item.type.startsWith('image/'));

  if (imageItem) {
    const blob = imageItem.getAsFile();
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = `<img src="${ev.target.result}" style="max-width:100%;height:auto;display:block;margin:0.5em 0;">`;
      document.execCommand('insertHTML', false, img);
    };
    reader.readAsDataURL(blob);
  } else {
    // Strip all formatting — insert plain text only
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }
});

function startPrompter() {
  const isEmpty = scriptInput.textContent.trim() === '' && !scriptInput.querySelector('img');
  if (isEmpty) {
    scriptInput.focus();
    scriptInput.style.borderColor = '#ff5f57';
    setTimeout(() => { scriptInput.style.borderColor = ''; }, 1200);
    return;
  }
  state.script = scriptInput.innerHTML;

  // Set up prompter text
  prompterText.innerHTML = state.script;
  prompterText.style.fontSize   = state.fontSize + 'px';
  prompterText.style.fontFamily = state.fontFamily;

  // Reset scroll
  state.offset    = 0;
  state.scrolling = true;
  state.lastTime  = null;
  prompterSeek.value = 0;
  applyOffset();

  // Sync HUD sliders
  hudSpeed.value  = state.speed;
  hudSpeedVal.textContent = state.speed;
  hudFontsize.value = state.fontSize;
  hudFontsizeVal.textContent = state.fontSize + 'px';

  setPlayState(true);

  // Switch views
  editView.classList.remove('active');
  prompterView.classList.add('active');

  // Compute max offset after layout (next frame)
  requestAnimationFrame(() => {
    requestAnimationFrame(computeMaxOffset);
    startScrollLoop();
  });
}

// ─── Back to Edit ─────────────────────────────────────────────────────────────
backBtn.addEventListener('click', () => {
  stopScrollLoop();
  prompterView.classList.remove('active');
  editView.classList.add('active');
});

// ─── HUD Controls ─────────────────────────────────────────────────────────────
playPauseBtn.addEventListener('click', toggleScroll);

hudSpeed.addEventListener('input', () => {
  state.speed = parseInt(hudSpeed.value);
  hudSpeedVal.textContent = state.speed;
  speedSlider.value = state.speed;
  speedValue.textContent = state.speed;
});

hudFontsize.addEventListener('input', () => {
  state.fontSize = parseInt(hudFontsize.value);
  hudFontsizeVal.textContent = state.fontSize + 'px';
  prompterText.style.fontSize = state.fontSize + 'px';
  fontsizeSlider.value = state.fontSize;
  fontsizeValue.textContent = state.fontSize + 'px';
  requestAnimationFrame(computeMaxOffset);
});

// ─── Global toggle from main process (pause key) ──────────────────────────────
window.electronAPI.onToggleScroll(() => toggleScroll());

// ─── Local keyboard fallback (when window is focused) ─────────────────────────
document.addEventListener('keydown', (e) => {
  if (listeningForKey) return;
  if (!prompterView.classList.contains('active')) return;
  if (e.key === state.rawKey) {
    e.preventDefault();
    toggleScroll();
  }
});

// ─── Scroll Engine ────────────────────────────────────────────────────────────
function computeMaxOffset() {
  const textH   = prompterText.scrollHeight;
  const viewH   = prompterScroller.clientHeight;
  // We start with text at 50vh padding-top; max scroll brings last line to guide line
  state.maxOffset = textH;
}

function startScrollLoop() {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.lastTime = null;
  state.rafId = requestAnimationFrame(tick);
}

function stopScrollLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
}

function tick(timestamp) {
  if (!state.scrolling) {
    state.rafId = requestAnimationFrame(tick);
    return;
  }

  if (!state.lastTime) state.lastTime = timestamp;
  const delta = (timestamp - state.lastTime) / 1000; // seconds
  state.lastTime = timestamp;

  state.offset += state.speed * delta;

  computeMaxOffset();

  if (state.offset >= state.maxOffset) {
    state.offset = state.maxOffset;
    applyOffset();
    updateProgress();
    setPlayState(false);
    stopScrollLoop();
    return;
  }

  applyOffset();
  updateProgress();
  state.rafId = requestAnimationFrame(tick);
}

function applyOffset() {
  prompterText.style.transform = `translateY(${-state.offset}px)`;
}

function updateProgress() {
  const pct = state.maxOffset > 0 ? (state.offset / state.maxOffset) * 100 : 0;
  progressFill.style.width = Math.min(100, pct) + '%';
  if (state.maxOffset > 0) {
    prompterSeek.value = Math.round((state.offset / state.maxOffset) * 1000);
  }
}

prompterSeek.addEventListener('input', () => {
  state.offset = (parseInt(prompterSeek.value) / 1000) * state.maxOffset;
  state.lastTime = null;
  applyOffset();
  updateProgress();
});

function toggleScroll() {
  state.scrolling = !state.scrolling;
  setPlayState(state.scrolling);
  if (state.scrolling) {
    state.lastTime = null; // reset delta so no jump
  }
}

function setPlayState(playing) {
  state.scrolling = playing;
  if (playing) {
    playIcon.innerHTML = '&#9646;&#9646;'; // pause icon
    playPauseBtn.classList.add('playing');
    playPauseBtn.title = 'Pause';
  } else {
    playIcon.innerHTML = '&#9654;'; // play icon
    playPauseBtn.classList.remove('playing');
    playPauseBtn.title = 'Play';
  }
}
