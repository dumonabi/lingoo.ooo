const DB_NAME = 'lingu-pending';
const STORE = 'recordings';
const DB_VERSION = 1;
const MAX_PENDING = 12;

const memoryFallback = new Map();

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    fn(store);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  }));
}

function rememberInMemory(recording) {
  memoryFallback.set(recording.id, recording);
}

function forgetInMemory(id) {
  memoryFallback.delete(id);
}

export async function savePendingRecording(recording) {
  const payload = {
    attempts: 0,
    lastError: '',
    ...recording,
  };

  try {
    const existing = await listPendingRecordings();
    if (!existing.some((item) => item.id === payload.id) && existing.length >= MAX_PENDING) {
      throw new Error('Too many saved messages — send or dismiss older ones first');
    }
    await runTransaction('readwrite', (store) => store.put(payload));
    rememberInMemory(payload);
  } catch (err) {
    rememberInMemory(payload);
    if (err.message?.includes('Too many saved')) throw err;
  }
}

export async function updatePendingRecording(id, patch) {
  const items = await listPendingRecordings();
  const current = items.find((item) => item.id === id);
  if (!current) return;

  const next = { ...current, ...patch };
  try {
    await runTransaction('readwrite', (store) => store.put(next));
  } catch {
    // IndexedDB unavailable — memory copy still updated below
  }
  rememberInMemory(next);
}

export async function removePendingRecording(id) {
  forgetInMemory(id);
  try {
    await runTransaction('readwrite', (store) => store.delete(id));
  } catch {
    // already removed from memory
  }
}

export async function listPendingRecordings() {
  const merged = new Map(memoryFallback);

  try {
    const db = await openDb();
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    db.close();
    for (const item of items) merged.set(item.id, item);
  } catch {
    // private mode / blocked storage — memory fallback only
  }

  return Array.from(merged.values());
}

export function isRetryableSendError(err, res) {
  if (err?.retryable === false) return false;
  if (err?.retryable === true) return true;
  if (!res) return true;

  const status = res.status;
  if (status === 401 || status === 400 || status === 413) return false;
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) return true;

  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('connect')
    || msg.includes('network')
    || msg.includes('failed to fetch')
    || msg.includes('load failed')
    || msg.includes('timed out')
    || msg.includes('timeout')
    || msg.includes('aborted');
}

export function retryDelayMs(attempt) {
  return Math.min(1500 * (2 ** Math.max(attempt - 1, 0)), 12000);
}
