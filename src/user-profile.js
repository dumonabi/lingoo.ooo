import { apiFetch, clearAuthSession, fetchCurrentUser, getAuthToken, getRecoveryPhrase, getStoredUser, setStoredUser } from './auth.js';
import { createLangPicker, hideAllLangPickerCarets } from './lang-picker.js';
import { $, escapeHtml } from './dom-utils.js';
import { createMicWave } from './mic-wave.js';
import { getRecordingMimeType } from './media-utils.js';
import { formatCloneVoiceLanguageList } from './elevenlabs-languages.js';
import { getVoicePrompt, getVoiceUi, resolveVoiceLanguage, VOICE_SAMPLE_TARGET } from './voice-prompts.js';

const profileMicWave = createMicWave();
let profileWaveRaf = null;

const USER_PROFILE_TRIGGER_ICON = `
  <span class="user-profile-trigger-icon" aria-hidden="true">
    <svg class="user-profile-user-icon" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>
    <span class="user-profile-badge user-profile-badge--plus">
      <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </span>
    <span class="user-profile-badge user-profile-badge--check">
      <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M1.75 5.25 4 7.5 8.25 2.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
    <span class="user-profile-badge user-profile-badge--close">
      <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M2 5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </span>
  </span>
`;

const PROFILE_SAMPLES_SAVED_ICON_SVG = `
  <svg class="user-profile-samples-saved-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M8,2 C8.55228475,2 9,2.44771525 9,3 L9,21 C9,21.5522847 8.55228475,22 8,22 C7.44771525,22 7,21.5522847 7,21 L7,3 C7,2.44771525 7.44771525,2 8,2 Z M20,4 C20.5522847,4 21,4.44771525 21,5 L21,19 C21,19.5522847 20.5522847,20 20,20 C19.4477153,20 19,19.5522847 19,19 L19,5 C19,4.44771525 19.4477153,4 20,4 Z M12,6 C12.5522847,6 13,6.44771525 13,7 L13,17 C13,17.5522847 12.5522847,18 12,18 C11.4477153,18 11,17.5522847 11,17 L11,7 C11,6.44771525 11.4477153,6 12,6 Z M4,9 C4.55228475,9 5,9.44771525 5,10 L5,14 C5,14.5522847 4.55228475,15 4,15 C3.44771525,15 3,14.5522847 3,14 L3,10 C3,9.44771525 3.44771525,9 4,9 Z M16,10 C16.5522847,10 17,10.4477153 17,11 L17,13 C17,13.5522847 16.5522847,14 16,14 C15.4477153,14 15,13.5522847 15,13 L15,11 C15,10.4477153 15.4477153,10 16,10 Z"/>
  </svg>
`;

const PROFILE_SPEAK_AUDIO_ICON_SVG = `
  <svg class="user-profile-speak-audio-icon" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true">
    <path d="M204.055 213.905q-18.12-5.28-34.61-9a145.92 145.92 0 0 1-6.78-44.33c0-65.61 42.17-118.8 94.19-118.8 52.02 0 94.15 53.14 94.15 118.76a146.3 146.3 0 0 1-6.16 42.32q-20.52 4.3-43.72 11.05c-22 6.42-39.79 12.78-48.56 16.05-8.72-3.27-26.51-9.63-48.51-16.05zm-127.95 84.94a55.16 55.16 0 1 0 55.16 55.15 55.16 55.16 0 0 0-55.16-55.15zm359.79 0a55.16 55.16 0 1 0 55.16 55.15 55.16 55.16 0 0 0-55.15-55.15zm-71.15 55.15a71.24 71.24 0 0 1 42.26-65v-77.55c-64.49 0-154.44 35.64-154.44 35.64s-89.95-35.64-154.44-35.64v74.92a71.14 71.14 0 0 1 0 135.28v7c64.49 0 154.44 41.58 154.44 41.58s89.99-41.55 154.44-41.55v-9.68a71.24 71.24 0 0 1-42.26-65z"/>
  </svg>
`;

const PROFILE_CHECK_ICON = (className) => `
  <svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
`;

const PROFILE_SAMPLES_COMPLETE_SVG = PROFILE_CHECK_ICON('user-profile-samples-complete-icon');

const PROFILE_RECORDING_MIC_SVG = `
  <svg class="compose-mic-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.03c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
  </svg>
`;

