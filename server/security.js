import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export function getAppPassword() {
  const password = process.env.APP_PASSWORD?.trim();
  return password || null;
}

export function isAuthRequired() {
  return Boolean(getAppPassword());
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPassword(attempt) {
  const password = getAppPassword();
  if (!password) return true;
  if (typeof attempt !== 'string' || !attempt) return false;
  return timingSafeEqual(attempt, password);
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function createLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
    message: { error: message },
    handler: (_req, res) => {
      res.status(429).json({ error: message });
    },
  });
}

export const converseRateLimit = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: 'Too many messages this hour — try again later',
});

export const speakRateLimit = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 400,
  message: 'Too many audio requests this hour — try again later',
});

export const authVerifyRateLimit = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: 'Too many login attempts — try again later',
});

export function requireAppAuth(req, res, next) {
  if (!isAuthRequired()) return next();

  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (token && verifyPassword(token)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function isLocalOrigin(origin) {
  return /^https?:\/\/localhost(:\d+)?$/.test(origin)
    || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
}

function isVercelOrigin(origin) {
  return /^https:\/\/lingu-ooo(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)
    || /^https:\/\/linguooo(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)
    || /^https:\/\/lingu-ooo-[a-z0-9-]+-[^/]+\.vercel\.app$/.test(origin)
    || /^https:\/\/linguooo-[a-z0-9-]+-[^/]+\.vercel\.app$/.test(origin)
    || /^https:\/\/lingoo-ooo(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)
    || /^https:\/\/lingoo-ooo-[a-z0-9-]+-[^/]+\.vercel\.app$/.test(origin);
}

export function getCorsOptions() {
  const extraOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (isLocalOrigin(origin)) return callback(null, true);
      if (origin === 'https://lingu-ooo.vercel.app') return callback(null, true);
      if (origin === 'https://linguooo.vercel.app') return callback(null, true);
      if (origin === 'https://lingoo-ooo.vercel.app') return callback(null, true);
      if (origin === 'https://lingo-self.vercel.app') return callback(null, true);
      if (vercelUrl && origin === vercelUrl) return callback(null, true);
      if (isVercelOrigin(origin)) return callback(null, true);
      if (extraOrigins.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
  };
}
