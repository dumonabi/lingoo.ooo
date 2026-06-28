import { createLangPicker, hideAllLangPickerCarets } from './lang-picker.js';
import { createTypingCaret, measureCharCell, positionBlockCaret } from './caret-style.js';
import { CHAMELEON_LOGO_SVG } from './chameleon-logo.js';
import { apiFetch, clearAuthToken, fetchCurrentUser, getAuthToken, setAuthToken, setStoredUser } from './auth.js';
import { initUserProfile, refreshUserSession } from './user-profile.js';
import {
  clearAllPendingRecordings,
  isRetryableSendError,
  listPendingRecordings,
  purgeStalePendingRecordings,
  removePendingRecording,
  retryDelayMs,
  savePendingRecording,
  updatePendingRecording,
} from './pending-audio.js';
import { bindKeepWarm } from './keep-warm.js';

const STORAGE_KEY = 'lingo-languages';
const DEFAULT_LANG1 = 'en';
const DEFAULT_LANG2 = 'es';
const MAX_RECORDING_MS = 90_000;
const RECORDING_TAIL_MS = 150;
const RECORDER_STOP_FLUSH_MS = 150;

let authRequired = false;
let recordingSessionId = 0;

const state = {
  languages: [],
  lang1: DEFAULT_LANG1,
  lang2: DEFAULT_LANG2,
  messages: [],
  user: null,
  isProcessing: false,
  isRecording: false,
  stoppingRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  mediaStream: null,
  currentAudio: null,
  recordingStartedAt: 0,
  latestMessageId: null,
  draftText: '',
  composerSession: false,
};

let playbackEpoch = 0;
let speakChain = Promise.resolve();
let latestTranslationRequest = 0;
let lastTranslationAppliedAt = 0;
let pendingQueuePausedUntil = 0;
let activeConverseController = null;
let draftTranslationPrefetch = null;
let draftPrefetchSeq = 0;
let pendingSourceRecording = null;
let cloneVoiceLanguages = new Set([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hr', 'id',
  'it', 'ja', 'ko', 'ms', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'ta', 'tl',
  'tr', 'uk', 'zh',
]);

let picker1;
let picker2;

const $ = (sel) => document.querySelector(sel);

const appEl = $('#app');
const languageBarEl = document.querySelector('.language-bar');
const currentMessageEl = $('#current-message');
const toastEl = $('#toast');
const composeBoxEl = $('#compose-box');
const composeMicBtn = $('#compose-mic');
const composeMicProgressFill = $('#compose-mic-progress-fill');
const composeNewBtn = $('#compose-new');
const composeRecordingEl = $('#compose-recording');
const composeLevelEl = $('#compose-level');
const recordingCancelBtn = $('#recording-cancel');
const recordingSendBtn = $('#recording-send');
const recordingSendProgressFill = $('#recording-send-progress-fill');
const dictationInputEl = $('#dictation-input');
const composeInputWrapEl = $('#compose-input-wrap');
const composeCaretEl = $('#compose-caret');
const dictationTranslateBtn = $('#dictation-translate');

const LOADING_DOT_MS = 500;
const LOADING_DOT_MAX = 20;
let loadingDotsTimer = null;

let composeCaretMirrorEl = null;

const RING_CIRCUMFERENCE = 2 * Math.PI * 54;
const COMPOSE_MIC_RING_R = 19;
const COMPOSE_MIC_RING_CIRCUMFERENCE = 2 * Math.PI * COMPOSE_MIC_RING_R;
const MIC_WAVE_VISIBLE = 14;
const MIC_WAVE_TOTAL = MIC_WAVE_VISIBLE + 1;
const MIC_WAVE_SHIFT_MS = 46;
const MIC_WAVE_BAR_STEP = 5;
const MOBILE_WAVE_BARS = 3;
const MOBILE_WAVE_UPDATE_MS = 80;

const mobileMicWavePreferred = (() => {
  try {
    return window.matchMedia('(pointer: coarse), (max-width: 768px)').matches;
  } catch {
    return false;
  }
})();
const MIC_BAR_IDLE = 0.05;
const MIC_BAR_TRIGGER = 0.22;
const MIC_VOICE_GATE = 0.1;
const COMPOSE_WAVE_VISIBLE = 12;

let progressRaf = null;
let transcribeProgressRaf = null;
let transcribeProgressStartedAt = 0;
let transcribeProgressEstimateMs = 2500;
let recordingProgressRaf = null;
let progressStartedAt = 0;
let progressEstimateMs = 4000;
let pendingQueueBusy = false;
let pendingRetryTimer = null;
let streamProgressFinished = false;
let micMeter = null;
let micMeterCtx = null;
let micWaveSlots = [];
let micWaveBarEls = [];
let micWaveScrollEl = null;
let micWaveLastShift = 0;
let micWaveShiftBusy = false;

const COPY_BTN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const SHARE_BTN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>';
const LISTEN_BTN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
const SHARE_AUDIO_BTN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h2l3.5 3.5V6.5L6 10H4z" fill="currentColor" stroke="none"/><path d="M13 12h7"/><path d="M17 8l4 4-4 4"/></svg>';

function prefetchAudio(msg) {
  return loadMessageAudio(msg, { prefetch: true });
}

function speakModeForMessage(msg) {
  const lang = msg.targetLanguage;
  if (!lang || !state.user?.voiceReady) return 'default';
  const code = lang === 'nn' ? 'no' : lang;
  if (!cloneVoiceLanguages.has(code)) return 'default';
  return 'clone';
}

function audioCacheKey(msg) {
  const userId = state.user?.id || 'default';
  const mode = speakModeForMessage(msg);
  return `${userId}|${mode}|${msg.translated}|${msg.targetLanguage}`;
}

function getMessageCardEl(message) {
  return document.querySelector(`.message-card[data-message-id="${message.id}"]`);
}

function revealListenButton(message) {
  const listenWrap = getMessageCardEl(message)?.querySelector('.message-actions-listen');
  if (!listenWrap) return;
  listenWrap.hidden = false;
  listenWrap.querySelector('.listen-btn')?.classList.add('is-ready');
  listenWrap.querySelector('.share-audio-btn')?.classList.add('is-ready');
}

function startBackgroundAudio(message) {
  if (message.audioUrl) {
    revealListenButton(message);
    return;
  }

  void prefetchAudio(message).finally(() => {
    if (message.id !== state.latestMessageId) return;
    revealListenButton(message);
  });
}

function resetVoiceBtn(btn) {
  btn.classList.remove('playing', 'is-loading');
  btn.disabled = false;
  delete btn.dataset.busy;
  releaseActionButtonFocus(btn);
}

function cancelMessageAudio(msg) {
  if (msg._speakAbort) {
    msg._speakAbort.abort();
    msg._speakAbort = null;
  }
  invalidateMessageAudio(msg);
}

function invalidateMessageAudio(msg) {
  if (msg.audioUrl) {
    URL.revokeObjectURL(msg.audioUrl);
    msg.audioUrl = null;
  }
  msg._audioPromise = null;
}

function stopPlayback() {
  playbackEpoch++;
  const audio = state.currentAudio;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // ignore seek errors
    }
    audio.removeAttribute('src');
    audio.load();
    state.currentAudio = null;
  }
}

function prepareForNewTranslation(message) {
  stopPlayback();
  state.latestMessageId = message.id;
  for (const m of state.messages) {
    if (m.id !== message.id) {
      cancelMessageAudio(m);
    }
  }
}

function enqueueSpeak(task) {
  const run = speakChain.then(task, task);
  speakChain = run.catch(() => {});
  return run;
}

