'use strict';

// ─── Voice Follow ─────────────────────────────────────────────────────────────
// Listens to the microphone, transcribes speech, and works out which word of the
// script is being read so the prompter can keep it on the guide line.
//
// Engines:
//   • Vosk (offline, runs locally)   — used in the Electron desktop app
//   • Web Speech API (browser built-in) — used in the web/phone version
//
// Shared by renderer.js and docs/app.js. Keep docs/voice-follow.js identical.

const VoiceFollow = (() => {
  const VOSK_MODEL_URL = 'tpmodel://vosk-model-small-en-us-0.15.tar.gz';

  const TAIL_WORDS   = 6;   // recent spoken words used for matching
  const LOOK_BEHIND  = 15;  // script words before the cursor to consider
  const LOOK_AHEAD   = 80;  // script words after the cursor to consider

  // ── Script tokenizing ──────────────────────────────────────────────────────
  function normalize(word) {
    return word.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  }

  // Wrap each word of the prompter text in a span so we can locate it on screen.
  // Returns [{ el, token }] for every word that has speakable characters.
  function wrapWords(container) {
    const words = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(node => {
      const parts = node.nodeValue.split(/(\s+)/);
      if (parts.length === 1 && !parts[0].trim()) return;
      const frag = document.createDocumentFragment();
      parts.forEach(part => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
        const span = document.createElement('span');
        span.className = 'vf-word';
        span.textContent = part;
        frag.appendChild(span);
        const token = normalize(part);
        if (token) words.push({ el: span, token });
      });
      node.parentNode.replaceChild(frag, node);
    });
    return words;
  }

  // ── Fuzzy matching ─────────────────────────────────────────────────────────
  function editDistance(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 1 = same word, ~0.5–0.9 = close (misheard / archaic spelling), 0 = different
  function similarity(a, b) {
    if (a === b) return 1;
    const len = Math.max(a.length, b.length);
    if (len < 3) return 0;
    const sim = 1 - editDistance(a, b) / len;
    return sim >= 0.6 ? sim : 0;
  }

  // Best alignment score of the spoken tail ending exactly at script word `end`.
  // Small LCS-style DP so skipped or extra words don't break the match.
  function scoreAt(script, end, tail) {
    const winStart = Math.max(0, end - tail.length - 3);
    const win = script.slice(winStart, end + 1);
    const n = tail.length, m = win.length;
    let prev = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      const cur = [0];
      for (let j = 1; j <= m; j++) {
        const s = similarity(tail[i - 1], win[j - 1].token);
        cur[j] = Math.max(prev[j], cur[j - 1], s ? prev[j - 1] + s : 0);
      }
      prev = cur;
    }
    // The last spoken word must land on `end` itself for a confident position
    const lastSim = similarity(tail[n - 1], script[end].token);
    return lastSim ? prev[m] : 0;
  }

  class Tracker {
    constructor(words) {
      this.words = words;
      this.cursor = -1;      // index of the last confidently matched word
      this.history = [];     // finalized spoken tokens
    }

    // `finalText` is newly finalized speech, `partialText` the in-progress guess.
    // Returns the matched word index, or -1 if nothing confident.
    update(finalText, partialText) {
      if (finalText) this.history.push(...finalText.split(/\s+/).map(normalize).filter(Boolean));
      if (this.history.length > 50) this.history = this.history.slice(-50);
      const partial = (partialText || '').split(/\s+/).map(normalize).filter(Boolean);
      const tail = this.history.concat(partial).slice(-TAIL_WORDS);
      if (tail.length < 2 || !this.words.length) return -1;

      const from = Math.max(0, this.cursor - LOOK_BEHIND);
      const to   = Math.min(this.words.length - 1, this.cursor + LOOK_AHEAD);
      let best = -1, bestScore = 0;
      for (let i = from; i <= to; i++) {
        let score = scoreAt(this.words, i, tail);
        if (!score) continue;
        // Prefer staying close to where we are, and moving forward over backward
        const dist = i - this.cursor;
        score -= dist >= 0 ? dist * 0.004 : -dist * 0.03;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      const needed = Math.min(tail.length, 3) * 0.8;
      if (best < 0 || bestScore < needed) return -1;
      // Jumping backward (re-reading) or far ahead (skipping) needs strong evidence;
      // a few common words like "she … in" must not yank the text down the page
      const strong = Math.min(tail.length, 4) * 0.9;
      if (best < this.cursor && bestScore < strong) return -1;
      if (this.cursor >= 0 && best - this.cursor > 8 && bestScore < strong) return -1;
      this.cursor = best;
      return best;
    }

    reset(index = -1) { this.cursor = index; this.history = []; }
  }

  // ── Engines ────────────────────────────────────────────────────────────────
  // Each engine calls onText(finalText, partialText) and onStatus(message, isError).

  function webSpeechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function createWebSpeechEngine(onText, onStatus) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    let active = false;

    rec.onresult = (e) => {
      let finalText = '', partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += ' ' + t; else partial += ' ' + t;
      }
      onText(finalText.trim(), partial.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      onStatus('Speech recognition error: ' + e.error, true);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') active = false;
    };
    // Browsers end recognition sessions periodically; keep it running
    rec.onend = () => { if (active) { try { rec.start(); } catch (err) {} } };

    return {
      async start() { active = true; rec.start(); onStatus('Listening'); },
      stop() { active = false; try { rec.stop(); } catch (err) {} },
    };
  }

  let voskModelPromise = null;

  function createVoskEngine(onText, onStatus) {
    let ctx = null, stream = null, source = null, processor = null, recognizer = null;

    return {
      async start() {
        if (!voskModelPromise) {
          onStatus('Loading speech model (≈40 MB download the first time)…');
          // Built by hand (not Vosk.createModel) so download/load errors reject instead of hanging
          voskModelPromise = new Promise((resolve, reject) => {
            const model = new window.Vosk.Model(VOSK_MODEL_URL);
            model.on('load', (msg) => msg.result ? resolve(model) : reject(new Error('speech model failed to load')));
            model.on('error', (msg) => { model.terminate(); reject(new Error(msg.error || 'speech model download failed')); });
          });
          voskModelPromise.catch(() => { voskModelPromise = null; });
        }
        const model = await voskModelPromise;

        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        });
        ctx = new AudioContext();
        recognizer = new model.KaldiRecognizer(ctx.sampleRate);
        recognizer.on('result', (msg) => onText(msg.result.text || '', ''));
        recognizer.on('partialresult', (msg) => onText('', msg.result.partial || ''));

        source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          try { recognizer.acceptWaveform(e.inputBuffer); } catch (err) {}
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        onStatus('Listening');
      },
      stop() {
        try { processor && processor.disconnect(); } catch (e) {}
        try { source && source.disconnect(); } catch (e) {}
        try { recognizer && recognizer.remove(); } catch (e) {}
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (ctx) ctx.close();
        ctx = stream = source = processor = recognizer = null;
      },
    };
  }

  function createEngine(onText, onStatus) {
    if (window.Vosk && window.electronAPI) return createVoskEngine(onText, onStatus);
    if (webSpeechSupported()) return createWebSpeechEngine(onText, onStatus);
    return null;
  }

  function isSupported() {
    return !!(window.Vosk && window.electronAPI) || webSpeechSupported();
  }

  return { wrapWords, Tracker, createEngine, isSupported, normalize };
})();
