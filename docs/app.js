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
const prompterSeek   = document.getElementById('prompter-seek');

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

// ─── Paste / Drop Handling ────────────────────────────────────────────────────
// Rich content (e.g. from Gutenberg.org) is rebuilt from a whitelist: text is
// inserted as text nodes, so <this>, {this} and [this] always survive literally,
// and <img> tags are kept with safe, absolute sources. Everything else is dropped.
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR',
  'BLOCKQUOTE', 'PRE', 'HR', 'FIGURE', 'FIGCAPTION', 'TABLE', 'UL', 'OL',
]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'SVG']);

function safeImageSrc(src, baseUrl) {
  if (!src) return null;
  try {
    const url = new URL(src, baseUrl || undefined);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    if (url.protocol === 'data:' && /^data:image\//i.test(src)) return src;
  } catch (e) {}
  return null;
}

function makeImage(src, alt) {
  const img = document.createElement('img');
  img.src = src;
  if (alt) img.alt = alt;
  return img;
}

function sanitizeHtml(html) {
  const srcMatch = html.match(/SourceURL:(\S+)/);
  // Windows CF_HTML clipboard data may carry a "Version:/SourceURL:" header before the markup
  if (/^Version:/.test(html)) html = html.slice(html.indexOf('<'));
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Chrome puts the page URL in a SourceURL comment / <base>; use it to resolve relative image paths
  const baseEl = doc.querySelector('base[href]');
  const baseUrl = (baseEl && baseEl.getAttribute('href')) || (srcMatch && srcMatch[1]) || null;

  const frag = document.createDocumentFragment();
  let needBreak = false;

  function addBreak() {
    if (frag.lastChild && frag.lastChild.nodeName !== 'BR') needBreak = true;
  }
  function flushBreak() {
    if (needBreak) { frag.appendChild(document.createElement('br')); needBreak = false; }
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue.replace(/[\r\n\t ]+/g, ' ');
      if (!text.trim() && (!frag.lastChild || frag.lastChild.nodeName === 'BR' || needBreak)) return;
      flushBreak();
      frag.appendChild(document.createTextNode(text));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    if (tag === 'IMG') {
      const src = safeImageSrc(node.getAttribute('src'), baseUrl);
      if (src) {
        flushBreak();
        frag.appendChild(makeImage(src, node.getAttribute('alt')));
        needBreak = false;
      }
      return;
    }
    if (tag === 'BR') { flushBreak(); frag.appendChild(document.createElement('br')); return; }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) addBreak();
    node.childNodes.forEach(walk);
    if (isBlock) addBreak();
  }

  walk(doc.body);
  return frag;
}

function insertNodeAtCursor(node) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !scriptInput.contains(sel.anchorNode)) {
    scriptInput.appendChild(node);
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const last = node.lastChild || node;
  range.insertNode(node);
  range.setStartAfter(last);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function insertFromTransfer(dt) {
  const imageFile = Array.from(dt.files || []).find(f => f.type.startsWith('image/')) ||
    (Array.from(dt.items || []).find(i => i.kind === 'file' && i.type.startsWith('image/')) || { getAsFile: () => null }).getAsFile();
  const html = dt.getData('text/html');

  if (html) {
    insertNodeAtCursor(sanitizeHtml(html));
  } else if (imageFile) {
    const reader = new FileReader();
    reader.onload = (ev) => insertNodeAtCursor(makeImage(ev.target.result));
    reader.readAsDataURL(imageFile);
  } else {
    // insertText treats the string literally, so bracketed text is preserved
    document.execCommand('insertText', false, dt.getData('text/plain'));
  }
}

scriptInput.addEventListener('paste', (e) => {
  e.preventDefault();
  insertFromTransfer(e.clipboardData);
});

scriptInput.addEventListener('drop', (e) => {
  e.preventDefault();
  scriptInput.focus();
  // Move the caret to the drop point before inserting
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
  }
  insertFromTransfer(e.dataTransfer);
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
  const isEmpty = scriptInput.textContent.trim() === '' && !scriptInput.querySelector('img');
  if (isEmpty) {
    scriptInput.focus();
    scriptInput.style.borderColor = '#ff5f57';
    setTimeout(() => { scriptInput.style.borderColor = ''; }, 1200);
    return;
  }
  state.script = scriptInput.innerHTML;

  prompterText.innerHTML = state.script;
  prompterText.querySelectorAll('img').forEach(img => {
    img.addEventListener('load', computeMaxOffset);
    img.addEventListener('error', computeMaxOffset);
  });
  prompterText.style.fontSize   = state.fontSize + 'px';
  prompterText.style.fontFamily = state.fontFamily;

  state.offset    = 0;
  state.scrolling = true;
  state.lastTime  = null;
  prompterSeek.value = 0;
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
  if (state.maxOffset > 0) {
    prompterSeek.value = Math.round((state.offset / state.maxOffset) * 1000);
  }
}

prompterSeek.addEventListener('input', (e) => {
  e.stopPropagation();
  state.offset = (parseInt(prompterSeek.value) / 1000) * state.maxOffset;
  state.lastTime = null;
  applyOffset();
  updateProgress();
});

function toggleScroll() {
  state.scrolling = !state.scrolling;
  setPlayState(state.scrolling);
  if (state.scrolling) {
    // Loop stops at the end of the script; restart it (from the top if finished)
    if (state.offset >= state.maxOffset) { state.offset = 0; applyOffset(); updateProgress(); }
    if (!state.rafId) startScrollLoop();
    requestWakeLock();
  }
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
