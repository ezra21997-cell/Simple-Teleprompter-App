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
const pipBtn         = document.getElementById('pip-btn');

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

// ─── Picture-in-Picture ───────────────────────────────────────────────────────
let pipCanvas   = null;
let pipCtx      = null;
let pipVideo    = null;
let pipInterval = null;
let pipLastTime = null;
let pipActive   = false;

// Show PiP button only on supported browsers (iOS 14+ Safari)
if (document.pictureInPictureEnabled) {
  pipBtn.style.display = '';
}

pipBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (pipActive) {
    leavePiP();
  } else {
    await enterPiP();
  }
});

async function enterPiP() {
  // Set up canvas (400×225 = 16:9)
  if (!pipCanvas) {
    pipCanvas = document.createElement('canvas');
    pipCanvas.width  = 400;
    pipCanvas.height = 225;
    pipCtx = pipCanvas.getContext('2d');
  }

  // Render first frame before requesting PiP
  renderPiPCanvas();

  // Set up video driven by canvas stream
  if (!pipVideo) {
    pipVideo = document.createElement('video');
    pipVideo.muted    = true;
    pipVideo.autoplay = true;
    pipVideo.srcObject = pipCanvas.captureStream(30);
    document.body.appendChild(pipVideo); // must be in DOM for iOS
    pipVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';

    pipVideo.addEventListener('leavepictureinpicture', onLeavePiP);

    // Sync video play/pause → scroll state
    pipVideo.addEventListener('pause', () => {
      if (pipActive && state.scrolling) { state.scrolling = false; setPlayState(false); }
    });
    pipVideo.addEventListener('play', () => {
      if (pipActive && !state.scrolling) { state.scrolling = true; setPlayState(true); pipLastTime = null; }
    });
  }

  await pipVideo.play();

  // Wire MediaSession so PiP transport controls work
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',  () => {
      state.scrolling = true; setPlayState(true); pipLastTime = null; pipVideo.play();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      state.scrolling = false; setPlayState(false); pipVideo.pause();
    });
  }

  // Switch from rAF to setInterval so scroll advances in background
  stopScrollLoop();
  pipActive  = true;
  pipLastTime = null;
  pipInterval = setInterval(pipTick, 33); // ~30fps

  try {
    await pipVideo.requestPictureInPicture();
    pipBtn.textContent = '✕ PiP';
  } catch (err) {
    console.warn('PiP failed:', err);
    leavePiP();
  }
}

function pipTick() {
  const now = Date.now();
  if (state.scrolling) {
    if (pipLastTime !== null) {
      const delta = (now - pipLastTime) / 1000;
      state.offset += state.speed * delta;
      computeMaxOffset();
      if (state.offset >= state.maxOffset) {
        state.offset = state.maxOffset;
        applyOffset();
        updateProgress();
        setPlayState(false);
        if (pipVideo) pipVideo.pause();
      } else {
        applyOffset();
        updateProgress();
      }
    }
  }
  pipLastTime = now;
  renderPiPCanvas();
}

function onLeavePiP() {
  pipActive = false;
  pipBtn.textContent = '⧉ PiP';
  clearInterval(pipInterval);
  pipInterval = null;

  // Hand back to rAF loop
  if (state.scrolling) {
    state.lastTime = null;
    startScrollLoop();
  }

  // Clear MediaSession handlers
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',  null);
    navigator.mediaSession.setActionHandler('pause', null);
  }
}

function leavePiP() {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  } else {
    onLeavePiP();
  }
}

function wrapLines(ctx, text, maxWidth) {
  const result = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { result.push(''); continue; }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        result.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

function renderPiPCanvas() {
  if (!pipCtx) return;
  const W = pipCanvas.width;
  const H = pipCanvas.height;
  const ctx = pipCtx;

  // Background
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, W, H);

  // Guide line
  ctx.strokeStyle = 'rgba(79,142,247,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  // Arrows
  const arrowSize = Math.round(H * 0.13);
  ctx.fillStyle = '#4f8ef7';
  ctx.font      = `${arrowSize}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';
  ctx.fillText('▶', 6, H / 2);
  ctx.textAlign    = 'right';
  ctx.fillText('◀', W - 6, H / 2);

  // Scrolling text
  const fontSize   = Math.max(12, Math.round(state.fontSize * 0.45));
  const lineHeight = fontSize * 1.55;
  const textW      = W - 56; // leave room for arrows

  ctx.font         = `${fontSize}px ${state.fontFamily}`;
  ctx.fillStyle    = '#f5f5f7';
  ctx.textBaseline = 'top';
  ctx.textAlign    = 'center';

  const lines    = wrapLines(ctx, state.script || '', textW);
  const totalH   = lines.length * lineHeight;
  const progress = state.maxOffset > 0 ? state.offset / state.maxOffset : 0;
  // First line starts at guide-line (H/2), then scrolls upward
  const startY   = (H / 2) - progress * totalH;

  ctx.save();
  ctx.beginPath();
  ctx.rect(28, 0, W - 56, H);
  ctx.clip();
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    if (y + lineHeight < 0 || y > H) return;
    ctx.fillText(line, W / 2, y);
  });
  ctx.restore();

  // Play/pause indicator (bottom-right)
  ctx.fillStyle    = 'rgba(255,255,255,0.45)';
  ctx.font         = `${Math.round(H * 0.09)}px sans-serif`;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(state.scrolling ? '⏸' : '▶', W - 8, H - 6);
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