function withTimeout(promise, ms, message, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function converseTimeoutMs(recordingMs, blobBytes) {
  const audioSeconds = Math.max(recordingMs / 1000, blobBytes / 12000, 1);
  return Math.min(240000, Math.max(90000, audioSeconds * 2500 + 45000));
}

function abortActiveConverse() {
  if (activeConverseController) {
    activeConverseController.abort();
    activeConverseController = null;
  }
}

function cancelDraftTranslationPrefetch() {
  if (!draftTranslationPrefetch) return;
  draftTranslationPrefetch.controller?.abort();
  if (draftTranslationPrefetch.hiddenMessage) {
    cancelMessageAudio(draftTranslationPrefetch.hiddenMessage);
  }
  draftTranslationPrefetch = null;
}

function releaseDraftTranslationPrefetch() {
  draftTranslationPrefetch = null;
}

function syncDraftTranslationPrefetch() {
  const text = getDraftText();
  if (!draftTranslationPrefetch) return;
  if (text === draftTranslationPrefetch.sourceText) return;
  cancelDraftTranslationPrefetch();
}

function startDraftTranslationPrefetch(text) {
  const sourceText = String(text ?? '').trim();
  if (!sourceText || !languagesReady()) return;
  if (state.isProcessing) return;

  cancelDraftTranslationPrefetch();

  const controller = new AbortController();
  const prefetchRequestId = ++draftPrefetchSeq;
  const entry = {
    sourceText,
    prefetchRequestId,
    controller,
    result: null,
    error: null,
    hiddenMessage: {
      id: `prefetch-${prefetchRequestId}`,
      translated: '',
      targetLanguage: null,
      audioUrl: null,
    },
    promise: null,
  };
  draftTranslationPrefetch = entry;

  entry.promise = runDraftTranslationPrefetch(entry).catch((err) => {
    if (err?.name !== 'AbortError') entry.error = err;
    return null;
  });
}

async function runDraftTranslationPrefetch(entry) {
  if (draftTranslationPrefetch !== entry) return null;

  const data = await sendTextForTranslation({
    text: entry.sourceText,
    signal: entry.controller.signal,
    requestId: entry.prefetchRequestId,
    mode: 'prefetch',
    prefetchRef: entry,
  });

  if (draftTranslationPrefetch === entry && data?.translatedText?.trim()) {
    entry.result = data;
  }
  return data;
}

function kickoffPrefetchAudio(prefetchRef, doneData) {
  if (!doneData?.translatedText?.trim() || !prefetchRef?.hiddenMessage) return;
  const msg = prefetchRef.hiddenMessage;
  msg.translated = doneData.translatedText;
  msg.targetLanguage = doneData.targetLanguage;
  void prefetchAudio(msg);
}

async function loadMessageAudio(msg, { prefetch = false } = {}) {
  const key = audioCacheKey(msg);
  if (msg._audioKey && msg._audioKey !== key) {
    invalidateMessageAudio(msg);
  }
  msg._audioKey = key;

  if (msg.audioUrl) return;

  if (msg._audioPromise) {
    try {
      await msg._audioPromise;
    } catch {
      // handled below
    }
    if (msg.audioUrl) return;
  }

  const attempts = prefetch ? 2 : 2;
  const messageId = msg.id;
  const errMsg = 'Audio not ready — tap Listen again';

  msg._audioPromise = enqueueSpeak(async () => {
    if (prefetch && state.latestMessageId && messageId !== state.latestMessageId) return;

    if (msg._speakAbort) {
      msg._speakAbort.abort();
      msg._speakAbort = null;
    }
    const controller = new AbortController();
    msg._speakAbort = controller;

    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (prefetch && state.latestMessageId && messageId !== state.latestMessageId) return;

      try {
        const res = await apiFetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: msg.translated,
            lang: msg.targetLanguage,
            voiceMode: speakModeForMessage(msg),
          }),
          signal: controller.signal,
        });

        let message = errMsg;
        if (!res.ok) {
          try {
            const data = await res.json();
            message = data.error || errMsg;
          } catch {
            if (res.status === 429) message = 'Too many audio requests — wait a moment';
          }
          throw new Error(message);
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('audio')) {
          throw new Error(errMsg);
        }

        const blob = await res.blob();
        if (!blob.size) throw new Error(errMsg);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        msg.audioUrl = URL.createObjectURL(blob);
        msg._speakAbort = null;
        return;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        lastError = err;
        invalidateMessageAudio(msg);
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
      }
    }

    msg._speakAbort = null;
    throw lastError || new Error(errMsg);
  });

  try {
    await withTimeout(msg._audioPromise, 40000, 'Audio timed out — tap Listen again');
  } catch (err) {
    if (err?.name !== 'AbortError') {
      invalidateMessageAudio(msg);
      if (!prefetch) throw err;
    }
  } finally {
    if (prefetch && state.latestMessageId && messageId !== state.latestMessageId) {
      cancelMessageAudio(msg);
    }
  }
}

function waitForAudioReady(audio, ms = 4000) {
  if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onErr = () => {
      cleanup();
      reject(new Error('Playback failed'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      audio.removeEventListener('loadeddata', onReady);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('error', onErr);
    };

    audio.addEventListener('loadeddata', onReady, { once: true });
    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('error', onErr, { once: true });
  });
}

function playAudioUrl(url) {
  const epoch = playbackEpoch;

  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.setAttribute('playsinline', '');
    audio.volume = 1;
    state.currentAudio = audio;

    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.onended = null;
      audio.onerror = null;
      if (state.currentAudio === audio) state.currentAudio = null;
      fn();
    };

    const timer = setTimeout(() => {
      audio.pause();
      finish(() => reject(new Error('Playback timed out — tap again')));
    }, 90000);

    audio.onended = () => {
      if (epoch !== playbackEpoch) {
        finish(() => reject(new DOMException('Aborted', 'AbortError')));
        return;
      }
      finish(resolve);
    };
    audio.onerror = () => finish(() => reject(new Error('Playback failed')));

    const start = async () => {
      try {
        audio.src = url;
        await waitForAudioReady(audio);
        if (epoch !== playbackEpoch) return;
        await audio.play();
      } catch (err) {
        finish(() => reject(err));
      }
    };

    void start();
  });
}

function resetListenBtn(btn) {
  resetVoiceBtn(btn);
}

function releaseActionButtonFocus(btn) {
  btn?.blur();
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
}

async function shareTranslation(text, btn) {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    showToast('Copied — paste to share');
  } catch (err) {
    if (err?.name === 'AbortError') return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied — paste to share');
    } catch {
      showToast('Could not share');
    }
  } finally {
    releaseActionButtonFocus(btn);
  }
}

async function init() {
  $('#auth-logo').innerHTML = CHAMELEON_LOGO_SVG;

  const ready = await checkHealth();
  if (!ready) return;

  bindKeepWarm();

  const authed = await ensureAuthenticated();
  if (!authed) return;

  await loadLanguages();
  initPickers();
  bindEvents();
  bindMicHelp();
  bindPendingQueue();
  bindDictation();
  checkMicSupport();
  ensureComposeLevelBars();
  if (composeMicProgressFill) {
    composeMicProgressFill.style.strokeDasharray = String(COMPOSE_MIC_RING_CIRCUMFERENCE);
    composeMicProgressFill.style.strokeDashoffset = String(COMPOSE_MIC_RING_CIRCUMFERENCE);
  }
  if (recordingSendProgressFill) {
    recordingSendProgressFill.style.strokeDasharray = String(COMPOSE_MIC_RING_CIRCUMFERENCE);
    recordingSendProgressFill.style.strokeDashoffset = String(COMPOSE_MIC_RING_CIRCUMFERENCE);
  }
  resizeDictationInput();
  updateComposeState();
  scheduleComposeFocus();
  initUserProfile($('#user-profile-slot'), {
    showToast,
    onChange: (user) => {
      state.user = user;
    },
  });
  void refreshUserSession();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncLanguageStateFromStorage();
    }
  });
  void purgeStalePendingRecordings();
  void refreshPendingBanner();
  wakePendingQueue();
}

