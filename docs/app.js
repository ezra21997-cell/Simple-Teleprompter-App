'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  script:    '',
  speed:     50,
  fontSize:  36,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  scrolling: false,
  offset:    0,
  maxOffset: 0,
  lastTime:  null,
  rafId:     null,
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const editView       = document.getElementById('edit-view');
const prompterView   = document.getElementById('prompter-view');
const scriptInput    = document.getElementById('script-input');
const speedSlider    = document.getElementById('speed-slider');
const speedValue     = document.getElementById('speed-value');
const fontsizeSlider = document.getElementById('fontsize-slider');
const fontsizeValue  = document.getElementById('fontsize-value');
const fontSelect     = document.getElementById('font-select');
const startBtn       = document.getElementById('start-btn');
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
const tapHint        = document.getElementById('tap-hint');

// ─── Screen Wake Lock ─────────────────────────────────────────────────────────
let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    console.warn('Wake lock unavailable:', e.message);
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    try { await wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }
}

// Re-acquire wake lock if page becomes visible again (iOS releases it on hide)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && prompterView.classList.contains('active')) {
    await requestWakeLock();
  }
});

// ─── Edit Controls ────────────────────────────────────────────────────────────
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

// ─── Start Prompter ───────────────────────────────────────────────────────────
startBtn.addEventListener('click', startPrompter);

async function startPrompter() {
  state.script = scriptInput.value.trim();
  if (!state.script) {
    scriptInput.focus();
    scriptInput.style.borderColor = '#ff5f57';
    setTimeout(() => { scriptInput.style.borderColor = ''; }, 1200);
    return;
  }

  prompterText.textContent = state.script;
  prompterText.style.fontSize   = state.fontSize + 'px';
  prompterText.style.fontFamily = state.fontFamily;

  state.offset    = 0;
  state.scrolling = true;
  state.lastTime  = null;
  applyOffset();

  hudSpeed.value = state.speed;
  hudSpeedVal.textContent = state.speed;
  hudFontsize.value = state.fontSize;
  hudFontsizeVal.textContent = state.fontSize + 'px';

  setPlayState(true);
  showTapHint();

  editView.classList.remove('active');
  prompterView.classList.add('active');

  await requestWakeLock();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      computeMaxOffset();
      startScrollLoop();
    });
  });
}

// ─── Back to Edit ─────────────────────────────────────────────────────────────
backBtn.addEventListener('click', async () => {
  stopScrollLoop();
  setPlayState(false);
  await releaseWakeLock();
  prompterView.classList.remove('active');
  editView.classList.add('active');
});

// ─── Tap anywhere on prompter to pause/resume ─────────────────────────────────
prompterView.addEventListener('click', (e) => {
  // Don't toggle when tapping a button or slider
  if (e.target.closest('button, input')) return;
  toggleScroll();
});

// ─── HUD Controls ─────────────────────────────────────────────────────────────
playPauseBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // Don't also trigger the view tap handler
  toggleScroll();
});

hudSpeed.addEventListener('input', (e) => {
  e.stopPropagation();
  state.speed = parseInt(hudSpeed.value);
  hudSpeedVal.textContent = state.speed;
  speedSlider.value = state.speed;
  speedValue.textContent = state.speed;
});

hudFontsize.addEventListener('input', (e) => {
  e.stopPropagation();
  state.fontSize = parseInt(hudFontsize.value);
  hudFontsizeVal.textContent = state.fontSize + 'px';
  prompterText.style.fontSize = state.fontSize + 'px';
  fontsizeSlider.value = state.fontSize;
  fontsizeValue.textContent = state.fontSize + 'px';
  requestAnimationFrame(computeMaxOffset);
});

// ─── Scroll Engine ────────────────────────────────────────────────────────────
function computeMaxOffset() {
  state.maxOffset = prompterText.scrollHeight - (window.innerHeight * 0.5);
  if (state.maxOffset < 0) state.maxOffset = 0;
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
  const delta = (timestamp - state.lastTime) / 1000;
  state.lastTime = timestamp;

  state.offset += state.speed * delta;
  computeMaxOffset();

  if (state.offset >= state.maxOffset) {
    state.offset = state.maxOffset;
    applyOffset();
    updateProgress();
    setPlayState(false);
    stopScrollLoop();
    releaseWakeLock();
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
}

function toggleScroll() {
  state.scrolling = !state.scrolling;
  setPlayState(state.scrolling);
  if (state.scrolling) state.lastTime = null;
  hideTapHint();
}

function setPlayState(playing) {
  state.scrolling = playing;
  playIcon.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
  if (playing) {
    playPauseBtn.classList.add('playing');
  } else {
    playPauseBtn.classList.remove('playing');
  }
}

// ─── Tap hint (fades out after first interaction) ─────────────────────────────
let hintTimer = null;

function showTapHint() {
  tapHint.classList.remove('hidden');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => tapHint.classList.add('hidden'), 3000);
}

function hideTapHint() {
  tapHint.classList.add('hidden');
}
