const AUTH_KEY = 'lingo-access';

export function getAuthToken() {
  return sessionStorage.getItem(AUTH_KEY);
}

export function setAuthToken(token) {
  sessionStorage.setItem(AUTH_KEY, token);
}

export function clearAuthToken() {
  sessionStorage.removeItem(AUTH_KEY);
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
    clearAuthToken();
    window.dispatchEvent(new CustomEvent('lingo:unauthorized'));
  }

  return res;
}