async function ensureAuthenticated() {
  if (!authRequired) return true;

  if (getAuthToken()) {
    const data = await fetchCurrentUser();
    if (data?.user) {
      state.user = data.user;
      return true;
    }
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
        if (data.user) {
          setStoredUser(data.user);
          state.user = data.user;
        }
        gate.hidden = true;
        void refreshUserSession();
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
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
    ];
  }
}

function initPickers() {
  restoreSavedLanguages();

  picker1 = createLangPicker($('#lang-picker-1'), {
    languages: state.languages,
    value: state.lang1,
    placeholder: '',
    onFocusEdit: syncComposeCaret,
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
    placeholder: '',
    onFocusEdit: syncComposeCaret,
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

  saveLanguages();
}

function loadSavedLanguages() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function isKnownLanguage(code) {
  return Boolean(code && state.languages.some((lang) => lang.code === code));
}

function languagePairKey(lang1, lang2) {
  return [lang1, lang2].sort().join('\0');
}

function syncLanguageStateFromPickers() {
  const lang1 = picker1?.getValue() || state.lang1;
  const lang2 = picker2?.getValue() || state.lang2;
  if (lang1 && lang2 && lang1 !== lang2) {
    state.lang1 = lang1;
    state.lang2 = lang2;
  }
}

function restoreSavedLanguages() {
  const saved = loadSavedLanguages();
  if (!saved?.lang1 || !saved?.lang2 || saved.lang1 === saved.lang2) return false;

  if (isKnownLanguage(saved.lang1) && isKnownLanguage(saved.lang2)) {
    state.lang1 = saved.lang1;
    state.lang2 = saved.lang2;
    return true;
  }

  // Language list may still be the offline fallback — trust saved pair anyway.
  if (state.languages.length <= 2) {
    state.lang1 = saved.lang1;
    state.lang2 = saved.lang2;
    return true;
  }

  return false;
}

async function ensureLanguagesLoaded() {
  if (state.languages.length > 2) return;

  try {
    const res = await apiFetch('/api/languages');
    if (!res.ok) return;
    state.languages = await res.json();
    restoreSavedLanguages();
    picker1?.setValue(state.lang1);
    picker2?.setValue(state.lang2);
  } catch {
    // offline fallback stays in place
  }
}

function syncLanguageStateFromStorage() {
  if (!state.languages.length) return;
  void ensureLanguagesLoaded();
  const prevKey = languagePairKey(state.lang1, state.lang2);
  syncLanguageStateFromPickers();
  restoreSavedLanguages();
  picker1?.setValue(state.lang1);
  picker2?.setValue(state.lang2);
  const nextKey = languagePairKey(state.lang1, state.lang2);
  if (prevKey !== nextKey) {
    cancelDraftTranslationPrefetch();
  }
}

function getLanguagePair() {
  syncLanguageStateFromPickers();
  restoreSavedLanguages();
  return { lang1: state.lang1, lang2: state.lang2 };
}

function saveLanguages() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang1: state.lang1, lang2: state.lang2 }));
}

function clearConversation() {
  state.messages = [];
  currentMessageEl.innerHTML = '';
}

function onLanguagesChanged() {
  cancelDraftTranslationPrefetch();
  clearConversation();
  saveLanguages();
  void clearAllPendingRecordings();
  updateComposeState();
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

function isRecordingUiActive() {
  return composeBoxEl?.classList.contains('is-recording');
}

function setRecordingUI(active) {
  composeBoxEl?.classList.toggle('is-recording', Boolean(active));
}

function updateComposeState() {
  const ready = languagesReady();
  const recordingUi = isRecordingUiActive();
  const busy = recordingUi || state.isRecording || state.isProcessing || state.stoppingRecording;
  const hasText = Boolean(getDraftText());
  const canUseDraftActions = hasText && !busy;

  composeMicBtn.disabled = !ready || busy;
  composeNewBtn.hidden = !canUseDraftActions;
  composeNewBtn.disabled = !canUseDraftActions;
  dictationTranslateBtn.hidden = !canUseDraftActions;
  dictationTranslateBtn.disabled = !canUseDraftActions;
  dictationTranslateBtn.classList.toggle('is-ready', canUseDraftActions);
  composeBoxEl?.classList.toggle('has-draft-actions', canUseDraftActions);
  recordingCancelBtn.disabled = state.stoppingRecording;
  recordingSendBtn.disabled = !state.isRecording || state.stoppingRecording;
  dictationInputEl.disabled = recordingUi || state.isRecording || state.isProcessing;
  syncComposeCaret();
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    authRequired = Boolean(data.authRequired);
    if (Array.isArray(data.cloneVoiceLanguages) && data.cloneVoiceLanguages.length) {
      cloneVoiceLanguages = new Set(data.cloneVoiceLanguages);
    }
    return true;
  } catch {
    showToast('Run: npm run dev');
    return false;
  }
}

function checkMicSupport() {
  if (!navigator.mediaDevices?.getUserMedia) {
    composeMicBtn.disabled = true;
    showToast('Microphone not supported');
  }
}

function resizeDictationInput() {
  if (!dictationInputEl) return;
  dictationInputEl.style.height = 'auto';
  dictationInputEl.style.height = `${dictationInputEl.scrollHeight}px`;
  syncComposeCaret();
}

let composeCaretTyping = null;

function getComposeCaretTyping() {
  if (!composeCaretTyping && composeCaretEl) {
    composeCaretTyping = createTypingCaret(composeCaretEl);
  }
  return composeCaretTyping;
}

function pulseComposeCaretTyping() {
  getComposeCaretTyping()?.pulse();
}

function ensureComposeCaretMirror() {
  if (composeCaretMirrorEl || !composeInputWrapEl) return composeCaretMirrorEl;
  composeCaretMirrorEl = document.createElement('div');
  composeCaretMirrorEl.className = 'compose-caret-mirror';
  composeCaretMirrorEl.setAttribute('aria-hidden', 'true');
  composeInputWrapEl.appendChild(composeCaretMirrorEl);
  return composeCaretMirrorEl;
}

function syncComposeCaret() {
  const wrap = composeInputWrapEl;
  const ta = dictationInputEl;
  const caret = composeCaretEl;
  if (!wrap || !ta || !caret) return;

  const recording = isRecordingUiActive() || state.isRecording || state.isProcessing;
  const focused = document.activeElement === ta;

  wrap.classList.toggle('is-focused', focused);
  wrap.classList.toggle('is-empty', !ta.value);

  if (recording || ta.disabled || !focused) {
    caret.hidden = true;
    getComposeCaretTyping()?.reset();
    return;
  }

  caret.hidden = false;

  const mirror = ensureComposeCaretMirror();
  const style = getComputedStyle(ta);
  mirror.style.width = `${ta.clientWidth}px`;
  mirror.style.font = style.font;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.boxSizing = style.boxSizing;

  const caretPos = focused ? (ta.selectionStart ?? ta.value.length) : ta.value.length;
  const textBefore = ta.value.slice(0, caretPos);
  const textAfter = ta.value.slice(caretPos);

  mirror.replaceChildren();
  mirror.append(document.createTextNode(textBefore));
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.append(marker);
  if (textAfter) mirror.append(document.createTextNode(textAfter));

  const markerRect = marker.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const { charWidth, lineHeight } = measureCharCell(mirror, style);

  positionBlockCaret(caret, {
    left: markerRect.left - wrapRect.left,
    top: markerRect.top - wrapRect.top + ta.scrollTop,
    charWidth,
    lineHeight,
  });
}

function shouldRefocusComposeInput(next) {
  if (!next) return true;
  if (next === dictationInputEl) return false;
  if (next.closest?.('button, .lang-picker, #auth-gate, .user-profile, select, input, textarea, a')) return false;
  return true;
}

