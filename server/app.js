import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import { LANGUAGE_NAMES, getLanguagesList } from './languages.js';
import {
  authVerifyRateLimit,
  converseRateLimit,
  getCorsOptions,
  isAuthRequired,
  requireAppAuth,
  speakRateLimit,
  verifyPassword,
} from './security.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

let openaiClient = null;

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-your-openai-api-key-here') {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function buildSystemPrompt(lang1, lang2) {
  const name1 = LANGUAGE_NAMES[lang1] || lang1;
  const name2 = LANGUAGE_NAMES[lang2] || lang2;

  return `You help two people have a casual real-time conversation between ${name1} (${lang1}) and ${name2} (${lang2}).

For every message:
1. Detect which language it is in (${lang1} or ${lang2}) — the speaker never tells you.
2. sourceText: rewrite what they said in the SAME language — natural, simple, casual, like real speech. Gently fix grammar, spelling, and awkward phrasing. Keep the meaning and friendly tone. Use conversation context when provided.
3. translatedText: translate to the OTHER language — equally natural, simple, and casual. Not formal, not robotic, not word-for-word stiff. How people actually talk.
4. Stay coherent with recent messages (names, pronouns, references).
5. Do NOT end sourceText or translatedText with a period or dot — these are chat messages meant to be copied and sent as-is.

IMPORTANT: detectedLanguage and targetLanguage must be exactly "${lang1}" or "${lang2}" (lowercase codes only).

Respond with JSON only:
{
  "detectedLanguage": "${lang1}" or "${lang2}",
  "sourceText": "improved casual version in original language",
  "translatedText": "natural casual translation",
  "targetLanguage": "${lang1}" or "${lang2}"
}`;
}

function normalizeLangCode(value, lang1, lang2) {
  if (!value) return null;
  const v = String(value).toLowerCase().trim();
  if (v === lang1 || v === lang2) return v;

  for (const code of [lang1, lang2]) {
    const name = (LANGUAGE_NAMES[code] || '').toLowerCase();
    if (v === name || v.includes(name)) return code;
  }
  return null;
}

function formatApiError(err) {
  const msg = err?.message || '';
  const status = err?.status;
  const code = err?.code || err?.error?.code;

  if (status === 429 || code === 'insufficient_quota' || msg.includes('quota') || msg.includes('billing')) {
    return 'OpenAI quota exceeded — add credits at platform.openai.com/account/billing';
  }
  if (msg.includes('Connection error') || err?.cause?.code === 'ECONNRESET') {
    return 'Connection error — check your internet';
  }
  if (status === 401 || msg.includes('Incorrect API key')) {
    return 'Invalid API key — check your environment variables';
  }
  return msg || 'Request failed';
}

async function withRetry(fn, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable =
        err?.cause?.code === 'ECONNRESET' ||
        err?.code === 'ECONNRESET' ||
        err?.message?.includes('Connection error');
      if (!retryable || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, attempt * 400));
    }
  }
  throw lastError;
}

function requireOpenAI(res) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'sk-your-openai-api-key-here') {
    res.status(500).json({ error: 'API key not configured' });
    return null;
  }
  const openai = getOpenAI();
  if (!openai) {
    res.status(500).json({ error: 'API key not configured' });
    return null;
  }
  return openai;
}

function stripTrailingPeriod(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/[.。．]+$/u, '').trimEnd();
}

async function translateText(openai, text, lang1, lang2, context) {
  const recentContext = context
    .slice(-2)
    .map((m) => `${m.detectedLanguage}: ${m.original} → ${m.translated}`)
    .join('\n');

  const userMessage = recentContext
    ? `Recent conversation:\n${recentContext}\n\nNew message:\n${text.trim()}`
    : text.trim();

  const completion = await withRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 280,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(lang1, lang2) },
        { role: 'user', content: userMessage },
      ],
    })
  );

  const result = JSON.parse(completion.choices[0]?.message?.content || '{}');

  const detected = normalizeLangCode(result.detectedLanguage, lang1, lang2)
    || normalizeLangCode(result.targetLanguage, lang1, lang2)
    || lang1;
  const target = detected === lang1 ? lang2 : lang1;

  return {
    detectedLanguage: detected,
    sourceText: stripTrailingPeriod(result.sourceText || text.trim()),
    translatedText: stripTrailingPeriod(result.translatedText || ''),
    targetLanguage: normalizeLangCode(result.targetLanguage, lang1, lang2) || target,
  };
}

async function transcribeAudio(openai, file) {
  try {
    return await withRetry(() =>
      openai.audio.transcriptions.create({ file, model: 'gpt-4o-mini-transcribe' })
    );
  } catch {
    return await withRetry(() =>
      openai.audio.transcriptions.create({ file, model: 'whisper-1' })
    );
  }
}

async function generateSpeech(openai, text) {
  const speech = await withRetry(() =>
    openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text.trim(),
      speed: 1.05,
    })
  );
  return Buffer.from(await speech.arrayBuffer());
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(cors(getCorsOptions()));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      authRequired: isAuthRequired(),
    });
  });

  app.post('/api/auth/verify', authVerifyRateLimit, (req, res) => {
    if (!isAuthRequired()) {
      return res.json({ ok: true });
    }

    const { password } = req.body || {};
    if (verifyPassword(password)) {
      return res.json({ ok: true });
    }

    res.status(401).json({ error: 'Wrong access code' });
  });

  app.get('/api/languages', requireAppAuth, (_req, res) => {
    res.json(getLanguagesList());
  });

  app.post('/api/converse', requireAppAuth, converseRateLimit, upload.single('audio'), async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const lang1 = req.body.lang1;
    const lang2 = req.body.lang2;
    let context = [];

    try {
      context = req.body.context ? JSON.parse(req.body.context) : [];
    } catch {
      context = [];
    }

    if (!lang1 || !lang2 || lang1 === lang2) {
      return res.status(400).json({ error: 'Select two different languages' });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio received' });
    }

    const mimeType = req.file.mimetype || 'audio/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';

    try {
      const file = await toFile(req.file.buffer, `audio.${ext}`, { type: mimeType });
      const transcription = await transcribeAudio(openai, file);
      const rawText = transcription.text?.trim();

      if (!rawText) {
        return res.status(400).json({ error: 'No speech detected' });
      }

      const translated = await translateText(openai, rawText, lang1, lang2, context);

      if (!translated.translatedText) {
        return res.status(500).json({ error: 'Could not translate message' });
      }

      res.json({ rawText, ...translated });
    } catch (err) {
      console.error('Converse error:', err);
      res.status(500).json({ error: formatApiError(err) });
    }
  });

  app.post('/api/speak', requireAppAuth, speakRateLimit, async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const { text } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    try {
      const buffer = await generateSpeech(openai, text);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch (err) {
      console.error('TTS error:', err);
      res.status(500).json({ error: formatApiError(err) });
    }
  });

  // Local production server only (not used on Vercel)
  if (process.env.VERCEL !== '1') {
    const distPath = path.join(__dirname, '..', 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}
