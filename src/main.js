import { createLangPicker, renderFlag } from './lang-picker.js';
import { CHAMELEON_LOGO_SVG } from './chameleon-logo.js';
import { apiFetch, clearAuthToken, getAuthToken, setAuthToken } from './auth.js';

const STORAGE_KEY = 'lingo-languages';
const DEFAULT_LANG1 = 'en';
const DEFAULT_LANG2 = 'zh';

let authRequired = false;

const state = {
  languages: [],
  lang1: DEFAULT_LANG1,
  lang2: DEFAULT_LANG2,
  messages: [],
  isProcessing: false,
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  mediaStream: null,
  currentAudio: null,
};

let picker1;
let picker2;

const $ = (sel) => document.querySelector(sel);

const conversationEl = $('#conversation');
const toastEl = $('#toast');
const mainMicBtn = $('#main-mic');
const liveTranscript = $('#live-transcript');

function findLang(code) {
  return state.languages.find((l) => l.code === code);
}

function langMeta(fromCode, toCode) {
  const from = findLang(fromCode);
  const to = findLang(toCode);
  if (!from || !to) return `${fromCode} → ${toCode}`;
  const tmp = document.createElement('span');
  tmp.innerHTML = `${renderFlag(from)} ${from.name} → ${renderFlag(to)} ${to.name}`;
  return tmp.innerHTML;
}

function prefetchAudio(msg) {
  if (msg._audioPromise) return msg._audioPromise;

  msg._audioPromise = apiFetch('/api/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: msg.translated, lang: msg.targetLanguage }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error('Audio failed');
      msg.audioUrl = URL.createObjectURL(await res.blob());
    })
    .catch(() => {});

  return msg._audioPromise;
}

async function init() {
  $('#logo-icon').innerHTML = CHAMELEON_LOGO_SVG;
  $('#auth-logo').innerHTML = CHAMELEON_LOGO_SVG;

  const ready = await checkHealth();
  if (!ready) return;

  const authed = await ensureAuthenticated();
  if (!authed) return;

  await loadLanguages();
  initPickers();
  bindEvents();
  checkMicSupport();
  updateMicState();
}

async function ensureAuthenticated() {
  if (!authRequired) return true;

  if (getAuthToken()) {
    const res = await apiFetch('/api/languages');
    if (res.ok) return true;
    clearAuthToken();
  }

  return showAuthGate();
}

function showAuthGate() {
  const gate = $('#auth-gate');
  const form = $('#auth-form');
  const input = $('#auth-input');
  const errorEl = $('#auth-error');
  const submitBtn = $('#auth-submit');

  gate.hidden = false;
  input.value = '';
  errorEl.hidden = true;

  return new Promise((resolve) => {
    const onUnauthorized = () => {
      gate.hidden = false;
      errorEl.textContent = 'Session expired — enter the code again';
      errorEl.hidden = false;
      resolve(false);
    };

    window.addEventListener('lingo:unauthorized', onUnauthorized, { once: true });

    form.onsubmit = async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      submitBtn.disabled = true;

      try {
        const password = input.value.trim();
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          errorEl.textContent = data.error || 'Wrong access code';
          errorEl.hidden = false;
          return;
        }

        setAuthToken(password);
        gate.hidden = true;
        window.removeEventListener('lingo:unauthorized', onUnauthorized);
        resolve(true);
      } catch {
        errorEl.textContent = 'Could not connect — try again';
        errorEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    };
  });
}

async function loadLanguages() {
  try {
    const res = await apiFetch('/api/languages');
    if (!res.ok) throw new Error('Failed to load languages');
    state.languages = await res.json();
  } catch {
    state.languages = [
      { code: 'en', name: 'English', flag: '🇺🇸', customFlag: null },
      { code: 'zh', name: 'Chinese', flag: '🇨🇳', customFlag: null },
    ];
  }
}

function initPickers() {
  const saved = loadSavedLanguages();
  if (saved?.lang1 && saved?.lang2 && saved.lang1 !== saved.lang2) {
    state.lang1 = saved.lang1;
    state.lang2 = saved.lang2;
  }

  picker1 = createLangPicker($('#lang-picker-1'), {
    languages: state.languages,
    value: state.lang1,
    placeholder: 'English',
    onChange: (code) => {
      state.lang1 = code;
      if (state.lang1 === state.lang2) {
        const other = state.languages.find((l) => l.code !== state.lang1);
        state.lang2 = other?.code || DEFAULT_LANG2;
        picker2.setValue(state.lang2);
      }
      saveLanguages();
      updateMicState();
    },
  });

  picker2 = createLangPicker($('#lang-picker-2'), {
    languages: state.languages,
    value: state.lang2,
    placeholder: 'Chinese',
    onChange: (code) => {
      state.lang2 = code;
      if (state.lang1 === state.lang2) {
        const other = state.languages.find((l) => l.code !== state.lang2);
        state.lang1 = other?.code || DEFAULT_LANG1;
        picker1.setValue(state.lang1);
      }
      saveLanguages();
      updateMicState();
    },
  });
}

function loadSavedLanguages() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveLanguages() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang1: state.lang1, lang2: state.lang2 }));
}