function focusComposeInput({ moveCaretToEnd = false } = {}) {
  if (!dictationInputEl || state.isRecording || state.isProcessing || dictationInputEl.disabled) return;
  dictationInputEl.focus({ preventScroll: true });
  if (moveCaretToEnd) {
    const pos = dictationInputEl.value.length;
    dictationInputEl.setSelectionRange(pos, pos);
  }
  syncComposeCaret();
}

function scheduleComposeFocus({ moveCaretToEnd = false } = {}) {
  syncComposeCaret();
  const run = () => focusComposeInput({ moveCaretToEnd });
  requestAnimationFrame(run);
  if (moveCaretToEnd) {
    window.setTimeout(run, 80);
  }
}

function enterComposerSession() {
  if (state.composerSession) return;
  state.composerSession = true;
  appEl?.classList.add('session-active');
  requestAnimationFrame(() => {
    languageBarEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function showDraftPanel(text) {
  const value = String(text ?? '').trim();
  state.draftText = value;
  dictationInputEl.value = value;
  if (!state.composerSession) enterComposerSession();
  resizeDictationInput();
  updateComposeState();
}

function appendToDraft(text, { prefetch = true } = {}) {
  const addition = String(text ?? '').trim();
  if (!addition) return;
  const current = dictationInputEl.value.trim();
  const combined = current ? `${current} ${addition}` : addition;
  showDraftPanel(combined);
  if (!dictationInputEl.value.endsWith(' ')) {
    dictationInputEl.value += ' ';
    state.draftText = dictationInputEl.value;
    resizeDictationInput();
  }
  if (prefetch) startDraftTranslationPrefetch(getDraftText());
  scheduleComposeFocus({ moveCaretToEnd: true });
}

function clearPendingSourceRecording() {
  pendingSourceRecording = null;
}

function clearDraftText() {
  cancelDraftTranslationPrefetch();
  clearPendingSourceRecording();
  emptyDraftFields();
}

function emptyDraftFields() {
  state.draftText = '';
  dictationInputEl.value = '';
  resizeDictationInput();
  updateComposeState();
  scheduleComposeFocus();
}

function getDraftText() {
  return dictationInputEl.value.trim() || state.draftText.trim();
}

function bindDictation() {
  dictationInputEl.addEventListener('input', () => {
    state.draftText = dictationInputEl.value;
    syncDraftTranslationPrefetch();
    resizeDictationInput();
    updateComposeState();
    pulseComposeCaretTyping();
  });
  dictationInputEl.addEventListener('focus', () => {
    hideAllLangPickerCarets();
    syncComposeCaret();
  });
  dictationInputEl.addEventListener('blur', syncComposeCaret);
  dictationInputEl.addEventListener('blur', (e) => {
    if (shouldRefocusComposeInput(e.relatedTarget)) {
      requestAnimationFrame(() => focusComposeInput());
      return;
    }
    requestAnimationFrame(syncComposeCaret);
  });
  dictationInputEl.addEventListener('keydown', pulseComposeCaretTyping);
  dictationInputEl.addEventListener('keyup', syncComposeCaret);
  dictationInputEl.addEventListener('click', () => {
    pulseComposeCaretTyping();
    syncComposeCaret();
  });
  dictationInputEl.addEventListener('touchend', () => {
    requestAnimationFrame(syncComposeCaret);
  }, { passive: true });
  dictationInputEl.addEventListener('scroll', syncComposeCaret, { passive: true });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === dictationInputEl) syncComposeCaret();
  });
  composeBoxEl?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (e.target === dictationInputEl) return;
    focusComposeInput();
  });
  dictationTranslateBtn.addEventListener('click', () => {
    void translateDraft();
  });
  composeNewBtn.addEventListener('click', () => {
    clearDraftText();
  });
  window.addEventListener('resize', () => {
    resizeDictationInput();
    syncComposeCaret();
  }, { passive: true });
}

async function translateDraft() {
  const text = getDraftText();
  if (!text) {
    showToast('Enter or dictate something first');
    return;
  }
  if (state.isProcessing || state.isRecording || state.stoppingRecording) return;

  abortActiveConverse();
  const controller = new AbortController();
  activeConverseController = controller;
  const requestId = ++latestTranslationRequest;
  const prefetch = draftTranslationPrefetch;
  const matchesPrefetch = prefetch?.sourceText === text;

  state.isProcessing = true;
  updateComposeState();

  try {
    if (matchesPrefetch && prefetch.result) {
      await applyTranslationResult(prefetch.result, { requestId, prefetchEntry: prefetch });
      releaseDraftTranslationPrefetch();
      emptyDraftFields();
      return;
    }

    beginTranslationPanel(text, requestId);

    if (matchesPrefetch && prefetch.promise) {
      const data = await prefetch.promise;
      if (getDraftText() !== text) {
        throw new Error('Message changed');
      }
      if (data?.translatedText?.trim()) {
        await applyTranslationResult(data, { requestId, prefetchEntry: prefetch });
        releaseDraftTranslationPrefetch();
        emptyDraftFields();
        return;
      }
    }

    cancelDraftTranslationPrefetch();
    await sendTextForTranslation({ text, signal: controller.signal, requestId });
    releaseDraftTranslationPrefetch();
    emptyDraftFields();
  } catch (err) {
    if (err?.name === 'AbortError') return;
    stopLoadingDots();
    state.messages = [];
    renderConversation();
    showDraftPanel(text);
    showToast(err.message || 'Translation failed');
  } finally {
    stopLoadingDots();
    if (activeConverseController === controller) {
      activeConverseController = null;
    }
    resetMicUI();
  }
}

async function sendTextForTranslation({ text, signal, requestId, mode = 'active', prefetchRef }) {
  const { lang1, lang2 } = getLanguagePair();
  let res;
  try {
    res = await withTimeout(
      apiFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          lang1,
          lang2,
          context: buildConversationContext(),
        }),
        signal,
      }),
      60000,
      'Request timed out',
      () => {},
    );
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const error = new Error(err.message || 'Cannot connect to server');
    error.retryable = true;
    throw error;
  }

  if (res.status === 401) {
    const error = new Error('Session expired — enter the access code again');
    error.retryable = true;
    throw error;
  }

  let data = {};
  if (!res.ok) {
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    const error = new Error(data.error || 'Processing failed');
    error.retryable = isRetryableSendError(error, res);
    throw error;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('ndjson')) {
    throw new Error('Unexpected server response');
  }

  data = await consumeConverseStream(res, { requestId, signal, mode, prefetchRef });
  if (!data.translatedText?.trim()) {
    throw new Error('Could not translate');
  }

  if (mode === 'prefetch') {
    return data;
  }

  if (requestId !== latestTranslationRequest) return;
  await applyTranslationResult(data, { requestId });
}