const PROFILE_RECORDING_ACCEPT_SVG = PROFILE_CHECK_ICON('compose-recording-send-icon');

const PROFILE_CLOSE_SESSION_ICON_SVG = `
  <svg class="user-profile-close-session-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
  </svg>
`;

const PROFILE_SHOW_SEED_ICON_SVG = `
  <svg class="user-profile-seed-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
  </svg>
`;

const PROFILE_HIDE_SEED_ICON_SVG = `
  <svg class="user-profile-seed-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
  </svg>
`;

const PROFILE_CREATE_ACCOUNT_ICON_SVG = `
  <svg class="user-profile-create-account-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
  </svg>
`;

const PROFILE_RECORDING_CANCEL_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
`;

const SUPER_USER_ID = 'u-super';
const VOICE_LANG_PREFIX = 'lingo-voice-lang:';

const PROFILE_VOICE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'th', name: 'Thai' },
];

let rootEl = null;
let menuOpen = false;
let voiceProfile = null;
let recordingSession = null;
let creatingVoice = false;
let savingSample = false;
let onUserChange = null;
let showToastFn = () => {};
let profileLanguages = [];
let voiceLang = 'en';

const MIN_SAMPLES = VOICE_SAMPLE_TARGET;

function toast(message) {
  showToastFn(message);
}

function getDisplayName(user) {
  return user?.name?.trim() || 'User';
}

function applyDisplayName(user) {
  return user;
}

function getVoiceLangStorageKey(userId) {
  return `${VOICE_LANG_PREFIX}${userId}`;
}

function loadVoiceLangPrefs(user) {
  if (!user) return;
  try {
    voiceLang = resolveVoiceLanguage(
      localStorage.getItem(getVoiceLangStorageKey(user.id))
      || localStorage.getItem(`${VOICE_LANG_PREFIX}primary:${user.id}`)
      || 'en',
    );
  } catch {
    voiceLang = 'en';
  }
}

function saveVoiceLangPref(userId, code) {
  if (!userId) return;
  try {
    localStorage.setItem(getVoiceLangStorageKey(userId), resolveVoiceLanguage(code));
  } catch {
    // ignore storage errors
  }
}

function updateVoicePromptText(panel) {
  const user = getStoredUser();
  if (!user) return;
  const state = getProfileState(user);
  const prompt = getVoicePrompt(
    voiceLang,
    nextPromptIndex(state.sampleCount, state.maxSamples),
  );
  const el = $('.user-profile-prompt-text', panel);
  if (el) el.textContent = `"${prompt}"`;
}

async function ensureProfileLanguages() {
  profileLanguages = [...PROFILE_VOICE_LANGUAGES];
}

function setupProfileLangPicker(panel, user) {
  const slot = $('#user-profile-lang', panel);
  if (!slot || !profileLanguages.length) return;

  slot.innerHTML = '';

  createLangPicker(slot, {
    languages: profileLanguages,
    value: voiceLang,
    onChange: (code) => {
      voiceLang = resolveVoiceLanguage(code);
      saveVoiceLangPref(user.id, voiceLang);
      renderMenuContent();
    },
    onFocusEdit: () => {
      hideAllLangPickerCarets();
    },
  });
}

function syncPanelPosition() {
  const bar = document.querySelector('.language-bar');
  const panel = $('#user-profile-panel', rootEl);
  if (!bar || !panel) return;
  panel.style.setProperty('--user-profile-panel-top', `${bar.getBoundingClientRect().bottom}px`);
}

function nextPromptIndex(sampleCount, maxSamples = MIN_SAMPLES) {
  return Math.min(sampleCount, maxSamples - 1);
}

function getProfileState(user) {
  const maxSamples = voiceProfile?.maxSamples ?? MIN_SAMPLES;
  const sampleCount = voiceProfile?.sampleCount ?? user?.voiceSampleCount ?? 0;
  const canRecordMore = voiceProfile?.canRecordMore ?? sampleCount < maxSamples;
  return {
    maxSamples,
    sampleCount,
    canRecordMore,
    voiceReady: voiceProfile?.voiceReady ?? user?.voiceReady ?? false,
    status: voiceProfile?.status ?? user?.voiceStatus ?? 'none',
    elevenlabsConfigured: voiceProfile?.elevenlabsConfigured !== false,
    samplesComplete: sampleCount >= maxSamples,
  };
}

function discardActiveRecording() {
  const session = recordingSession;
  if (!session) return;

  recordingSession = null;
  teardownProfileRecordingWave();
  try {
    if (session.recorder.state !== 'inactive') session.recorder.stop();
  } catch {
    // ignore stop errors when discarding
  }
  session.stream.getTracks().forEach((track) => track.stop());
}

function getProfileRecordingToolbar() {
  const panel = $('#user-profile-panel', rootEl);
  const levelEl = $('#user-voice-level', panel);
  const toolbar = levelEl?.closest('.user-profile-recording-toolbar');
  return { panel, levelEl, toolbar };
}

function startProfileWaveLoop() {
  cancelAnimationFrame(profileWaveRaf);
  const tick = () => {
    if (!recordingSession) return;
    const { levelEl, toolbar } = getProfileRecordingToolbar();
    profileMicWave.applyMicVoicePulse(levelEl, toolbar);
    profileWaveRaf = requestAnimationFrame(tick);
  };
  profileWaveRaf = requestAnimationFrame(tick);
}

function stopProfileWaveLoop() {
  if (profileWaveRaf) cancelAnimationFrame(profileWaveRaf);
  profileWaveRaf = null;
}

function setupProfileRecordingWave() {
  requestAnimationFrame(() => {
    if (!recordingSession) return;
    const { levelEl, toolbar } = getProfileRecordingToolbar();
    profileMicWave.ensureLevelBars(levelEl, toolbar, true);
    profileMicWave.observeWaveResize(levelEl, toolbar, () => Boolean(recordingSession));
    startProfileWaveLoop();
  });
}

function teardownProfileRecordingWave() {
  stopProfileWaveLoop();
  profileMicWave.unobserveWaveResize();
  profileMicWave.teardownMicMeter();
}

function stopMediaRecorder(recorder) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Recording stop timed out — try again')), 8000);
    const finish = (err) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    recorder.addEventListener('stop', () => finish(), { once: true });
    recorder.addEventListener('error', () => finish(new Error('Recording failed')), { once: true });

    if (recorder.state === 'recording') {
      try {
        recorder.requestData();
      } catch {
        // not supported in every browser
      }
      recorder.stop();
    } else if (recorder.state === 'inactive') {
      finish();
    }
  });
}

async function maybeEnsureVoiceConfigured() {
  const user = getStoredUser();
  if (!user || creatingVoice || recordingSession || savingSample) return;

  const state = getProfileState(user);
  if (state.samplesComplete && state.elevenlabsConfigured && !state.voiceReady) {
    await createVoiceProfile(false);
  }
}

function renderMenuContent() {
  const user = getStoredUser();
  const panel = $('#user-profile-panel', rootEl);
  if (!panel || !user) return;

  loadVoiceLangPrefs(user);
  const ui = getVoiceUi(voiceLang);
  const state = getProfileState(user);
  const {
    maxSamples,
    sampleCount,
    canRecordMore,
    samplesComplete,
  } = state;
  const prompt = getVoicePrompt(voiceLang, nextPromptIndex(sampleCount, maxSamples));
  const isRecording = Boolean(recordingSession);
  const recordingAtLimit = isRecording && !canRecordMore;
  const showRecord = canRecordMore && !isRecording && !creatingVoice && !savingSample;
  const busy = isRecording || savingSample || creatingVoice;
  const savedCount = Math.min(sampleCount, maxSamples);
  const cloneLanguageList = formatCloneVoiceLanguageList(voiceLang);

  panel.innerHTML = `
    <div class="user-profile-meta-row">
      <div class="user-profile-samples-group">
        <div class="user-profile-samples-saved" title="${escapeHtml(ui.samplesSaved)}" aria-label="${escapeHtml(ui.samplesSaved)}: ${savedCount}/${maxSamples}">
          ${PROFILE_SAMPLES_SAVED_ICON_SVG}
          <span class="user-profile-samples-count">${savedCount}/${maxSamples}</span>
        </div>
        ${samplesComplete ? `
        <span class="user-profile-samples-complete" title="${escapeHtml(ui.enoughSamples)}" aria-label="${escapeHtml(ui.enoughSamples)}">
          ${PROFILE_SAMPLES_COMPLETE_SVG}
        </span>
        ` : savedCount > 0 ? `
        <button
          type="button"
          class="user-profile-samples-reset user-profile-icon-btn"
          id="user-profile-samples-reset"
          title="${escapeHtml(ui.resetSamples)}"
          aria-label="${escapeHtml(ui.resetSamples)}"
          ${busy ? 'disabled' : ''}
        >
          ${PROFILE_RECORDING_CANCEL_SVG}
        </button>
        ` : ''}
      </div>
      <div class="user-profile-lang-slot user-profile-prompt-lang" id="user-profile-lang"></div>
    </div>

    ${recordingAtLimit ? `<p class="user-profile-note">${ui.recordingBlocked}</p>` : ''}

    ${showRecord || (isRecording && !recordingAtLimit) ? `
    <div class="user-profile-prompt">
      <div class="user-profile-prompt-line">
        <div class="user-profile-prompt-label" title="${escapeHtml(ui.readNext)}" aria-label="${escapeHtml(ui.readNext)}">
          ${PROFILE_SPEAK_AUDIO_ICON_SVG}
        </div>
        <p class="user-profile-prompt-text">"${escapeHtml(prompt)}"</p>
      </div>
    </div>
    ` : ''}

    <div class="user-profile-actions${isRecording ? ' user-profile-actions--recording' : ''}">
      ${isRecording ? `
      <div class="compose-toolbar user-profile-recording-toolbar">
        <div class="compose-toolbar-left">
          <button
            type="button"
            class="compose-recording-cancel"
            id="user-voice-cancel-btn"
            title="${escapeHtml(ui.cancelRecording)}"
            aria-label="${escapeHtml(ui.cancelRecording)}"
            ${savingSample ? 'disabled' : ''}
          >
            ${PROFILE_RECORDING_CANCEL_SVG}
          </button>
        </div>
        <div class="compose-toolbar-center">
          <div class="compose-level" id="user-voice-level" aria-hidden="true"></div>
        </div>
        <div class="compose-toolbar-right">
          <button
            type="button"
            class="compose-recording-send user-profile-recording-accept"
            id="user-voice-stop-btn"
            title="${escapeHtml(ui.stopSample)}"
            aria-label="${escapeHtml(ui.stopSample)}"
            ${savingSample ? 'disabled' : ''}
          >
            ${PROFILE_RECORDING_ACCEPT_SVG}
          </button>
        </div>
      </div>
      ` : showRecord ? `
      <div class="user-profile-mic-action">
        <button
          type="button"
          class="user-profile-record-mic user-profile-record-mic--solo"
          id="user-voice-record-btn"
          title="${escapeHtml(ui.recordSample)}"
          aria-label="${escapeHtml(ui.recordSample)}"
        >
          ${PROFILE_RECORDING_MIC_SVG}
        </button>
      </div>
      ` : ''}
    </div>

    <div class="user-profile-session-area">
      <div class="user-profile-session-bar">
        <button
          type="button"
          class="user-profile-session-toggle"
          id="user-profile-session-toggle"
          aria-expanded="false"
          aria-controls="user-profile-session-row"
          aria-label="Session options"
        >&gt;_</button>
        <div class="user-profile-session-row" id="user-profile-session-row" hidden>
          <div class="user-profile-session-drawer" id="user-profile-session-drawer">
            ${user.id === SUPER_USER_ID ? `
            <button
              type="button"
              class="user-profile-create-account user-profile-session-icon-btn"
              id="user-profile-create-account"
              title="${escapeHtml(ui.createAccount)}"
              aria-label="${escapeHtml(ui.createAccount)}"
            >${PROFILE_CREATE_ACCOUNT_ICON_SVG}</button>
            ` : ''}
            <button
              type="button"
              class="user-profile-recovery-btn user-profile-session-icon-btn"
              id="user-profile-recovery-toggle"
              title="${escapeHtml(ui.showRecoveryPhrase)}"
              aria-label="${escapeHtml(ui.showRecoveryPhrase)}"
            >${PROFILE_SHOW_SEED_ICON_SVG}</button>
          </div>
          <span class="user-profile-session-spacer" aria-hidden="true"></span>
          <div class="user-profile-session-end">
            <button
              type="button"
              class="user-profile-clone-languages-toggle user-profile-session-icon-btn"
              id="user-profile-clone-languages-toggle"
              aria-expanded="false"
              aria-controls="user-profile-clone-languages-text"
              title="${escapeHtml(ui.showCloneVoiceLanguages)}"
              aria-label="${escapeHtml(ui.showCloneVoiceLanguages)}"
            >*</button>
            <button
              type="button"
              class="user-profile-signout user-profile-session-icon-btn"
              id="user-profile-signout"
              title="${escapeHtml(ui.switchUser)}"
              aria-label="${escapeHtml(ui.switchUser)}"
            >
              ${PROFILE_CLOSE_SESSION_ICON_SVG}
            </button>
          </div>
        </div>
      </div>
      <p
        class="user-profile-clone-languages-text"
        id="user-profile-clone-languages-text"
        hidden
      >
        <span class="user-profile-clone-languages-label">${escapeHtml(ui.cloneVoiceLanguagesFootnote)}:</span>
        ${escapeHtml(cloneLanguageList)}
      </p>
      <p class="user-profile-recovery-text" id="user-profile-recovery-text" hidden></p>
      <p class="user-profile-recovery-text user-profile-admin-seed" id="user-profile-admin-seed" hidden></p>
    </div>
  `;

  $('#user-voice-record-btn', panel)?.addEventListener('click', () => void startVoiceSampleRecording());
  $('#user-voice-stop-btn', panel)?.addEventListener('click', () => void stopVoiceSampleRecording());
  $('#user-voice-cancel-btn', panel)?.addEventListener('click', () => cancelVoiceSampleRecording());
  $('#user-profile-samples-reset', panel)?.addEventListener('click', () => void resetAllVoiceSamples());
  $('#user-profile-signout', panel)?.addEventListener('click', () => signOut());
  $('#user-profile-create-account', panel)?.addEventListener('click', () => void createAdminAccount(panel));

  const sessionRow = $('#user-profile-session-row', panel);
  const sessionToggle = $('#user-profile-session-toggle', panel);
  const recoveryToggle = $('#user-profile-recovery-toggle', panel);
  const recoveryText = $('#user-profile-recovery-text', panel);
  const cloneLangToggle = $('#user-profile-clone-languages-toggle', panel);
  const cloneLangText = $('#user-profile-clone-languages-text', panel);

  const setCloneLanguagesOpen = (open) => {
    if (!cloneLangToggle || !cloneLangText) return;
    cloneLangText.hidden = !open;
    cloneLangToggle.setAttribute('aria-expanded', String(open));
    cloneLangToggle.title = open ? ui.hideCloneVoiceLanguages : ui.showCloneVoiceLanguages;
    cloneLangToggle.setAttribute('aria-label', open ? ui.hideCloneVoiceLanguages : ui.showCloneVoiceLanguages);
  };

  sessionToggle?.addEventListener('click', () => {
    const opening = sessionRow?.hidden;
    if (!sessionRow || !sessionToggle) return;

    sessionRow.hidden = !opening;
    sessionToggle.setAttribute('aria-expanded', String(opening));

    if (!opening) {
      setCloneLanguagesOpen(false);
      if (recoveryText) {
        recoveryText.hidden = true;
        recoveryText.textContent = '';
      }
      const adminSeed = $('#user-profile-admin-seed', panel);
      if (adminSeed) {
        adminSeed.hidden = true;
        adminSeed.textContent = '';
      }
      setRecoveryToggleUi(recoveryToggle, voiceLang, false);
    }
  });

  cloneLangToggle?.addEventListener('click', () => {
    setCloneLanguagesOpen(cloneLangText?.hidden);
  });

  recoveryToggle?.addEventListener('click', () => {
    const uiStrings = getVoiceUi(voiceLang);
    const visible = !recoveryText?.hidden;
    if (visible) {
      recoveryText.hidden = true;
      recoveryText.textContent = '';
      setRecoveryToggleUi(recoveryToggle, voiceLang, false);
      return;
    }

    const phrase = getRecoveryPhrase(user.id) || getAuthToken() || '';
    if (!phrase) {
      recoveryText.textContent = uiStrings.recoveryPhraseMissing;
    } else {
      recoveryText.textContent = phrase;
    }
    recoveryText.hidden = false;
    setRecoveryToggleUi(recoveryToggle, voiceLang, true);
  });

  setupProfileLangPicker(panel, user);
}

async function createAdminAccount(panel) {
  const uiStrings = getVoiceUi(voiceLang);
  const button = $('#user-profile-create-account', panel);
  const adminSeed = $('#user-profile-admin-seed', panel);
  const recoveryText = $('#user-profile-recovery-text', panel);
  if (button) button.disabled = true;

  try {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || uiStrings.createAccountFailed);
      return;
    }

    if (recoveryText) {
      recoveryText.hidden = true;
      recoveryText.textContent = '';
    }
    if (adminSeed) {
      adminSeed.textContent = data.recoveryPhrase || '';
      adminSeed.hidden = !data.recoveryPhrase;
    }
  } catch {
    window.alert(uiStrings.createAccountFailed);
  } finally {
    if (button) button.disabled = false;
  }
}

function setRecoveryToggleUi(recoveryToggle, voiceLang, showingPhrase) {
  if (!recoveryToggle) return;
  const uiStrings = getVoiceUi(voiceLang);
  recoveryToggle.innerHTML = showingPhrase
    ? PROFILE_HIDE_SEED_ICON_SVG
    : PROFILE_SHOW_SEED_ICON_SVG;
  const label = showingPhrase ? uiStrings.hideRecoveryPhrase : uiStrings.showRecoveryPhrase;
  recoveryToggle.setAttribute('aria-label', label);
  recoveryToggle.setAttribute('title', label);
}

function getTriggerVisualState(user) {
  if (menuOpen) return 'open';
  const { samplesComplete, voiceReady } = getProfileState(user);
  if (voiceReady || samplesComplete) return 'ready';
  return 'setup';
}

function updateTrigger() {
  const user = getStoredUser();
  const trigger = $('#user-profile-trigger', rootEl);
  if (!trigger) return;

  const visual = getTriggerVisualState(user);
  trigger.dataset.visual = visual;

  const name = getDisplayName(user) || 'User';
  const labels = {
    open: `Close ${name} profile`,
    ready: `Close ${name} profile`,
    setup: `Open ${name} profile`,
  };
  trigger.title = labels[visual];
  trigger.setAttribute('aria-label', labels[visual]);
}

function setMenuOpen(open) {
  menuOpen = open;
  if (!open && recordingSession) cancelVoiceSampleRecording();
  rootEl?.classList.toggle('is-open', open);
  const trigger = $('#user-profile-trigger', rootEl);
  const panel = $('#user-profile-panel', rootEl);
  trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (panel) panel.hidden = !open;
  if (open) {
    syncPanelPosition();
    window.addEventListener('resize', syncPanelPosition, { passive: true });
    window.addEventListener('scroll', syncPanelPosition, { passive: true });
  } else {
    window.removeEventListener('resize', syncPanelPosition);
    window.removeEventListener('scroll', syncPanelPosition);
  }
  updateTrigger();
}

async function refreshVoiceProfile() {
  const res = await apiFetch('/api/voice/profile');
  if (!res.ok) return;
  voiceProfile = await res.json();

  const user = getStoredUser();
  const state = getProfileState(user);
  if (!state.canRecordMore && recordingSession) {
    discardActiveRecording();
    toast(`Extra recording discarded — you already have ${state.maxSamples} samples`);
  }

  renderMenuContent();
  updateTrigger();
  await maybeEnsureVoiceConfigured();
}

export async function refreshUserSession() {
  const data = await fetchCurrentUser();
  if (data?.user) {
    setStoredUser(applyDisplayName(data.user));
    voiceProfile = data.voiceProfile ? {
      ...data.voiceProfile,
      samples: [],
    } : null;
    await refreshVoiceProfile();
  }
  updateTrigger();
  renderMenuContent();
  onUserChange?.(getStoredUser());
}

async function startVoiceSampleRecording() {
  if (recordingSession) return;

  const user = getStoredUser();
  const maxSamples = voiceProfile?.maxSamples ?? MIN_SAMPLES;
  const sampleCount = voiceProfile?.sampleCount ?? user?.voiceSampleCount ?? 0;
  const canRecordMore = voiceProfile?.canRecordMore ?? sampleCount < maxSamples;
  if (!canRecordMore) {
    toast(`You already have ${maxSamples} voice samples`);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mimeType = getRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    const chunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recordingSession = {
      stream,
      recorder,
      chunks,
      mimeType: recorder.mimeType || mimeType || 'audio/webm',
      startedAt: Date.now(),
    };

    recorder.start(250);
    profileMicWave.primeMicAudioOnGesture();
    profileMicWave.prepareMicMeter(stream);
    renderMenuContent();
    setupProfileRecordingWave();
  } catch {
    toast('Microphone access is required to record voice samples');
  }
}

function cancelVoiceSampleRecording() {
  discardActiveRecording();
  renderMenuContent();
}

async function stopVoiceSampleRecording() {
  const session = recordingSession;
  if (!session || savingSample) return;

  const user = getStoredUser();
  const state = getProfileState(user);
  if (!state.canRecordMore) {
    cancelVoiceSampleRecording();
    toast(`You already have ${state.maxSamples} samples`);
    return;
  }

  savingSample = true;
  renderMenuContent();

  try {
    await stopMediaRecorder(session.recorder);
    teardownProfileRecordingWave();
    session.stream.getTracks().forEach((track) => track.stop());
    recordingSession = null;

    const durationMs = Date.now() - session.startedAt;
    if (durationMs < 1200) {
      toast('Record a little longer — at least 2 seconds');
      return;
    }

    const blob = new Blob(session.chunks, { type: session.mimeType });
    if (!blob.size) {
      toast('No audio captured — try again');
      return;
    }

    const form = new FormData();
    form.append('audio', blob, `voice-sample.${session.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);

    const res = await apiFetch('/api/voice/samples', {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || 'Could not save voice sample');
      renderMenuContent();
      return;
    }

    toast('Voice sample saved');
    await refreshUserSession();

    if (data.readyForClone && voiceProfile?.elevenlabsConfigured !== false && !getStoredUser()?.voiceReady) {
      await createVoiceProfile(false);
    }
  } catch (err) {
    toast(err.message || 'Could not save voice sample');
    renderMenuContent();
  } finally {
    savingSample = false;
    if (recordingSession) discardActiveRecording();
    else teardownProfileRecordingWave();
    session.stream.getTracks().forEach((track) => track.stop());
    renderMenuContent();
  }
}

