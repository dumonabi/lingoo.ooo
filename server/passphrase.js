import crypto from 'crypto';

export function normalizePassphrase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function hashPassphrase(passphrase) {
  const normalized = normalizePassphrase(passphrase);
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(normalized, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassphrase(passphrase, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) {
    return false;
  }

  const normalized = normalizePassphrase(passphrase);
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) return false;

  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== 64) return false;
    const actual = crypto.scryptSync(normalized, salt, 64);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
