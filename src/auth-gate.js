import {
  normalizeClientPassphrase,
  saveRecoveryPhrase,
  setAuthToken,
  setStoredUser,
} from './auth.js';
import { attachBip39WordAutocomplete } from './bip39-word-autocomplete.js';
import { $ } from './dom-utils.js';

function showError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function setActiveTab(gate, tab) {
  gate.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.authTab === tab);
  });

  const signInPanel = $('#auth-panel-signin', gate);
  const registerPanel = $('#auth-panel-register', gate);
  const revealPanel = $('#auth-recovery-reveal', gate);
  const tabs = gate.querySelector('.auth-tabs');

  if (signInPanel) signInPanel.hidden = tab !== 'signin';
  if (registerPanel) registerPanel.hidden = tab !== 'register';
  if (revealPanel) revealPanel.hidden = true;
  tabs?.removeAttribute('hidden');
}

function showRecoveryReveal(gate, phrase) {
  const signInPanel = $('#auth-panel-signin', gate);
  const registerPanel = $('#auth-panel-register', gate);
  const reveal = $('#auth-recovery-reveal', gate);
  const text = $('#auth-mnemonic-text', gate);
  const continueBtn = $('#auth-continue-after-register', gate);
  const checkbox = $('#auth-saved-checkbox', gate);

  if (signInPanel) signInPanel.hidden = true;
  if (registerPanel) registerPanel.hidden = true;
  gate.querySelector('.auth-tabs')?.setAttribute('hidden', '');
  if (!reveal || !text || !continueBtn || !checkbox) return;

  text.textContent = phrase;
  checkbox.checked = false;
  continueBtn.disabled = true;
  reveal.hidden = false;
}

async function completeAuth({ gate, passphrase, user, onSuccess, onUnauthorized }) {
  const normalized = normalizeClientPassphrase(passphrase);
  setAuthToken(normalized);
  if (user) {
    setStoredUser(user);
    saveRecoveryPhrase(user.id, normalized);
  }
  gate.hidden = true;
  if (onUnauthorized) {
    window.removeEventListener('lingo:unauthorized', onUnauthorized);
  }
  await onSuccess?.(user);
}

export function mountAuthGate({
  gate,
  onSuccess,
  onUnauthorized,
}) {
  if (!gate) return;

  const signInForm = $('#auth-signin-form', gate);
  const registerForm = $('#auth-register-form', gate);
  const passphraseInput = $('#auth-passphrase-input', gate);
  const superPasswordInput = $('#auth-super-password', gate);
  const errorEl = $('#auth-error', gate);
  const copyBtn = $('#auth-copy-mnemonic', gate);
  const savedCheckbox = $('#auth-saved-checkbox', gate);
  const continueBtn = $('#auth-continue-after-register', gate);

  let pendingRecoveryPhrase = '';
  let pendingUser = null;

  if (passphraseInput) {
    attachBip39WordAutocomplete(
      passphraseInput,
      $('#auth-word-list', gate),
    );
  }

  gate.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab(gate, button.dataset.authTab);
      showError(errorEl, '');
    });
  });

  copyBtn?.addEventListener('click', async () => {
    const phrase = $('#auth-mnemonic-text', gate)?.textContent?.trim();
    if (!phrase) return;
    try {
      await navigator.clipboard.writeText(phrase);
      copyBtn.textContent = 'Copied';
      window.setTimeout(() => {
        copyBtn.textContent = 'Copy phrase';
      }, 1600);
    } catch {
      showError(errorEl, 'Could not copy — select and copy manually');
    }
  });

  savedCheckbox?.addEventListener('change', () => {
    if (continueBtn) continueBtn.disabled = !savedCheckbox.checked;
  });

  continueBtn?.addEventListener('click', async () => {
    if (!pendingRecoveryPhrase || !pendingUser) return;
    await completeAuth({
      gate,
      passphrase: pendingRecoveryPhrase,
      user: pendingUser,
      onSuccess,
      onUnauthorized,
    });
    pendingRecoveryPhrase = '';
    pendingUser = null;
  });

  signInForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError(errorEl, '');
    const submitBtn = signInForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const passphrase = normalizeClientPassphrase(passphraseInput?.value);
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showError(errorEl, data.error || 'Wrong recovery phrase or password');
        return;
      }

      await completeAuth({
        gate,
        passphrase,
        user: data.user,
        onSuccess,
        onUnauthorized,
      });
    } catch {
      showError(errorEl, 'Could not connect — try again');
    } finally {
      submitBtn.disabled = false;
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError(errorEl, '');
    const submitBtn = registerForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const superPassword = superPasswordInput?.value || '';
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ superPassword }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showError(errorEl, data.error || 'Could not create account');
        return;
      }

      pendingRecoveryPhrase = data.recoveryPhrase || '';
      pendingUser = data.user || null;
      if (superPasswordInput) superPasswordInput.value = '';
      showRecoveryReveal(gate, pendingRecoveryPhrase);
    } catch {
      showError(errorEl, 'Could not connect — try again');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

export function openAuthGate(gate) {
  if (!gate) return;
  gate.hidden = false;
  showError($('#auth-error', gate), '');
  setActiveTab(gate, 'signin');
  $('#auth-passphrase-input', gate)?.focus();
}

export function resetAuthGate(gate) {
  if (!gate) return;
  const input = $('#auth-passphrase-input', gate);
  if (input) input.value = '';
  const superPasswordInput = $('#auth-super-password', gate);
  if (superPasswordInput) superPasswordInput.value = '';
  const reveal = $('#auth-recovery-reveal', gate);
  if (reveal) reveal.hidden = true;
  const wordList = $('#auth-word-list', gate);
  if (wordList) {
    wordList.hidden = true;
    wordList.innerHTML = '';
  }
  setActiveTab(gate, 'signin');
}