async function resetAllVoiceSamples() {
  if (recordingSession || savingSample || creatingVoice) return;

  const user = getStoredUser();
  const ui = getVoiceUi(user?.nativeLanguage);
  if (!window.confirm(ui.confirmRecordAgain)) return;

  const res = await apiFetch('/api/voice/samples', { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(data.error || 'Could not reset samples');
    return;
  }
  toast(ui.recordAgain);
  await refreshUserSession();
}

async function createVoiceProfile(isUpdate) {
  if (creatingVoice) return;
  creatingVoice = true;
  renderMenuContent();

  try {
    const res = await apiFetch('/api/voice/create', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || 'Could not create voice profile');
      renderMenuContent();
      return;
    }
    toast(isUpdate ? 'Voice profile updated' : 'Personal voice ready');
    await refreshUserSession();
  } catch (err) {
    toast(err.message || 'Could not create voice profile');
    renderMenuContent();
  } finally {
    creatingVoice = false;
    renderMenuContent();
  }
}

function signOut() {
  const user = getStoredUser();
  discardActiveRecording();
  clearAuthSession(user?.id);
  setMenuOpen(false);
  window.dispatchEvent(new CustomEvent('lingo:unauthorized'));
}

function bindMenuEvents() {
  const trigger = $('#user-profile-trigger', rootEl);
  const panel = $('#user-profile-panel', rootEl);

  trigger?.addEventListener('click', async (event) => {
    event.stopPropagation();
    const nextOpen = !menuOpen;
    setMenuOpen(nextOpen);
    if (nextOpen) {
      await ensureProfileLanguages();
      await refreshVoiceProfile();
      renderMenuContent();
      syncPanelPosition();
    }
  });

  panel?.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && recordingSession) {
      cancelVoiceSampleRecording();
    }
  });
}

export function initUserProfile(slotEl, { onChange, showToast } = {}) {
  if (!slotEl) return;
  onUserChange = onChange;
  showToastFn = showToast || (() => {});
  rootEl = document.createElement('div');
  rootEl.className = 'user-profile';
  rootEl.innerHTML = `
    <button type="button" class="user-profile-trigger" id="user-profile-trigger" data-visual="setup" aria-haspopup="true" aria-expanded="false">
      ${USER_PROFILE_TRIGGER_ICON}
    </button>
    <div class="user-profile-panel" id="user-profile-panel" hidden></div>
  `;
  slotEl.appendChild(rootEl);

  bindMenuEvents();
  void ensureProfileLanguages();
  updateTrigger();
  renderMenuContent();
}