async function fetchTranscriptFromAudio({ blob, mimeType }) {
  const { lang1, lang2 } = getLanguagePair();
  const form = new FormData();
  form.append('audio', blob, `audio.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
  form.append('lang1', lang1);
  form.append('lang2', lang2);

  const timeoutMs = Math.min(90000, Math.max(15000, 12000 + (blob?.size || 0) / 8));

  const res = await withTimeout(
    apiFetch('/api/transcribe', {
      method: 'POST',
      body: form,
    }),
    timeoutMs,
    'Transcription timed out',
    () => {},
  );

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new Error(data.error || 'Could not transcribe audio');
  }

  return data.rawText?.trim() || '';
}

function warmMicForRecording() {
  if (!languagesReady() || state.isProcessing || state.isRecording || state.stoppingRecording) return;
  primeMicAudioOnGesture();
  void ensureMicStream().catch(() => {});
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
  const MIN_MS = 2500;
  const MAX_MS = 7500;

  const audioSeconds = Math.max(recordingMs / 1000, blobBytes / 11000, 0.5);

  const t = Math.min(audioSeconds / 20, 1);
  return Math.round(MIN_MS + t * (MAX_MS - MIN_MS));
}

function estimateTranscribeMs(recordingMs, blobBytes) {
  const MIN_MS = 1000;
  const MAX_MS = 3500;
  const audioSeconds = Math.max(recordingMs / 1000, blobBytes / 14000, 0.4);
  const t = Math.min(audioSeconds / 12, 1);
  return Math.round(MIN_MS + t * (MAX_MS - MIN_MS));
}

function simulatedProgress(elapsedMs, estimateMs = progressEstimateMs) {
  const target = estimateMs;
  const ratio = elapsedMs / target;

  if (ratio <= 1) return ratio * 97;

  const overtime = elapsedMs - target;
  return Math.min(97 + (overtime / (target * 0.6)) * 2, 99);
}

function updateMicTranscribeProgress(pct) {
  if (!composeMicProgressFill) return;
  const offset = COMPOSE_MIC_RING_CIRCUMFERENCE * (1 - pct / 100);
  composeMicProgressFill.style.strokeDashoffset = String(offset);
  composeMicProgressFill.style.stroke = rgbCss(processingRgb(pct));
}

function startMicTranscribeProgress(recordingMs, blobBytes) {
  stopMicTranscribeProgress();
  transcribeProgressEstimateMs = estimateTranscribeMs(recordingMs, blobBytes);
  transcribeProgressStartedAt = performance.now();
  composeMicBtn?.classList.add('is-transcribing');
  composeMicBtn?.setAttribute('aria-busy', 'true');
  composeMicBtn?.setAttribute('aria-label', 'Transcribing audio');
  updateMicTranscribeProgress(0);

  const tick = (now) => {
    const elapsed = now - transcribeProgressStartedAt;
    updateMicTranscribeProgress(simulatedProgress(elapsed, transcribeProgressEstimateMs));
    transcribeProgressRaf = requestAnimationFrame(tick);
  };

  transcribeProgressRaf = requestAnimationFrame(tick);
}

function stopMicTranscribeProgress() {
  if (transcribeProgressRaf) cancelAnimationFrame(transcribeProgressRaf);
  transcribeProgressRaf = null;

  composeMicBtn?.classList.remove('is-transcribing');
  composeMicBtn?.removeAttribute('aria-busy');
  composeMicBtn?.setAttribute('aria-label', 'Record message');

  if (composeMicProgressFill) {
    composeMicProgressFill.style.strokeDashoffset = String(COMPOSE_MIC_RING_CIRCUMFERENCE);
    composeMicProgressFill.style.removeProperty('stroke');
  }
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

function applyProcessingVisuals(_pct) {
  // Progress visuals handled via .compose-box.is-processing
}

function clearProcessingVisuals() {
  composeBoxEl?.classList.remove('is-processing');
}

function updateProgressRing(_pct) {
  // Legacy no-op — progress ring removed
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

function prepareMicMeter(stream) {
  if (micMeter?.stream === stream) {
    const ctx = getMicMeterContext();
    if (ctx?.state === 'suspended') void ctx.resume();
    return;
  }

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
    stream,
    source,
    analyser,
    silentGain,
    timeData: new Uint8Array(analyser.fftSize),
    freqData: new Uint8Array(analyser.frequencyBinCount),
    smooth: 0,
  };

  if (ctx.state !== 'running') void ctx.resume();
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

function isMobileMicWave() {
  return mobileMicWavePreferred;
}

function ensureComposeLevelBars() {
  if (!composeLevelEl) return;
  if (micWaveScrollEl && micWaveBarEls.length === MIC_WAVE_TOTAL) return;

  composeLevelEl.style.setProperty('--compose-wave-visible', String(COMPOSE_WAVE_VISIBLE));
  composeLevelEl.innerHTML = '';
  micWaveBarEls.length = 0;
  micWaveScrollEl = document.createElement('span');
  micWaveScrollEl.className = 'compose-level-scroll';
  composeLevelEl.appendChild(micWaveScrollEl);

  micWaveSlots = Array(MIC_WAVE_TOTAL).fill(MIC_BAR_IDLE);
  for (let i = 0; i < MIC_WAVE_TOTAL; i++) {
    const bar = document.createElement('span');
    bar.className = 'compose-level-bar';
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
  return level < MIC_VOICE_GATE && instant < 0.025;
}

function computeWaveSample(level, silent) {
  if (silent || !micMeter) return MIC_BAR_IDLE;

  micMeter.analyser.getByteFrequencyData(micMeter.freqData);
  const voiceBins = Math.max(8, Math.floor(micMeter.freqData.length * 0.4));
  let peak = 0;
  for (let b = 2; b < 2 + voiceBins; b++) {
    peak = Math.max(peak, micMeter.freqData[b] / 255);
  }

  const gated = Math.max(0, peak - MIC_BAR_TRIGGER) / (1 - MIC_BAR_TRIGGER);
  if (gated < 0.07) return MIC_BAR_IDLE;

  const voiceLevel = Math.max(gated, Math.max(0, level - MIC_VOICE_GATE) * 0.55);
  const compressed = Math.pow(Math.min(1, voiceLevel * 0.82), 1.8);
  return MIC_BAR_IDLE + compressed * (1 - MIC_BAR_IDLE);
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
  ensureComposeLevelBars();
  if (!micMeter) return;

  const now = performance.now();
  if (now - micWaveLastShift < MIC_WAVE_SHIFT_MS || micWaveShiftBusy) return;
  micWaveLastShift = now;

  const level = readMicLevel();
  const silent = isMicSilent(level);
  if (silent && micMeter) micMeter.smooth *= 0.62;
  const sample = computeWaveSample(level, silent);
  shiftMicWaveform(sample);
}

function clearMicVoicePulse() {
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

function resetRecordingSendProgress() {
  if (!recordingSendProgressFill) return;
  recordingSendProgressFill.style.strokeDashoffset = String(COMPOSE_MIC_RING_CIRCUMFERENCE);
}

function updateRecordingSendProgress(pct) {
  if (!recordingSendProgressFill) return;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = COMPOSE_MIC_RING_CIRCUMFERENCE * (1 - clamped / 100);
  recordingSendProgressFill.style.strokeDashoffset = String(offset);
}

function stopRecordingProgress() {
  cancelRecordingProgressRaf();
  clearMicVoicePulse();
  resetRecordingSendProgress();
}

async function startRecordingProgress() {
  cancelRecordingProgressRaf();
  stopProgress();
  updateRecordingSendProgress(0);

  const tick = () => {
    if (!state.isRecording) return;

    applyMicVoicePulse();

    const elapsed = Date.now() - state.recordingStartedAt;
    const pct = (elapsed / MAX_RECORDING_MS) * 100;
    updateRecordingSendProgress(pct);

    if (elapsed >= MAX_RECORDING_MS) {
      updateRecordingSendProgress(100);
      cancelRecordingProgressRaf();
      void acceptRecording({ autoLimit: true });
      return;
    }

    recordingProgressRaf = requestAnimationFrame(tick);
  };

  recordingProgressRaf = requestAnimationFrame(tick);
}

function startProgress(estimatedMs) {
  streamProgressFinished = false;
  stopRecordingProgress();
  stopProgress();
  progressEstimateMs = estimatedMs;
  progressStartedAt = performance.now();
  composeBoxEl?.classList.add('is-processing');

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
    setTimeout(() => {
      resolve();
    }, 220);
  });
}

function stopProgress() {
  if (progressRaf) cancelAnimationFrame(progressRaf);
  progressRaf = null;
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

async function applyTranslationResult(data, { requestId, prefetchEntry, sourceRecording } = {}) {
  if (requestId !== undefined && requestId !== latestTranslationRequest) return;

  stopLoadingDots();

  const prev = state.messages[0];
  const streamId = requestId !== undefined ? `stream-${requestId}` : null;

  const attachedRecording = sourceRecording || pendingSourceRecording;

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    original: data.rawText || data.sourceText,
    translated: data.translatedText,
    detectedLanguage: data.detectedLanguage,
    targetLanguage: data.targetLanguage,
    audioUrl: null,
    sourceRecording: attachedRecording
      ? {
          blob: attachedRecording.blob,
          mimeType: attachedRecording.mimeType,
          recordingMs: attachedRecording.recordingMs,
        }
      : null,
  };

  if (attachedRecording && !sourceRecording) {
    clearPendingSourceRecording();
  }

  if (prev?._streaming && streamId && prev.id === streamId) {
    if (prev.audioUrl) message.audioUrl = prev.audioUrl;
    if (prev._audioPromise) message._audioPromise = prev._audioPromise;
    if (prev._speakAbort) message._speakAbort = prev._speakAbort;
    if (prev._audioKey) message._audioKey = prev._audioKey;
  }

  const hidden = prefetchEntry?.hiddenMessage;
  if (hidden) {
    if (hidden.audioUrl) message.audioUrl = hidden.audioUrl;
    if (hidden._audioPromise) message._audioPromise = hidden._audioPromise;
    if (hidden._speakAbort) message._speakAbort = hidden._speakAbort;
  }

  for (const m of state.messages) {
    if (m.id !== message.id) {
      cancelMessageAudio(m);
    }
  }

  state.messages = [message];
  lastTranslationAppliedAt = Date.now();
  pendingQueuePausedUntil = lastTranslationAppliedAt + 8000;
  prepareForNewTranslation(message);
  renderConversation();
  startBackgroundAudio(message);
  await clearAllPendingRecordings();
}

function beginTranslationPanel(sourceText, requestId) {
  if (requestId !== undefined && requestId !== latestTranslationRequest) return;

  if (!state.composerSession) enterComposerSession();

  const message = {
    id: `stream-${requestId}`,
    original: sourceText,
    translated: '',
    detectedLanguage: null,
    targetLanguage: null,
    audioUrl: null,
    _streaming: true,
    _loading: true,
  };

  state.messages = [message];
  state.latestMessageId = message.id;
  renderConversation();
}

function maxLoadingDots(textLength) {
  const chars = Math.max(textLength, 1);
  return Math.min(LOADING_DOT_MAX, Math.max(3, Math.ceil(chars / 12)));
}

function stopLoadingDots() {
  if (loadingDotsTimer) clearInterval(loadingDotsTimer);
  loadingDotsTimer = null;
}

function startLoadingDots(hostEl, textLength) {
  stopLoadingDots();
  const dotsEl = hostEl?.querySelector('.translation-loading-dots');
  if (!dotsEl) return;

  const cap = maxLoadingDots(textLength);
  let dotCount = 0;
  dotsEl.textContent = '';

  loadingDotsTimer = window.setInterval(() => {
    const message = state.messages[0];
    if (!message?._loading) {
      stopLoadingDots();
      return;
    }
    if (dotCount >= cap) return;
    dotCount += 1;
    dotsEl.textContent += '.';
  }, LOADING_DOT_MS);
}

function showStreamingTranscript(rawText, requestId) {
  if (requestId !== undefined && requestId !== latestTranslationRequest) return;

  const existing = state.messages[0];
  if (existing?._streaming && existing.id === `stream-${requestId}`) {
    existing.original = rawText;
    return;
  }

  const message = {
    id: `stream-${requestId}`,
    original: rawText,
    translated: '',
    detectedLanguage: null,
    targetLanguage: null,
    audioUrl: null,
    _streaming: true,
    _loading: true,
  };

  state.messages = [message];
  state.latestMessageId = message.id;
  renderConversation();
}

function appendStreamingTranslation(text, requestId) {
  if (requestId !== undefined && requestId !== latestTranslationRequest) return;

  const message = state.messages[0];
  if (!message?._streaming) return;

  const translatedEl = getMessageCardEl(message)?.querySelector('.message-translated-text');
  if (message._loading) {
    stopLoadingDots();
    message._loading = false;
    if (translatedEl) {
      translatedEl.classList.remove('is-loading');
      translatedEl.removeAttribute('aria-busy');
      translatedEl.textContent = '';
    }
  }

  message.translated += text;
  if (translatedEl) {
    translatedEl.textContent = message.translated;
    translatedEl.classList.add('is-streaming');
  }
}

function kickoffTranslationAudio(doneData, requestId) {
  if (requestId !== undefined && requestId !== latestTranslationRequest) return;
  if (!doneData?.translatedText?.trim()) return;

  const message = state.messages[0];
  if (!message?._streaming || message.id !== `stream-${requestId}`) return;

  message.translated = doneData.translatedText;
  message.detectedLanguage = doneData.detectedLanguage;
  message.targetLanguage = doneData.targetLanguage;
  startBackgroundAudio(message);
}

function handleStreamEvent(evt, requestId) {
  if (!evt?.event) return;

  if (evt.event === 'transcript') {
    showStreamingTranscript(evt.rawText, requestId);
    return;
  }

  if (evt.event === 'delta') {
    appendStreamingTranslation(evt.text || '', requestId);
    return;
  }

  if (evt.event === 'error') {
    const error = new Error(evt.error || 'Processing failed');
    error.retryable = true;
    throw error;
  }
}

async function consumeConverseStream(res, { requestId, signal, mode = 'active', prefetchRef } = {}) {
  if (!res.body) {
    throw new Error('No response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalData = null;

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new DOMException('Aborted', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const evt = JSON.parse(line);
        if (evt.event === 'done') {
          finalData = evt;
          if (mode === 'prefetch') {
            kickoffPrefetchAudio(prefetchRef, evt);
          } else {
            kickoffTranslationAudio(evt, requestId);
          }
          continue;
        }
        if (mode === 'prefetch') {
          if (evt.event === 'error') {
            const error = new Error(evt.error || 'Processing failed');
            error.retryable = true;
            throw error;
          }
          continue;
        }
        handleStreamEvent(evt, requestId);
      }
    }

    if (buffer.trim()) {
      const evt = JSON.parse(buffer);
      if (evt.event === 'done') {
        finalData = evt;
        if (mode === 'prefetch') {
          kickoffPrefetchAudio(prefetchRef, evt);
        } else {
          kickoffTranslationAudio(evt, requestId);
        }
      } else if (mode === 'prefetch') {
        if (evt.event === 'error') {
          const error = new Error(evt.error || 'Processing failed');
          error.retryable = true;
          throw error;
        }
      } else {
        handleStreamEvent(evt, requestId);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finalData) {
    const error = new Error('Connection interrupted — message saved for retry');
    error.retryable = true;
    throw error;
  }

  return finalData;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchConverse(formFactory, { attempts = 3, signal, timeoutMs = 120000 } = {}) {
  let lastError;
  let lastRes;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const attemptController = new AbortController();
    const onAbort = () => attemptController.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      const body = typeof formFactory === 'function' ? formFactory() : formFactory;
      const res = await withTimeout(
        apiFetch('/api/converse', {
          method: 'POST',
          body,
          signal: attemptController.signal,
        }),
        timeoutMs,
        'Request timed out — message saved',
        () => attemptController.abort(),
      );
      lastRes = res;

      if ((res.status === 502 || res.status === 503 || res.status === 504 || res.status === 408)
        && attempt < attempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }

      return res;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastError = err;
      if (attempt < attempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  if (lastRes) return lastRes;

  const error = new Error(lastError?.message || 'Cannot connect to server');
  error.retryable = true;
  throw error;
}

function clampRecordingMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(ms, MAX_RECORDING_MS);
}

async function submitRecording({
  blob,
  mimeType,
  recordingMs,
  lang1,
  lang2,
  context,
  pendingId,
  signal,
  requestId,
}) {
  const id = pendingId || crypto.randomUUID();
  const safeRecordingMs = clampRecordingMs(recordingMs);
  const timeoutMs = converseTimeoutMs(safeRecordingMs, blob?.size || 0);

  if (!pendingId) {
    await savePendingRecording({
      id,
      blob,
      mimeType,
      lang1,
      lang2,
      contextJson: JSON.stringify(context),
      recordingMs: safeRecordingMs,
      createdAt: Date.now(),
    });
  }

  const buildForm = () => {
    const form = new FormData();
    form.append('audio', blob, `audio.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
    form.append('lang1', lang1);
    form.append('lang2', lang2);
    form.append('durationMs', String(safeRecordingMs));
    form.append('context', JSON.stringify(context));
    return form;
  };

  let res;
  try {
    res = await fetchConverse(buildForm, {
      attempts: pendingId ? 2 : 3,
      signal,
      timeoutMs,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const current = (await listPendingRecordings()).find((item) => item.id === id);
    await updatePendingRecording(id, {
      attempts: (current?.attempts || 0) + 1,
      lastError: err.message,
    });
    throw err;
  }

  let data = {};
  const contentType = res.headers.get('content-type') || '';

  if (res.ok && contentType.includes('ndjson')) {
    try {
      data = await consumeConverseStream(res, { requestId, signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      const current = (await listPendingRecordings()).find((item) => item.id === id);
      await updatePendingRecording(id, {
        attempts: (current?.attempts || 0) + 1,
        lastError: err.message,
      });
      throw err;
    }
  } else {
    try {
      data = await res.json();
    } catch {
      data = {};
    }
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
    } else {
      await removePendingRecording(id);
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
  $('#pending-banner').hidden = true;
}

function schedulePendingRetry(delayMs = 5000) {
  clearTimeout(pendingRetryTimer);
  pendingRetryTimer = setTimeout(() => {
    void processPendingQueue();
  }, delayMs);
}

function wakePendingQueue() {
  if (Date.now() < pendingQueuePausedUntil) return;
  schedulePendingRetry(400);
}

async function processPendingQueue() {
  if (pendingQueueBusy || state.isProcessing || state.isRecording) return;
  if (Date.now() < pendingQueuePausedUntil) return;
  if (!navigator.onLine) {
    await refreshPendingBanner();
    return;
  }

  const items = await listPendingRecordings();
  if (!items.length) {
    await refreshPendingBanner();
    return;
  }

  const actionable = items.filter((item) => item.createdAt > lastTranslationAppliedAt);
  if (!actionable.length) {
    await clearAllPendingRecordings();
    return;
  }

  syncLanguageStateFromStorage();
  const { lang1, lang2 } = getLanguagePair();
  const currentPairKey = languagePairKey(lang1, lang2);
  const compatible = [];
  for (const item of actionable) {
    if (languagePairKey(item.lang1, item.lang2) === currentPairKey) {
      compatible.push(item);
    } else {
      await removePendingRecording(item.id);
    }
  }

  if (!compatible.length) {
    await refreshPendingBanner();
    return;
  }

  pendingQueueBusy = true;
  const item = compatible.sort((a, b) => b.createdAt - a.createdAt)[0];
  const requestId = latestTranslationRequest;

  try {
    if (state.isRecording) return;

    state.isProcessing = true;
    composeBoxEl.classList.add('is-processing');
    startProgress(estimateProcessingMs(item.recordingMs, item.blob?.size || 0));

    const context = JSON.parse(item.contextJson || '[]');
    const data = await submitRecording({
      blob: item.blob,
      mimeType: item.mimeType,
      recordingMs: item.recordingMs,
      lang1,
      lang2,
      context,
      pendingId: item.id,
      requestId,
    });

    if (requestId !== latestTranslationRequest) return;
    if (item.createdAt <= lastTranslationAppliedAt) return;

    await applyTranslationResult(data, {
      requestId,
      sourceRecording: {
        blob: item.blob,
        mimeType: item.mimeType,
        recordingMs: item.recordingMs,
      },
    });
    if (!streamProgressFinished) await finishProgress();
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (err.retryable !== false) {
      if (err.message?.includes('Session expired') && authRequired) {
        showAuthGate();
      }
      await updatePendingRecording(item.id, {
        attempts: (item.attempts || 0) + 1,
        lastError: err.message || 'Retry later',
      });
      schedulePendingRetry(retryDelayMs((item.attempts || 0) + 1));
    } else {
      await removePendingRecording(item.id);
    }
  } finally {
    state.isProcessing = false;
    resetMicUI();
    pendingQueueBusy = false;
    await refreshPendingBanner();
  }
}

function bindPendingQueue() {
  window.addEventListener('online', wakePendingQueue);
  window.addEventListener('focus', () => {
    syncLanguageStateFromStorage();
    wakePendingQueue();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncLanguageStateFromStorage();
      wakePendingQueue();
    }
  });
  window.addEventListener('pageshow', (event) => {
    syncLanguageStateFromStorage();
    if (event.persisted) wakePendingQueue();
  });
}

async function sendRecordingForTranslation({ blob, mimeType, recordingMs }) {
  abortActiveConverse();
  const controller = new AbortController();
  activeConverseController = controller;
  const requestId = ++latestTranslationRequest;
  const { lang1, lang2 } = getLanguagePair();

  try {
    const data = await submitRecording({
      blob,
      mimeType,
      recordingMs,
      lang1,
      lang2,
      context: buildConversationContext(),
      signal: controller.signal,
      requestId,
    });
    if (requestId !== latestTranslationRequest) return;
    await applyTranslationResult(data, {
      requestId,
      sourceRecording: { blob, mimeType, recordingMs },
    });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    throw err;
  } finally {
    if (activeConverseController === controller) {
      activeConverseController = null;
    }
  }
}

async function beginRecording() {
  if (!languagesReady()) {
    showToast('Select two languages');
    return;
  }
  if (state.isProcessing || state.stoppingRecording || state.isRecording || isRecordingUiActive()) return;

  const sessionId = ++recordingSessionId;
  primeMicAudioOnGesture();
  abortActiveConverse();
  cancelDraftTranslationPrefetch();
  clearPendingSourceRecording();
  latestTranslationRequest++;
  stopPlayback();
  clearMicVoicePulse();
  state.audioChunks = [];
  ensureComposeLevelBars();
  setRecordingUI(true);
  updateComposeState();

  try {
    const stream = await ensureMicStream();
    if (sessionId !== recordingSessionId) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    prepareMicMeter(stream);

    const mimeType = getMimeType();
    state.mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    state.mediaRecorder.start(250);
    state.recordingStartedAt = Date.now();
    state.isRecording = true;
    state.mediaStream = stream;

    updateComposeState();
    startRecordingProgress();
  } catch (err) {
    if (sessionId !== recordingSessionId) return;
    setRecordingUI(false);
    showMicHelp(err);
    releaseMic();
    updateComposeState();
  }
}

async function cancelRecording() {
  if (!isRecordingUiActive()) return;

  recordingSessionId++;
  state.isRecording = false;
  state.stoppingRecording = false;
  stopRecordingProgress();
  setRecordingUI(false);

  try {
    const recorder = state.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      await waitForRecorderStop(recorder);
    }
  } catch {
    // ignore stop errors while cancelling
  }

  state.audioChunks = [];
  cleanupRecorder();
  teardownMicMeter();
  releaseMicTracks();
  updateComposeState();
}

async function acceptRecording({ autoLimit = false } = {}) {
  if (state.stoppingRecording) return;
  if (!state.isRecording) return;

  state.stoppingRecording = true;
  const mimeType = state.mediaRecorder?.mimeType || 'audio/webm';

  try {
    if (!autoLimit) {
      await sleep(RECORDING_TAIL_MS);
    }

    state.isRecording = false;
    stopRecordingProgress();
    setRecordingUI(false);

    const recorder = state.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      await waitForRecorderStop(recorder);
    }

    const blob = buildRecordingBlob(mimeType);
    state.audioChunks = [];
    cleanupRecorder();
    teardownMicMeter();
    releaseMicTracks();

    const recordingMs = clampRecordingMs(
      state.recordingStartedAt ? Date.now() - state.recordingStartedAt : 0,
    );

    if (!autoLimit && (recordingMs < 450 || blob.size < 400)) {
      showToast('Recording too short');
      updateComposeState();
      return;
    }

    pendingSourceRecording = { blob, mimeType, recordingMs };

    composeBoxEl.classList.add('is-processing');
    updateComposeState();
    startMicTranscribeProgress(recordingMs, blob.size);

    let transcript = '';
    let transcribeOk = false;
    try {
      transcript = await fetchTranscriptFromAudio({ blob, mimeType });
      transcribeOk = true;
    } catch (err) {
      showToast(err.message || 'Could not transcribe audio');
      return;
    } finally {
      if (transcribeOk) {
        if (transcribeProgressRaf) cancelAnimationFrame(transcribeProgressRaf);
        transcribeProgressRaf = null;
        updateMicTranscribeProgress(100);
      }
      stopMicTranscribeProgress();
      composeBoxEl.classList.remove('is-processing');
    }

    if (!transcript.trim()) {
      showToast('No speech detected — try again');
      return;
    }

    appendToDraft(transcript);
  } finally {
    state.stoppingRecording = false;
    updateComposeState();
  }
}

async function waitForRecorderStop(mediaRecorder) {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      setTimeout(resolve, RECORDER_STOP_FLUSH_MS);
    };

    const timeout = setTimeout(finish, 5000);

    mediaRecorder.onstop = finish;

    try {
      if (mediaRecorder.state === 'recording' && typeof mediaRecorder.requestData === 'function') {
        mediaRecorder.requestData();
      }
      mediaRecorder.stop();
    } catch {
      finish();
    }
  });
}