function languagesReady() {
  return state.lang1 && state.lang2 && state.lang1 !== state.lang2;
}

function updateMicState() {
  const ready = languagesReady();
  mainMicBtn.disabled = !ready && !state.isRecording && !state.isProcessing;
  mainMicBtn.setAttribute('aria-label', ready ? 'Tap to speak' : 'Select two languages');
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    authRequired = Boolean(data.authRequired);
    return true;
  } catch {
    showToast('Run: npm run dev');
    return false;
  }
}

function checkMicSupport() {
  if (!navigator.mediaDevices?.getUserMedia) {
    mainMicBtn.disabled = true;
    showToast('Microphone not supported');
  }
}

function getMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

async function toggleRecording() {
  if (!languagesReady()) {
    showToast('Select two languages');
    return;
  }
  if (state.isProcessing) return;

  if (state.isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];

    const mimeType = getMimeType();
    state.mediaRecorder = mimeType
      ? new MediaRecorder(state.mediaStream, { mimeType })
      : new MediaRecorder(state.mediaStream);

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    state.mediaRecorder.start(100);
    state.isRecording = true;
    mainMicBtn.classList.add('recording');
    liveTranscript.hidden = false;
    liveTranscript.textContent = '…';
  } catch (err) {
    showToast(err.name === 'NotAllowedError' ? 'Microphone permission denied' : 'Could not access microphone');
    cleanupStream();
  }
}

async function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;

  state.isRecording = false;
  state.isProcessing = true;
  mainMicBtn.classList.remove('recording');
  mainMicBtn.disabled = true;

  const mimeType = state.mediaRecorder.mimeType || 'audio/webm';

  await new Promise((resolve) => {
    state.mediaRecorder.onstop = resolve;
    state.mediaRecorder.stop();
  });

  cleanupStream();

  const blob = new Blob(state.audioChunks, { type: mimeType });
  state.audioChunks = [];

  if (blob.size < 1000) {
    showToast('Recording too short');
    resetMicUI();
    return;
  }

  try {
    const form = new FormData();
    form.append('audio', blob, `audio.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
    form.append('lang1', state.lang1);
    form.append('lang2', state.lang2);
    form.append('context', JSON.stringify(state.messages));

    const res = await apiFetch('/api/converse', { method: 'POST', body: form }).catch(() => {
      throw new Error('Cannot connect to server');
    });

    const data = await res.json();
    if (res.status === 429) throw new Error(data.error || 'Too many messages this hour');
    if (res.status === 401) throw new Error('Session expired — refresh and enter the code again');
    if (!res.ok) throw new Error(data.error || 'Processing failed');
    if (!data.translatedText?.trim()) throw new Error('Could not translate');

    const message = {
      id: Date.now(),
      original: data.sourceText || data.rawText,
      translated: data.translatedText,
      detectedLanguage: data.detectedLanguage,
      targetLanguage: data.targetLanguage,
      audioUrl: null,
    };

    state.messages.push(message);
    renderMessage(message);
    prefetchAudio(message);
  } catch (err) {
    showToast(err.message);
  } finally {
    resetMicUI();
  }
}

function cleanupStream() {
  state.mediaStream?.getTracks().forEach((t) => t.stop());
  state.mediaStream = null;
  state.mediaRecorder = null;
}

function resetMicUI() {
  state.isProcessing = false;
  liveTranscript.hidden = true;
  liveTranscript.textContent = '';
  updateMicState();
}

async function playTranslation(msg, btn) {
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio = null;
  }

  btn.classList.add('playing');
  btn.disabled = true;

  try {
    if (!msg.audioUrl) await prefetchAudio(msg);

    if (!msg.audioUrl) throw new Error('Could not load audio');

    const audio = new Audio(msg.audioUrl);
    state.currentAudio = audio;

    await new Promise((resolve, reject) => {
      audio.onended = () => {
        state.currentAudio = null;
        resolve();
      };
      audio.onerror = () => reject(new Error('Playback failed'));
      audio.play().catch(reject);
    });
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.classList.remove('playing');
    btn.disabled = false;
  }
}

function renderMessage(msg) {
  const el = document.createElement('div');
  el.className = 'message';

  el.innerHTML = `
    <div class="message-bubble">
      <div class="message-original">${escapeHtml(msg.original)}</div>
      <div class="message-translated">${escapeHtml(msg.translated)}</div>
    </div>
    <div class="message-meta">
      <span class="message-langs">${langMeta(msg.detectedLanguage, msg.targetLanguage)}</span>
      <div class="message-actions">
        <button type="button" class="icon-btn listen-btn" title="Listen">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
        </button>
        <button type="button" class="icon-btn copy-btn" title="Copy">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        </button>
      </div>
    </div>
  `;

  const listenBtn = el.querySelector('.listen-btn');
  listenBtn.addEventListener('click', () => playTranslation(msg, listenBtn));

  el.querySelector('.copy-btn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(msg.translated);
    showToast('Copied!');
  });

  conversationEl.appendChild(el);
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toastEl.hidden = true; }, 6000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function bindEvents() {
  mainMicBtn.addEventListener('click', toggleRecording);
  window.addEventListener('lingo:unauthorized', () => {
    if (authRequired) showAuthGate();
  });
}

init();
