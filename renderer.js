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
  prompterText.querySelectorAll('img').forEach(img => {
    img.addEventListener('load', computeMaxOffset);
    img.addEventListener('error', computeMaxOffset);
  });
  if (voice.enabled) startVoiceFollow();
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
  stopVoiceFollow();
  setPlayState(false);
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
window.electronAPI.onToggleScroll(() => {
  if (prompterView.classList.contains('active')) toggleScroll();
});

// ─── Local keyboard fallback (when window is focused) ─────────────────────────
document.addEventListener('keydown', (e) => {
  if (listeningForKey) return;
  if (!prompterView.classList.contains('active')) return;
  if (e.key === state.rawKey) {
    e.preventDefault();
    toggleScroll();
  }
});


// ─── Voice Follow integration ─────────────────────────────────────────────────
const voiceToggle = document.getElementById('voice-toggle');
const voiceHint   = document.getElementById('voice-hint');
const voiceStatus = document.getElementById('voice-status');

const voice = {
  enabled: false,
  engine:  null,
  tracker: null,
  words:   [],
  index:   -1,   // currently matched word
};

if (!VoiceFollow.isSupported()) {
  voiceToggle.disabled = true;
  voiceHint.textContent = 'Speech recognition is not available in this browser.';
}
voiceToggle.addEventListener('change', () => { voice.enabled = voiceToggle.checked; });

function setVoiceStatus(msg, isError) {
  voiceStatus.textContent = msg ? '🎤 ' + msg : '';
  voiceStatus.classList.toggle('error', !!isError);
  voiceStatus.classList.toggle('visible', !!msg);
}

function startVoiceFollow() {
  voice.words   = VoiceFollow.wrapWords(prompterText);
  voice.tracker = new VoiceFollow.Tracker(voice.words);
  voice.index   = -1;
  voice.engine  = VoiceFollow.createEngine(onVoiceText, setVoiceStatus);
  if (!voice.engine) { setVoiceStatus('Speech recognition unavailable', true); return; }
  voice.engine.start().catch(err => {
    setVoiceStatus('Could not start: ' + (err && err.message || err), true);
    voice.engine = null;
  });
}

function stopVoiceFollow() {
  if (voice.engine) voice.engine.stop();
  voice.engine = null;
  setVoiceStatus('');
}

function onVoiceText(finalText, partialText) {
  if (!state.scrolling) return;
  const idx = voice.tracker.update(finalText, partialText);
  if (idx < 0 || idx === voice.index) return;
  if (voice.index >= 0) voice.words[voice.index].el.classList.remove('vf-current');
  voice.index = idx;
  voice.words[idx].el.classList.add('vf-current');
}

// Offset that puts the matched word on the guide line (middle of the screen)
function voiceTargetOffset() {
  const el = voice.words[voice.index].el;
  const top = el.getBoundingClientRect().top - prompterText.getBoundingClientRect().top;
  return Math.min(state.maxOffset, Math.max(0, top + el.offsetHeight / 2 - prompterScroller.clientHeight * 0.5));
}

// After a manual seek, resume matching from the word nearest the guide line
function syncVoiceToOffset() {
  if (!voice.engine || !voice.words.length) return;
  const textTop = prompterText.getBoundingClientRect().top;
  const guide = state.offset + prompterScroller.clientHeight * 0.5;
  let i = voice.words.findIndex(w => w.el.getBoundingClientRect().top - textTop >= guide);
  if (i < 0) i = voice.words.length - 1;
  if (voice.index >= 0) voice.words[voice.index].el.classList.remove('vf-current');
  voice.index = -1;
  voice.tracker.reset(i - 1);
}

// ─── Scroll Engine ────────────────────────────────────────────────────────────
function computeMaxOffset() {
  // Text starts below 50vh padding-top; max scroll brings the last line to the guide line
  state.maxOffset = Math.max(0, prompterText.scrollHeight - prompterScroller.clientHeight * 0.5);
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

  if (voice.engine) {
    computeMaxOffset();
    if (voice.index >= 0) {
      state.offset += (voiceTargetOffset() - state.offset) * Math.min(1, delta * 4);
    }
    applyOffset();
    updateProgress();
    state.rafId = requestAnimationFrame(tick);
    return;
  }

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
  syncVoiceToOffset();
});

function toggleScroll() {
  state.scrolling = !state.scrolling;
  setPlayState(state.scrolling);
  if (state.scrolling) {
    // Loop stops at the end of the script; restart it (from the top if finished)
    if (!voice.engine && state.offset >= state.maxOffset) { state.offset = 0; applyOffset(); updateProgress(); }
    if (!state.rafId) startScrollLoop();
  }
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
