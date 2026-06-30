import crypto from 'crypto';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
  addStoredUser,
  ensureUserRegistryLoaded,
  findStoredUserById,
  getCachedUserRegistry,
} from './user-store.js';
import {
  hashPassphrase,
  normalizePassphrase,
  verifyPassphrase,
} from './passphrase.js';
import {
  getSuperUserRecord,
  verifySuperUserPassword,
} from './bootstrap-user.js';

function createUserId() {
  return `u-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function generateRecoveryPhrase() {
  return generateMnemonic(wordlist, 128);
}

export function isAuthRequired() {
  if (process.env.DISABLE_AUTH === '1') return false;
  return true;
}

function toPublicUser(record) {
  return {
    id: record.id,
    name: record.name,
    nativeLanguage: record.nativeLanguage || 'en',
    elevenlabsVoiceId: record.elevenlabsVoiceId || null,
  };
}

export async function findUserByPassphrase(attempt) {
  await ensureUserRegistryLoaded();
  if (typeof attempt !== 'string' || !attempt) return null;

  if (verifySuperUserPassword(attempt)) {
    return toPublicUser(getSuperUserRecord());
  }

  const normalized = normalizePassphrase(attempt);
  if (!normalized || !validateMnemonic(normalized, wordlist)) return null;

  for (const user of getCachedUserRegistry()) {
    if (user.passphraseHash && verifyPassphrase(normalized, user.passphraseHash)) {
      return toPublicUser(user);
    }
  }

  return null;
}

export function findUserByPassphraseSync(attempt) {
  if (typeof attempt !== 'string' || !attempt) return null;

  if (verifySuperUserPassword(attempt)) {
    return toPublicUser(getSuperUserRecord());
  }

  const normalized = normalizePassphrase(attempt);
  if (!normalized || !validateMnemonic(normalized, wordlist)) return null;

  for (const user of getCachedUserRegistry()) {
    if (user.passphraseHash && verifyPassphrase(normalized, user.passphraseHash)) {
      return toPublicUser(user);
    }
  }

  return null;
}

export async function getUserById(id) {
  if (!id) return null;
  const stored = await findStoredUserById(id);
  return stored ? toPublicUser(stored) : null;
}

export async function createUser({ name }) {
  const trimmedName = String(name || '').trim() || 'User';
  const mnemonic = generateRecoveryPhrase();
  const record = {
    id: createUserId(),
    name: trimmedName.slice(0, 48),
    nativeLanguage: 'en',
    elevenlabsVoiceId: null,
    passphraseHash: hashPassphrase(mnemonic),
    createdAt: Date.now(),
  };

  await addStoredUser(record);

  return {
    user: toPublicUser(record),
    recoveryPhrase: mnemonic,
  };
}

export function getGuestUser() {
  return { id: 'guest', name: 'Guest', nativeLanguage: 'en', elevenlabsVoiceId: null };
}

export function publicUserProfile(user, voiceProfile = null) {
  const voiceReady = Boolean(
    voiceProfile?.elevenlabsVoiceId || user?.elevenlabsVoiceId
  );

  return {
    id: user.id,
    name: user.name,
    nativeLanguage: user.nativeLanguage || 'en',
    voiceReady,
    voiceSampleCount: voiceProfile?.samples?.length || 0,
    voiceStatus: voiceProfile?.status || (voiceReady ? 'ready' : 'none'),
  };
}