function buildRecordingBlob(mimeType) {
  return new Blob(state.audioChunks, { type: mimeType });
}

function cleanupRecorder() {
  state.mediaRecorder = null;
}

function releaseMicTracks() {
  state.mediaStream?.getTracks().forEach((t) => t.stop());
  state.mediaStream = null;
  state.mediaRecorder = null;
}

function releaseMic() {
  stopPlayback();
  teardownMicMeter();
  releaseMicTracks();
}

function resetMicUI() {
  stopProgress();
  stopMicTranscribeProgress();
  stopLoadingDots();
  stopRecordingProgress();
  cleanupRecorder();
  state.isProcessing = false;
  state.stoppingRecording = false;
  state.isRecording = false;
  setRecordingUI(false);
  clearProcessingVisuals();
  updateComposeState();
}

async function playTranslation(msg, btn) {
  if (btn?.dataset.busy === '1') return;

  releaseActionButtonFocus(btn?.closest('.message-card')?.querySelector('.copy-btn, .share-btn'));
  if (btn) btn.dataset.busy = '1';
  stopPlayback();

  btn?.classList.add('playing');
  if (btn) btn.disabled = true;

  try {
    if (!msg.audioUrl) {
      await loadMessageAudio(msg);
    }
    if (!msg.audioUrl) throw new Error('Audio not ready — tap Listen again');
    await playAudioUrl(msg.audioUrl);
  } catch (err) {
    if (err?.name !== 'AbortError') {
      cancelMessageAudio(msg);
      showToast(err.message);
    }
  } finally {
    if (btn) resetListenBtn(btn);
  }
}

