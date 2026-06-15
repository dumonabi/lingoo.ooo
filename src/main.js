import { createLangPicker } from './lang-picker.js';
import { CHAMELEON_LOGO_SVG } from './chameleon-logo.js';
import { apiFetch, clearAuthToken, getAuthToken, setAuthToken } from './auth.js';
import {
  isRetryableSendError,
  listPendingRecordings,
  removePendingRecording,
  retryDelayMs,
  savePendingRecording,
  updatePendingRecording,
} from './pending-audio.js';

const STORAGE_KEY = 'lingo-languages';
const DEFAULT_LANG1 = 'en';
const DEFAULT_LANG2 = 'es';
const MAX_RECORDING_MS = 60_000;

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
  recordingStartedAt: 0,
};

let picker1;
let picker2;

const $ = (sel) => document.querySelector(sel);

const currentMessageEl = $('#current-message');
const historyZoneEl = $('#history-zone');
const historyListEl = $('#message-history');
const toastEl = $('#toast');
const mainMicBtn = $('#main-mic');
const liveTranscript = $('#live-transcript');
const micRingWrap = $('#mic-ring-wrap');
const micWaveformEl = $('#mic-waveform');
const progressRing = $('#progress-ring');
const progressRingFill = $('#progress-ring-fill');

const RING_CIRCUMFERENCE = 2 * Math.PI * 54;
const MIC_WAVE_VISIBLE = 14;
const MIC_WAVE_TOTAL = MIC_WAVE_VISIBLE + 1;
const MIC_WAVE_SHIFT_MS = 46;
const MIC_WAVE_BAR_STEP = 5;
const MIC_BAR_IDLE = 0.05;
const MIC_BAR_TRIGGER = 0.2;
const MIC_VOICE_GATE = 0.1;

let progressRaf = null;
let recordingProgressRaf = null;
let progressStartedAt = 0;
let progressEstimateMs = 4000;
let pendingQueueBusy = false;
let pendingRetryTimer = null;
let micMeter = null;
let micMeterCtx = null;
let micWaveSlots = [];
let micWaveBarEls = [];
let micWaveScrollEl = null;
let micWaveLastShift = 0;
let micWaveShiftBusy = false;
let selectedHistoryId = null;

const COPY_BTN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const LISTEN_BTN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';

function prefetchAudio(msg) {
  return loadMessageAudio(msg);
}

function audioCacheKey(msg) {
  return `${msg.translated}|${msg.targetLanguage}`;
}

function invalidateMessageAudio(msg) {
  if (msg.audioUrl) {
    URL.revokeObjectURL(msg.audioUrl);
    msg.audioUrl = null;
  }
  msg._audioPromise = null;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

async function loadMessageAudio(msg, { retry = false } = {}) {
  const key = audioCacheKey(msg);
  if (msg._audioKey && msg._audioKey !== key) {
    invalidateMessageAudio(msg);
  }
  msg._audioKey = key;

  if (msg.audioUrl) return;

  if (msg._audioPromise && !retry) {
    try {
      await withTimeout(msg._audioPromise, 25000, 'Audio timed out — tap Listen again');
    } catch {
      invalidateMessageAudio(msg);
    }
    if (msg.audioUrl) return;
  }

  msg._audioPromise = apiFetch('/api/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: msg.translated, lang: msg.targetLanguage }),
  }).then(async (res) => {
    let errMsg = 'Audio not ready — tap Listen again';
    if (!res.ok) {
      try {
        const data = await res.json();
        errMsg = data.error || errMsg;
      } catch {
        if (res.status === 429) errMsg = 'Too many audio requests — wait a moment';
      }
      throw new Error(errMsg);
    }
    msg.audioUrl = URL.createObjectURL(await res.blob());
  });

  try {
    await withTimeout(msg._audioPromise, 25000, 'Audio timed out — tap Listen again');
  } catch (err) {
    invalidateMessageAudio(msg);
    throw err;
  }
}

let playbackContext = null;

function getPlaybackContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!playbackContext) playbackContext = new Ctx();
  return playbackContext;
}

function attachPlaybackBoost(audio) {
  const ctx = getPlaybackContext();
  if (!ctx) return null;

  try {
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = 1.6;
    source.connect(gain);
    gain.connect(ctx.destination);
    return { ctx, source, gain };
  } catch {
    return null;
  }
}

