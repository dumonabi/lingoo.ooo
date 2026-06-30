const AUTH_KEY = 'lingo-access';
const USER_KEY = 'lingo-user';
const RECOVERY_PREFIX = 'lingo-recovery:';

function readPersistedItem(key) {
  try {
    return localStorage.getItem(key) || sessionStorage.getItem(key);
  } catch {
    return sessionStorage.getItem(key);
  }
}

function writePersistedItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

function removePersistedItem(key) {
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

export function normalizeClientPassphrase(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function saveRecoveryPhrase(userId, phrase) {
  if (!userId || !phrase) return;
  try {
    localStorage.setItem(`${RECOVERY_PREFIX}${userId}`, normalizeClientPassphrase(phrase));
  } catch {
    // ignore storage errors
  }
}

export function getRecoveryPhrase(userId) {
  if (!userId) return '';
  try {
    return localStorage.getItem(`${RECOVERY_PREFIX}${userId}`)?.trim() || '';
  } catch {
    return '';
  }
}

export function clearRecoveryPhrase(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(`${RECOVERY_PREFIX}${userId}`);
  } catch {
    // ignore storage errors
  }
}

export function getAuthToken() {
  return readPersistedItem(AUTH_KEY);
}

export function setAuthToken(token) {
  const normalized = normalizeClientPassphrase(token);
  if (!normalized) {
    clearAuthToken();
    return;
  }
  writePersistedItem(AUTH_KEY, normalized);
}

export function clearAuthToken() {
  removePersistedItem(AUTH_KEY);
}

export function getStoredUser() {
  try {
    const raw = readPersistedItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (!user) {
    clearStoredUser();
    return;
  }
  writePersistedItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  removePersistedItem(USER_KEY);
}

export function clearAuthSession(userId = null) {
  clearAuthToken();
  clearStoredUser();
  if (userId) clearRecoveryPhrase(userId);
}

export function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function apiFetch(url, options = {}) {
  const headers = authHeaders(options.headers || {});
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    const user = getStoredUser();
    clearAuthSession(user?.id);
    window.dispatchEvent(new CustomEvent('lingo:unauthorized'));
  }

  return res;
}

export async function fetchCurrentUser() {
  const res = await apiFetch('/api/me');
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.user) return null;
  setStoredUser(data.user);
  return data;
}