async function blobFromAudioUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not read audio');
  return res.blob();
}

async function shareClonedAudio(msg, btn) {
  if (btn?.dataset.busy === '1') return;
  if (btn) {
    btn.dataset.busy = '1';
    btn.disabled = true;
  }

  try {
    if (!msg.audioUrl) {
      await loadMessageAudio(msg);
    }
    if (!msg.audioUrl) throw new Error('Audio not ready — try again');

    const blob = await blobFromAudioUrl(msg.audioUrl);
    const filename = `lingu-translation-${Date.now()}.mp3`;
    const file = new File([blob], filename, { type: blob.type || 'audio/mpeg' });

    if (typeof navigator.share !== 'function') {
      showToast('Sharing audio is not supported on this device');
      return;
    }
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      showToast('Sharing audio is not supported on this device');
      return;
    }

    await navigator.share({ files: [file], title: 'Translation audio' });
  } catch (err) {
    if (err?.name !== 'AbortError') {
      showToast(err.message || 'Could not share audio');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      delete btn.dataset.busy;
      releaseActionButtonFocus(btn);
    }
  }
}

function renderTranslatedContent(msg) {
  if (msg._streaming && msg._loading && !msg.translated) {
    return `<span class="message-translated-text is-loading" aria-busy="true" aria-live="polite"><span class="translation-loading-dots"></span></span>`;
  }

  const streamingClass = msg._streaming ? ' is-streaming' : '';
  return `<span class="message-translated-text${streamingClass}">${escapeHtml(msg.translated)}</span>`;
}