function playAudioUrl(url) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.volume = 1;
    state.currentAudio = audio;
    const boost = attachPlaybackBoost(audio);
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        boost?.source?.disconnect();
        boost?.gain?.disconnect();
      } catch {
        // ignore disconnect errors
      }
      state.currentAudio = null;
      fn();
    };

    const timer = setTimeout(() => {
      audio.pause();
      finish(() => reject(new Error('Playback timed out — tap again')));
    }, 90000);

    audio.onended = () => finish(resolve);
    audio.onerror = () => finish(() => reject(new Error('Playback failed')));

    const start = async () => {
      try {
        if (boost?.ctx.state === 'suspended') {
          await boost.ctx.resume();
        }
        await audio.play();
      } catch (err) {
        finish(() => reject(err));
      }
    };

    void start();
  });
}

function resetListenBtn(btn) {
  btn.classList.remove('playing');
  btn.disabled = false;
  delete btn.dataset.busy;
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
  bindMicHelp();
  bindPendingQueue();
  checkMicSupport();
  updateMicState();
  void refreshPendingBanner();
  schedulePendingRetry(1500);
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
      { code: 'en', name: 'English', flagCode: 'us' },
      { code: 'es', name: 'Spanish', flagCode: 'es' },
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
      onLanguagesChanged();
    },
  });

  picker2 = createLangPicker($('#lang-picker-2'), {
    languages: state.languages,
    value: state.lang2,
    placeholder: 'Spanish',
    onChange: (code) => {
      state.lang2 = code;
      if (state.lang1 === state.lang2) {
        const other = state.languages.find((l) => l.code !== state.lang2);
        state.lang1 = other?.code || DEFAULT_LANG1;
        picker1.setValue(state.lang1);
      }
      onLanguagesChanged();
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

function clearConversation() {
  state.messages = [];
  selectedHistoryId = null;
  currentMessageEl.innerHTML = '<p class="message-empty">Your last translation will appear here</p>';
  historyListEl.innerHTML = '';
  historyZoneEl.hidden = true;
}

function refreshHistorySelection() {
  historyListEl.querySelectorAll('.message-card-history').forEach((card) => {
    card.classList.toggle('message-selected', Number(card.dataset.messageId) === selectedHistoryId);
  });
}

function onHistoryListClick(e) {
  const card = e.target.closest('.message-card-history');
  if (!card || e.target.closest('.icon-btn')) return;

  const id = Number(card.dataset.messageId);
  selectedHistoryId = selectedHistoryId === id ? null : id;
  refreshHistorySelection();
}

function onLanguagesChanged() {
  clearConversation();
  saveLanguages();
  updateMicState();
}

function detectBrowser() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Edg|OPR|FxiOS/i.test(ua);
  const isChrome = /Chrome|CriOS/i.test(ua) && !/Edg/i.test(ua);

  if (isIOS && isSafari) return 'ios-safari';
  if (isIOS && isChrome) return 'ios-chrome';
  if (isIOS) return 'ios-other';
  if (isAndroid && isChrome) return 'android-chrome';
  if (isAndroid) return 'android-other';
  if (isSafari) return 'desktop-safari';
  if (isChrome) return 'desktop-chrome';
  return 'generic';
}

function genericMicSteps() {
  return [
    'Connect or enable a microphone on your device',
    'Allow microphone access when your browser asks',
    'If you already denied it: open this site\'s settings (lock or “aA” icon in the address bar) and set Microphone to Allow',
    'Reload the page, then tap Try again',
  ];
}

function getMicHelp(err) {
  const browser = detectBrowser();
  const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
  const notFound = err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError';

  if (denied) {
    if (browser === 'ios-safari') {
      return {
        title: 'Allow microphone in Safari',
        intro: 'Safari needs permission to use your microphone.',
        steps: [
          'Open iPhone Settings → Safari → Microphone → Allow',
          'Or Settings → Privacy & Security → Microphone → turn ON for Safari',
          'Come back here, tap Try again, and tap Allow when asked',
        ],
      };
    }
    if (browser === 'ios-chrome') {
      return {
        title: 'Allow microphone in Chrome',
        intro: 'Chrome needs permission to use your microphone.',
        steps: [
          'Open iPhone Settings → Chrome → Microphone → ON',
          'Come back here, tap Try again, and tap Allow when asked',
        ],
      };
    }
    if (browser === 'ios-other') {
      return {
        title: 'Allow microphone',
        intro: 'Your browser needs permission to use the microphone.',
        steps: [
          'Open iPhone Settings → Privacy & Security → Microphone',
          'Turn ON access for the browser you are using',
          'Come back here, tap Try again, and tap Allow when asked',
        ],
      };
    }
    if (browser === 'android-chrome') {
      return {
        title: 'Allow microphone',
        intro: 'Allow microphone access for this site.',
        steps: [
          'Tap the lock icon next to the website address',
          'Tap Permissions → Microphone → Allow',
          'Tap Try again below',
        ],
      };
    }
    if (browser === 'desktop-safari') {
      return {
        title: 'Allow microphone in Safari',
        intro: 'Safari needs permission to use your microphone.',
        steps: [
          'Safari menu → Settings → Websites → Microphone',
          'Set this site to Allow',
          'Reload the page, then tap Try again',
        ],
      };
    }
    if (browser === 'desktop-chrome') {
      return {
        title: 'Allow microphone',
        intro: 'Chrome needs permission to use your microphone.',
        steps: [
          'Click the lock icon in the address bar',
          'Set Microphone to Allow',
          'Reload the page, then tap Try again',
        ],
      };
    }
    return {
      title: 'Allow microphone',
      intro: 'Your browser needs permission to use the microphone.',
      steps: genericMicSteps(),
    };
  }

  if (notFound) {
    return {
      title: 'Microphone not found',
      intro: 'No microphone was detected, or access is still blocked.',
      steps: genericMicSteps(),
    };
  }

  return {
    title: 'Could not access microphone',
    intro: 'Something stopped the microphone from starting.',
    steps: genericMicSteps(),
  };
}

function showMicHelp(err) {
  const help = getMicHelp(err);
  $('#mic-help-title').textContent = help.title;
  $('#mic-help-intro').textContent = help.intro;
  $('#mic-help-steps').innerHTML = help.steps.map((step) => `<li>${step}</li>`).join('');
  $('#mic-help').hidden = false;
}

function hideMicHelp() {
  $('#mic-help').hidden = true;
}

function bindMicHelp() {
  $('#mic-help-close').addEventListener('click', hideMicHelp);
  $('#mic-help-retry').addEventListener('click', async () => {
    hideMicHelp();
    releaseMic();
    try {
      await ensureMicStream();
    } catch (err) {
      showMicHelp(err);
    }
  });
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

async function ensureMicStream() {
  if (state.mediaStream?.active) return state.mediaStream;

  state.mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  return state.mediaStream;
}

function getMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function estimateProcessingMs(recordingMs, blobBytes) {
  const MIN_MS = 3000;
  const MAX_MS = 6500;

  const audioSeconds = Math.max(recordingMs / 1000, blobBytes / 11000, 0.5);

  // Real waits cluster around 3–6s; longer clips add a little, not linearly
  const t = Math.min(audioSeconds / 10, 1);
  return Math.round(MIN_MS + t * (MAX_MS - MIN_MS));
}

function simulatedProgress(elapsedMs) {
  const target = progressEstimateMs;
  const ratio = elapsedMs / target;

  if (ratio <= 1) return ratio * 97;

  // Past estimate: creep slowly so the bar never looks frozen
  const overtime = elapsedMs - target;
  return Math.min(97 + (overtime / (target * 0.6)) * 2, 99);
}

const PROCESSING_COLOR_STOPS = [
  { at: 0, r: 248, g: 113, b: 113 },
  { at: 0.28, r: 251, g: 146, b: 60 },
  { at: 0.55, r: 251, g: 191, b: 36 },
  { at: 0.78, r: 163, g: 230, b: 53 },
  { at: 1, r: 74, g: 222, b: 128 },
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function processingRgb(pct) {
  const t = Math.max(0, Math.min(1, pct / 100));
  let start = PROCESSING_COLOR_STOPS[0];
  let end = PROCESSING_COLOR_STOPS[PROCESSING_COLOR_STOPS.length - 1];

  for (let i = 0; i < PROCESSING_COLOR_STOPS.length - 1; i++) {
    if (t >= PROCESSING_COLOR_STOPS[i].at && t <= PROCESSING_COLOR_STOPS[i + 1].at) {
      start = PROCESSING_COLOR_STOPS[i];
      end = PROCESSING_COLOR_STOPS[i + 1];
      const span = end.at - start.at || 1;
      const local = (t - start.at) / span;
      return {
        r: Math.round(lerp(start.r, end.r, local)),
        g: Math.round(lerp(start.g, end.g, local)),
        b: Math.round(lerp(start.b, end.b, local)),
      };
    }
  }

  return { r: end.r, g: end.g, b: end.b };
}

function rgbCss({ r, g, b }, alpha = 1) {
  return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyProcessingVisuals(pct) {
  const rgb = processingRgb(pct);
  const dark = {
    r: Math.round(rgb.r * 0.58),
    g: Math.round(rgb.g * 0.58),
    b: Math.round(rgb.b * 0.58),
  };

  progressRingFill.style.stroke = rgbCss(rgb);
  if (!mainMicBtn.classList.contains('processing')) return;

  mainMicBtn.style.background = `linear-gradient(145deg, ${rgbCss(rgb)}, ${rgbCss(dark)})`;
  mainMicBtn.style.boxShadow = `inset 0 0 0 2px ${rgbCss(rgb, 0.42)}, 0 4px 28px ${rgbCss(rgb, 0.28)}`;
}

function clearProcessingVisuals() {
  progressRingFill.style.removeProperty('stroke');
  mainMicBtn.style.removeProperty('background');
  mainMicBtn.style.removeProperty('box-shadow');
}

function updateProgressRing(pct) {
  const value = Math.round(pct);
  const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
  progressRingFill.style.strokeDashoffset = String(offset);
  progressRing.setAttribute('aria-valuenow', String(value));

  if (micRingWrap.classList.contains('is-active')) {
    applyProcessingVisuals(pct);
  } else if (micRingWrap.classList.contains('is-recording')) {
    progressRingFill.style.stroke = '#f87171';
  }
}

function getMicMeterContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!micMeterCtx || micMeterCtx.state === 'closed') {
    micMeterCtx = new Ctx();
  }
  return micMeterCtx;
}

function primeMicAudioOnGesture() {
  const ctx = getMicMeterContext();
  if (!ctx || ctx.state !== 'suspended') return;
  void ctx.resume();
}

async function prepareMicMeter(stream) {
  teardownMicMeter();

  const ctx = getMicMeterContext();
  if (!ctx || !stream?.active) return;

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.12;
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;

  source.connect(analyser);
  analyser.connect(silentGain);
  silentGain.connect(ctx.destination);

  micMeter = {
    source,
    analyser,
    silentGain,
    timeData: new Uint8Array(analyser.fftSize),
    freqData: new Uint8Array(analyser.frequencyBinCount),
    smooth: 0,
  };

  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      // ignore resume errors
    }
  }

  for (let i = 0; i < 4; i++) {
    micMeter.analyser.getByteTimeDomainData(micMeter.timeData);
    micMeter.analyser.getByteFrequencyData(micMeter.freqData);
  }
}

function readMicLevel() {
  if (!micMeter) return 0;

  micMeter.analyser.getByteTimeDomainData(micMeter.timeData);
  micMeter.analyser.getByteFrequencyData(micMeter.freqData);

  let sum = 0;
  for (let i = 0; i < micMeter.timeData.length; i++) {
    const sample = (micMeter.timeData[i] - 128) / 128;
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / micMeter.timeData.length);

  let peak = 0;
  for (let i = 0; i < micMeter.freqData.length; i++) {
    if (micMeter.freqData[i] > peak) peak = micMeter.freqData[i];
  }
  const freqLevel = peak / 255;

  const raw = Math.min(1, Math.max(rms * 4.8, freqLevel * 1.45));
  const ease = raw > micMeter.smooth ? 0.88 : 0.22;
  micMeter.smooth += (raw - micMeter.smooth) * ease;
  return micMeter.smooth;
}

function ensureMicWaveform() {
  if (!micWaveformEl || micWaveBarEls.length) return;

  micWaveScrollEl = document.createElement('span');
  micWaveScrollEl.className = 'mic-wave-scroll';
  micWaveformEl.appendChild(micWaveScrollEl);

  micWaveSlots = Array(MIC_WAVE_TOTAL).fill(MIC_BAR_IDLE);
  for (let i = 0; i < MIC_WAVE_TOTAL; i++) {
    const bar = document.createElement('span');
    bar.className = 'mic-wave-bar';
    bar.style.setProperty('--bar-scale', String(MIC_BAR_IDLE));
    micWaveScrollEl.appendChild(bar);
    micWaveBarEls.push(bar);
  }
}

function isMicSilent(level) {
  if (!micMeter) return true;

  micMeter.analyser.getByteTimeDomainData(micMeter.timeData);
  let sum = 0;
  for (let i = 0; i < micMeter.timeData.length; i++) {
    const sample = (micMeter.timeData[i] - 128) / 128;
    sum += sample * sample;
  }
  const instant = Math.sqrt(sum / micMeter.timeData.length);
  return level < MIC_VOICE_GATE && instant < 0.03;
}

function computeWaveSample(level, silent) {
  if (silent || !micMeter) return MIC_BAR_IDLE;

  micMeter.analyser.getByteFrequencyData(micMeter.freqData);
  const voiceBins = Math.max(8, Math.floor(micMeter.freqData.length * 0.45));
  let peak = 0;
  for (let b = 2; b < 2 + voiceBins; b++) {
    peak = Math.max(peak, micMeter.freqData[b] / 255);
  }

  const gated = Math.max(0, peak - MIC_BAR_TRIGGER) / (1 - MIC_BAR_TRIGGER);
  if (gated < 0.04) return MIC_BAR_IDLE;

  const boosted = Math.min(1, gated * (1.15 + level * 0.85));
  const shaped = Math.pow(boosted, 1.45);
  return MIC_BAR_IDLE + shaped * (1 - MIC_BAR_IDLE);
}

function finishMicWaveShift() {
  if (!micWaveScrollEl || !micWaveBarEls.length) return;

  const first = micWaveBarEls.shift();
  first.style.setProperty('--bar-scale', String(MIC_BAR_IDLE));
  micWaveScrollEl.appendChild(first);
  micWaveBarEls.push(first);

  micWaveScrollEl.style.transition = 'none';
  micWaveScrollEl.style.transform = 'translateX(0)';
  micWaveShiftBusy = false;
}

function shiftMicWaveform(sample) {
  if (!micWaveScrollEl || !micWaveBarEls.length || micWaveShiftBusy) return;

  micWaveShiftBusy = true;
  micWaveSlots.shift();
  micWaveSlots.push(sample);

  const incoming = micWaveBarEls[micWaveBarEls.length - 1];
  incoming.style.setProperty('--bar-scale', sample.toFixed(3));

  micWaveScrollEl.style.transition = `transform ${MIC_WAVE_SHIFT_MS}ms linear`;
  micWaveScrollEl.style.transform = `translateX(-${MIC_WAVE_BAR_STEP}px)`;

  window.setTimeout(finishMicWaveShift, MIC_WAVE_SHIFT_MS);
}

function applyMicVoicePulse() {
  const level = readMicLevel();
  mainMicBtn.style.setProperty('--mic-voice-scale', (1 + level * 0.18).toFixed(3));
  mainMicBtn.style.setProperty('--mic-voice-glow', level.toFixed(3));

  ensureMicWaveform();
  if (!micMeter) return;

  const now = performance.now();
  if (now - micWaveLastShift < MIC_WAVE_SHIFT_MS || micWaveShiftBusy) return;
  micWaveLastShift = now;

  const sample = computeWaveSample(level, isMicSilent(level));
  shiftMicWaveform(sample);
}

function clearMicVoicePulse() {
  mainMicBtn.style.removeProperty('--mic-voice-scale');
  mainMicBtn.style.removeProperty('--mic-voice-glow');

  micWaveLastShift = 0;
  micWaveShiftBusy = false;
  if (!micWaveBarEls.length) return;
  micWaveSlots = Array(micWaveBarEls.length).fill(MIC_BAR_IDLE);
  micWaveBarEls.forEach((bar) => {
    bar.style.setProperty('--bar-scale', String(MIC_BAR_IDLE));
  });
  if (micWaveScrollEl) {
    micWaveScrollEl.style.transition = 'none';
    micWaveScrollEl.style.transform = 'translateX(0)';
  }
}

function teardownMicMeter() {
  try {
    micMeter?.source?.disconnect();
    micMeter?.analyser?.disconnect();
    micMeter?.silentGain?.disconnect();
  } catch {
    // ignore disconnect errors
  }
  micMeter = null;
  clearMicVoicePulse();
}

function cancelRecordingProgressRaf() {
  if (recordingProgressRaf) cancelAnimationFrame(recordingProgressRaf);
  recordingProgressRaf = null;
}

function stopRecordingProgress() {
  cancelRecordingProgressRaf();
  micRingWrap.classList.remove('is-recording');
  teardownMicMeter();
}

async function startRecordingProgress() {
  cancelRecordingProgressRaf();
  stopProgress();
  micRingWrap.classList.add('is-recording');
  progressRing.setAttribute('aria-label', 'Recording progress');
  updateProgressRing(0);

  const tick = () => {
    if (!state.isRecording) return;

    applyMicVoicePulse();

    const elapsed = Date.now() - state.recordingStartedAt;
    updateProgressRing(Math.min((elapsed / MAX_RECORDING_MS) * 100, 100));

    if (elapsed >= MAX_RECORDING_MS) {
      stopRecordingProgress();
      showToast('1 minute limit — processing…');
      void stopRecording();
      return;
    }

    recordingProgressRaf = requestAnimationFrame(tick);
  };

  recordingProgressRaf = requestAnimationFrame(tick);
}

function startProgress(estimatedMs) {
  stopRecordingProgress();
  stopProgress();
  progressEstimateMs = estimatedMs;
  progressStartedAt = performance.now();
  micRingWrap.classList.add('is-active');
  progressRing.setAttribute('aria-label', 'Translation progress');
  updateProgressRing(0);
  applyProcessingVisuals(0);

  const tick = (now) => {
    const elapsed = now - progressStartedAt;
    updateProgressRing(simulatedProgress(elapsed));
    progressRaf = requestAnimationFrame(tick);
  };

  progressRaf = requestAnimationFrame(tick);
}

function finishProgress() {
  return new Promise((resolve) => {
    stopProgress();
    micRingWrap.classList.remove('is-active');
    updateProgressRing(100);
    setTimeout(() => {
      updateProgressRing(0);
      resolve();
    }, 220);
  });
}

function stopProgress() {
  if (progressRaf) cancelAnimationFrame(progressRaf);
  progressRaf = null;
  micRingWrap.classList.remove('is-active');
  micRingWrap.classList.remove('is-recording');
  clearProcessingVisuals();
}

function buildConversationContext() {
  return state.messages
    .filter((m) => [state.lang1, state.lang2].includes(m.detectedLanguage))
    .slice(-2)
    .map((m) => ({
      detectedLanguage: m.detectedLanguage,
      original: m.original,
      translated: m.translated,
    }));
}

function applyTranslationResult(data) {
  const message = {
    id: Date.now(),
    original: data.sourceText || data.rawText,
    translated: data.translatedText,
    detectedLanguage: data.detectedLanguage,
    targetLanguage: data.targetLanguage,
    audioUrl: null,
  };

  state.messages.push(message);
  renderConversation();
  prefetchAudio(message).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchConverse(form, { attempts = 3 } = {}) {
  let lastError;
  let lastRes;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await withTimeout(
        apiFetch('/api/converse', { method: 'POST', body: form }),
        90000,
        'Request timed out — message saved',
      );
      lastRes = res;

      if ((res.status === 502 || res.status === 503 || res.status === 504 || res.status === 408)
        && attempt < attempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
    }
  }

  if (lastRes) return lastRes;

  const error = new Error(lastError?.message || 'Cannot connect to server');
  error.retryable = true;
  throw error;
}

async function submitRecording({ blob, mimeType, recordingMs, lang1, lang2, context, pendingId }) {
  const id = pendingId || crypto.randomUUID();

  if (!pendingId) {
    await savePendingRecording({
      id,
      blob,
      mimeType,
      lang1,
      lang2,
      contextJson: JSON.stringify(context),
      recordingMs,
      createdAt: Date.now(),
    });
  }

  const form = new FormData();
  form.append('audio', blob, `audio.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
  form.append('lang1', lang1);
  form.append('lang2', lang2);
  form.append('durationMs', String(recordingMs));
  form.append('context', JSON.stringify(context));

  let res;
  try {
    res = await fetchConverse(form, { attempts: pendingId ? 2 : 3 });
  } catch (err) {
    const current = (await listPendingRecordings()).find((item) => item.id === id);
    await updatePendingRecording(id, {
      attempts: (current?.attempts || 0) + 1,
      lastError: err.message,
    });
    throw err;
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (res.status === 401) {
    const error = new Error('Session expired — enter the access code again');
    error.retryable = true;
    throw error;
  }
  if (res.status === 429) {
    const error = new Error(data.error || 'Too many messages this hour');
    error.retryable = true;
    throw error;
  }
  if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 408) {
    const error = new Error('Connection interrupted — message saved for retry');
    error.retryable = true;
    await updatePendingRecording(id, {
      attempts: (((await listPendingRecordings()).find((item) => item.id === id)?.attempts) || 0) + 1,
      lastError: error.message,
    });
    throw error;
  }
  if (!res.ok) {
    const error = new Error(data.error || 'Processing failed');
    error.retryable = isRetryableSendError(error, res);
    if (error.retryable) {
      await updatePendingRecording(id, { lastError: error.message });
    }
    throw error;
  }
  if (!data.translatedText?.trim()) {
    const error = new Error('Could not translate — message saved for retry');
    error.retryable = true;
    await updatePendingRecording(id, { lastError: error.message });
    throw error;
  }

  await removePendingRecording(id);
  return data;
}

async function refreshPendingBanner() {
  const items = await listPendingRecordings();
  const banner = $('#pending-banner');
  if (!items.length) {
    banner.hidden = true;
    return;
  }

  $('#pending-text').textContent = items.length === 1
    ? '1 message saved on this device. We will retry automatically when the connection is back.'
    : `${items.length} messages saved on this device. We will retry automatically when the connection is back.`;
  banner.hidden = false;
}

function schedulePendingRetry(delayMs = 5000) {
  clearTimeout(pendingRetryTimer);
  pendingRetryTimer = setTimeout(() => {
    void processPendingQueue();
  }, delayMs);
}

function wakePendingQueue() {
  void refreshPendingBanner();
  schedulePendingRetry(400);
}

async function processPendingQueue() {
  if (pendingQueueBusy || state.isProcessing || state.isRecording) return;
  if (!navigator.onLine) {
    await refreshPendingBanner();
    return;
  }

  const items = await listPendingRecordings();
  if (!items.length) {
    await refreshPendingBanner();
    return;
  }

  pendingQueueBusy = true;
  const sorted = items.sort((a, b) => a.createdAt - b.createdAt);

  for (const item of sorted) {
    if (state.isRecording) break;

    try {
      state.isProcessing = true;
      mainMicBtn.classList.add('processing');
      mainMicBtn.setAttribute('aria-label', 'Translating…');
      mainMicBtn.disabled = true;
      startProgress(estimateProcessingMs(item.recordingMs, item.blob?.size || 0));

      const context = JSON.parse(item.contextJson || '[]');
      const data = await submitRecording({
        blob: item.blob,
        mimeType: item.mimeType,
        recordingMs: item.recordingMs,
        lang1: item.lang1,
        lang2: item.lang2,
        context,
        pendingId: item.id,
      });

      applyTranslationResult(data);
      await finishProgress();
    } catch (err) {
      if (err.retryable !== false) {
        if (err.message?.includes('Session expired') && authRequired) {
          showAuthGate();
        }
        await updatePendingRecording(item.id, {
          attempts: (item.attempts || 0) + 1,
          lastError: err.message || 'Retry later',
        });
        showToast(err.message || 'Message saved — will retry');
        schedulePendingRetry(retryDelayMs((item.attempts || 0) + 1));
        break;
      }
      await removePendingRecording(item.id);
      showToast(err.message);
    } finally {
      state.isProcessing = false;
      resetMicUI();
    }
  }

  pendingQueueBusy = false;
  await refreshPendingBanner();
}

function bindPendingQueue() {
  $('#pending-retry').addEventListener('click', () => {
    void processPendingQueue();
  });
  $('#pending-dismiss').addEventListener('click', () => {
    $('#pending-banner').hidden = true;
  });
  window.addEventListener('online', wakePendingQueue);
  window.addEventListener('focus', wakePendingQueue);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wakePendingQueue();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) wakePendingQueue();
  });
}

async function sendRecordingForTranslation({ blob, mimeType, recordingMs }) {
  const data = await submitRecording({
    blob,
    mimeType,
    recordingMs,
    lang1: state.lang1,
    lang2: state.lang2,
    context: buildConversationContext(),
  });
  applyTranslationResult(data);
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
    primeMicAudioOnGesture();
    await startRecording();
  }
}

async function startRecording() {
  try {
    await ensureMicStream();
    await prepareMicMeter(state.mediaStream);
    clearMicVoicePulse();
    state.audioChunks = [];

    const mimeType = getMimeType();
    state.mediaRecorder = mimeType
      ? new MediaRecorder(state.mediaStream, { mimeType })
      : new MediaRecorder(state.mediaStream);

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    // Timeslice helps mobile browsers flush audio chunks reliably
    state.mediaRecorder.start(250);
    state.recordingStartedAt = Date.now();
    state.isRecording = true;
    mainMicBtn.classList.add('recording');
    liveTranscript.hidden = true;
    startRecordingProgress();
  } catch (err) {
    showMicHelp(err);
    releaseMic();
  }
}

async function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;

  state.isRecording = false;
  state.isProcessing = true;
  mainMicBtn.classList.remove('recording');
  mainMicBtn.classList.add('processing');
  mainMicBtn.setAttribute('aria-label', 'Translating…');
  mainMicBtn.disabled = true;
  liveTranscript.hidden = true;
  stopRecordingProgress();

  const mimeType = state.mediaRecorder.mimeType || 'audio/webm';

  await new Promise((resolve) => {
    state.mediaRecorder.onstop = () => {
      // Let the final ondataavailable fire (common mobile quirk)
      setTimeout(resolve, 120);
    };
    if (state.mediaRecorder.state === 'recording' && typeof state.mediaRecorder.requestData === 'function') {
      state.mediaRecorder.requestData();
    }
    state.mediaRecorder.stop();
  });

  cleanupRecorder();

  const blob = new Blob(state.audioChunks, { type: mimeType });
  state.audioChunks = [];

  const recordingMs = state.recordingStartedAt ? Date.now() - state.recordingStartedAt : 0;

  if (recordingMs < 450 && blob.size < 800) {
    showToast('Recording too short');
    resetMicUI();
    return;
  }

  if (blob.size < 400) {
    showToast('Could not capture audio — tap and speak again');
    resetMicUI();
    return;
  }

  if (recordingMs > MAX_RECORDING_MS) {
    showToast('Recording too long — 1 minute max');
    resetMicUI();
    return;
  }

  startProgress(estimateProcessingMs(recordingMs, blob.size));

  try {
    await sendRecordingForTranslation({ blob, mimeType, recordingMs });
    await finishProgress();
    await refreshPendingBanner();
  } catch (err) {
    if (err.retryable !== false) {
      await refreshPendingBanner();
      showToast(err.message || 'Message saved — will retry automatically');
      schedulePendingRetry(3000);
    } else {
      showToast(err.message);
    }
  } finally {
    resetMicUI();
  }
}

function cleanupRecorder() {
  state.mediaRecorder = null;
}

function releaseMic() {
  state.mediaStream?.getTracks().forEach((t) => t.stop());
  state.mediaStream = null;
  state.mediaRecorder = null;
}

function resetMicUI() {
  stopProgress();
  stopRecordingProgress();
  releaseMic();
  state.isProcessing = false;
  mainMicBtn.classList.remove('processing');
  clearProcessingVisuals();
  liveTranscript.hidden = true;
  liveTranscript.textContent = '';
  updateProgressRing(0);
  updateMicState();
}

async function playTranslation(msg, btn) {
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';

  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio = null;
  }

  btn.classList.add('playing');
  btn.disabled = true;

  try {
    if (!msg.audioUrl) {
      try {
        await loadMessageAudio(msg);
      } catch {
        await loadMessageAudio(msg, { retry: true });
      }
    }

    if (!msg.audioUrl) throw new Error('Audio not ready — tap Listen again');

    await playAudioUrl(msg.audioUrl);
  } catch (err) {
    invalidateMessageAudio(msg);
    showToast(err.message);
  } finally {
    resetListenBtn(btn);
  }
}

function createMessageCard(msg, { prominent = false } = {}) {
  const el = document.createElement('article');
  el.className = prominent ? 'message-card message-card-current' : 'message-card message-card-history';
  el.dataset.messageId = String(msg.id);

  if (prominent) {
    el.innerHTML = `
      <div class="message-bubble">
        <div class="message-original">${escapeHtml(msg.original)}</div>
        <div class="message-translated">
          <span class="message-translated-text">${escapeHtml(msg.translated)}</span>
          <button type="button" class="icon-btn copy-btn copy-btn-inline" title="Copy" aria-label="Copy">
            ${COPY_BTN_SVG}
          </button>
        </div>
      </div>
      <div class="message-meta">
        <div class="message-actions-listen">
          <button type="button" class="icon-btn listen-btn" title="Listen" aria-label="Listen">
            ${LISTEN_BTN_SVG}
          </button>
        </div>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="message-bubble">
        <div class="message-original">${escapeHtml(msg.original)}</div>
        <div class="message-translated">
          <span class="message-translated-text">${escapeHtml(msg.translated)}</span>
          <div class="message-inline-actions">
            <button type="button" class="icon-btn listen-btn listen-btn-inline" title="Listen" aria-label="Listen">
              ${LISTEN_BTN_SVG}
            </button>
            <button type="button" class="icon-btn copy-btn copy-btn-inline" title="Copy" aria-label="Copy">
              ${COPY_BTN_SVG}
            </button>
          </div>
        </div>
      </div>
    `;
    el.tabIndex = 0;
    el.addEventListener('focus', () => {
      selectedHistoryId = msg.id;
      refreshHistorySelection();
    });
  }

  const listenBtn = el.querySelector('.listen-btn');
  listenBtn.addEventListener('click', () => playTranslation(msg, listenBtn));

  el.querySelector('.copy-btn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(msg.translated);
    showToast('Copied!');
  });

  return el;
}

function renderConversation() {
  currentMessageEl.innerHTML = '';
  historyListEl.innerHTML = '';

  if (!state.messages.length) {
    currentMessageEl.innerHTML = '<p class="message-empty">Your last translation will appear here</p>';
    historyZoneEl.hidden = true;
    return;
  }

  const latest = state.messages[state.messages.length - 1];
  const history = state.messages.slice(0, -1);

  currentMessageEl.appendChild(createMessageCard(latest, { prominent: true }));

  if (history.length) {
    const historyIds = new Set(history.map((item) => item.id));
    if (!historyIds.has(selectedHistoryId)) selectedHistoryId = null;

    history.forEach((msg) => {
      historyListEl.appendChild(createMessageCard(msg));
    });
    historyZoneEl.hidden = false;
    refreshHistorySelection();
  } else {
    selectedHistoryId = null;
    historyZoneEl.hidden = true;
  }
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
  historyListEl.addEventListener('click', onHistoryListClick);
  window.addEventListener('lingo:unauthorized', () => {
    if (authRequired) showAuthGate();
  });
  window.addEventListener('pagehide', releaseMic);
}

init();