function createMessageCard(msg) {
  const el = document.createElement('article');
  el.className = 'message-card message-card-current';
  el.dataset.messageId = String(msg.id);
  const hideActions = msg._streaming || msg._loading;

  el.innerHTML = `
    <div class="message-bubble">
      <div class="message-translated message-translated-only">
        ${renderTranslatedContent(msg)}
      </div>
      <div class="message-footer-actions"${hideActions ? ' hidden' : ''}>
        <button type="button" class="icon-btn share-btn share-btn-inline" title="Share text" aria-label="Share text">
          ${SHARE_BTN_SVG}
        </button>
        <div class="message-actions-listen"${msg.audioUrl ? '' : ' hidden'}>
          <button type="button" class="icon-btn listen-btn listen-btn-inline" title="Listen" aria-label="Listen">
            ${LISTEN_BTN_SVG}
          </button>
          <button type="button" class="icon-btn share-audio-btn" title="Share audio" aria-label="Share audio">
            ${SHARE_AUDIO_BTN_SVG}
          </button>
        </div>
        <button type="button" class="icon-btn copy-btn copy-btn-inline" title="Copy" aria-label="Copy">
          ${COPY_BTN_SVG}
        </button>
      </div>
    </div>
  `;

  if (msg.audioUrl) {
    el.querySelector('.listen-btn')?.classList.add('is-ready');
    el.querySelector('.share-audio-btn')?.classList.add('is-ready');
  }

  const listenBtn = el.querySelector('.listen-btn');
  const shareAudioBtn = el.querySelector('.share-audio-btn');
  const copyBtn = el.querySelector('.copy-btn');
  const shareBtn = el.querySelector('.share-btn');

  listenBtn?.addEventListener('click', () => playTranslation(msg, listenBtn));
  shareAudioBtn?.addEventListener('click', () => void shareClonedAudio(msg, shareAudioBtn));
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(msg.translated);
      showToast('Copied!');
    } catch {
      showToast('Could not copy');
    } finally {
      releaseActionButtonFocus(copyBtn);
    }
  });
  shareBtn?.addEventListener('click', () => shareTranslation(msg.translated, shareBtn));

  return el;
}

function renderConversation() {
  stopLoadingDots();
  currentMessageEl.innerHTML = '';

  if (!state.messages.length) {
    currentMessageEl.innerHTML = '';
    return;
  }

  const latest = state.messages[state.messages.length - 1];
  const card = createMessageCard(latest);
  currentMessageEl.appendChild(card);

  if (latest._loading) {
    startLoadingDots(card.querySelector('.message-translated-text'), latest.original?.length || 0);
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
  composeMicBtn.addEventListener('pointerdown', warmMicForRecording, { passive: true });
  composeMicBtn.addEventListener('click', () => void beginRecording());
  recordingCancelBtn.addEventListener('click', () => void cancelRecording());
  recordingSendBtn.addEventListener('click', () => void acceptRecording());
  window.addEventListener('lingo:unauthorized', () => {
    if (authRequired) showAuthGate();
  });
  window.addEventListener('pagehide', releaseMic);
}

init();
