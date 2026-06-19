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

const MAX_RECORDING_MS = 60_000;

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
3. translatedText: translate to the OTHER language — equally natural, simple, and casual. Not formal, not robotic, not word-for-word stiff. How people actually talk. Use only the target language — no English words mixed into Spanish (or vice versa) unless they are universal loanwords like "OK".
4. Stay coherent with recent messages (names, pronouns, references).
5. Do NOT end sourceText or translatedText with a period or dot — these are chat messages meant to be copied and sent as-is.

IMPORTANT: The ONLY languages in this conversation are ${name1} (${lang1}) and ${name2} (${lang2}). Never translate into English or any other language unless it is exactly ${lang1} or ${lang2}. When targetLanguage is "${lang2}", translatedText must be in ${name2}; when targetLanguage is "${lang1}", translatedText must be in ${name1}.

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

function textScriptHint(text) {
  if (!text) return 'unknown';
  if (/[\u0E00-\u0E7F]/.test(text)) return 'thai';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'cjk';
  if (/[\u3040-\u30FF]/.test(text)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  if (/[\u0400-\u04FF]/.test(text)) return 'cyrillic';
  if (/[\u0600-\u06FF]/.test(text)) return 'arabic';
  if (/[a-zA-ZáéíóúñüÁÉÍÓÚÑ¿¡]/.test(text)) return 'latin';
  return 'unknown';
}

const LATIN_LANGS = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ca', 'nl', 'sv', 'da', 'no', 'fi',
  'pl', 'cs', 'sk', 'ro', 'hu', 'tr', 'vi', 'id', 'ms', 'tl', 'sw', 'af',
]);

const LATIN_MARKER_PATTERNS = {
  es: /\b(el|la|los|las|de|que|y|en|un|una|es|por|con|no|se|lo|le|su|para|muy|pero|bien|hola|gracias|qué|cómo|está|también|ahora|solo|puedo|quiero|tengo|hay|esto|eso|aquí|donde|cuando|porque|algo|nada|más|muy|bueno|vale|claro)\b/gi,
  en: /\b(the|and|is|are|was|were|you|your|have|has|this|that|with|for|not|but|what|how|hello|thanks|please|can|will|just|from|they|been|would|could|about|into|there|their|when|where|because|something|nothing|more|very|good|okay|right)\b/gi,
  pt: /\b(o|a|os|as|de|que|e|em|um|uma|não|se|lo|la|por|com|para|muito|mas|bem|olá|obrigad|está|também|agora|só|posso|quero|tenho|há|isto|isso|aqui)\b/gi,
  fr: /\b(le|la|les|de|que|et|en|un|une|est|pas|se|pour|avec|dans|sur|très|mais|bien|bonjour|merci|comment|aussi|maintenant|je|tu|il|elle|nous|vous|ils|elles|ce|ça|ici)\b/gi,
};

function scoreLatinLanguage(text, code) {
  if (!text || !LATIN_MARKER_PATTERNS[code]) return 0;
  const lower = text.toLowerCase();
  let score = (lower.match(LATIN_MARKER_PATTERNS[code]) || []).length;
  if (code === 'es') score += (lower.match(/[ñáéíóúü¿¡]/g) || []).length * 2;
  if (code === 'pt') score += (lower.match(/[ãõçáéíóú]/g) || []).length * 1.5;
  if (code === 'fr') score += (lower.match(/[àâçéèêëîïôùûü]/g) || []).length * 1.5;
  return score;
}

function likelyLatinLanguage(text, lang1, lang2) {
  if (!LATIN_LANGS.has(lang1) || !LATIN_LANGS.has(lang2)) return null;
  const s1 = scoreLatinLanguage(text, lang1);
  const s2 = scoreLatinLanguage(text, lang2);
  if (s1 === s2) return null;
  return s1 > s2 ? lang1 : lang2;
}

function hintMatchesLang(hint, code) {
  if (hint === 'unknown') return null;
  if (hint === 'thai') return code === 'th';
  if (hint === 'cjk') return ['zh', 'yue', 'wuu'].includes(code);
  if (hint === 'ja') return code === 'ja';
  if (hint === 'ko') return code === 'ko';
  if (hint === 'cyrillic') return ['ru', 'uk', 'bg', 'sr', 'mk'].includes(code);
  if (hint === 'arabic') return ['ar', 'fa', 'ur', 'he'].includes(code);
  if (hint === 'latin') return null;
  return null;
}

function alignTranslationFields(sourceText, translatedText, detected, target) {
  const sourceLikely = likelyLatinLanguage(sourceText, detected, target);
  const translatedLikely = likelyLatinLanguage(translatedText, detected, target);

  if (sourceLikely === target && translatedLikely === detected) {
    return { sourceText: translatedText, translatedText: sourceText };
  }
  if (sourceLikely === detected && translatedLikely === target) {
    return { sourceText: sourceText, translatedText: translatedText };
  }

  let source = sourceText;
  let translated = translatedText;
  const sourceHint = textScriptHint(source);
  const translatedHint = textScriptHint(translated);

  const sourceOk = hintMatchesLang(sourceHint, detected);
  const translatedOk = hintMatchesLang(translatedHint, target);

  if (sourceOk === false && translatedOk === true) {
    return { sourceText: translated, translatedText: source };
  }
  if (sourceOk === true && translatedOk === false) {
    return { sourceText: source, translatedText: translated };
  }
  if (sourceOk === false && translatedOk === false && sourceHint !== 'unknown' && translatedHint !== 'unknown') {
    const sourceLooksTarget = hintMatchesLang(sourceHint, target);
    const translatedLooksDetected = hintMatchesLang(translatedHint, detected);
    if (sourceLooksTarget === true && translatedLooksDetected === true) {
      return { sourceText: translated, translatedText: source };
    }
  }

  return { sourceText: source, translatedText: translated };
}

function inferDetectedFromText(text, lang1, lang2) {
  const hint = textScriptHint(text);
  if (hintMatchesLang(hint, lang1) === true) return lang1;
  if (hintMatchesLang(hint, lang2) === true) return lang2;
  const likely = likelyLatinLanguage(text, lang1, lang2);
  if (likely) return likely;
  return null;
}

async function translateText(openai, text, lang1, lang2, context) {
  const name1 = LANGUAGE_NAMES[lang1] || lang1;
  const name2 = LANGUAGE_NAMES[lang2] || lang2;

  const recentContext = context
    .filter((m) => [lang1, lang2].includes(m.detectedLanguage))
    .slice(-2)
    .map((m) => `${m.detectedLanguage}: ${m.original} → ${m.translated}`)
    .join('\n');

  const userMessage = recentContext
    ? `Language pair: ${name1} (${lang1}) ↔ ${name2} (${lang2}) only.\n\nRecent conversation:\n${recentContext}\n\nNew message:\n${text.trim()}`
    : `Language pair: ${name1} (${lang1}) ↔ ${name2} (${lang2}) only.\n\nNew message:\n${text.trim()}`;

  const completion = await withRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.35,
      max_tokens: 220,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(lang1, lang2) },
        { role: 'user', content: userMessage },
      ],
    })
  );

  const result = JSON.parse(completion.choices[0]?.message?.content || '{}');

  let detected = normalizeLangCode(result.detectedLanguage, lang1, lang2)
    || inferDetectedFromText(text, lang1, lang2)
    || normalizeLangCode(result.targetLanguage, lang1, lang2)
    || lang1;
  const target = detected === lang1 ? lang2 : lang1;

  let sourceText = stripTrailingPeriod(result.sourceText || text.trim());
  let translatedText = stripTrailingPeriod(result.translatedText || '');

  const aligned = alignTranslationFields(sourceText, translatedText, detected, target);
  sourceText = aligned.sourceText;
  translatedText = aligned.translatedText;

  return {
    detectedLanguage: detected,
    sourceText,
    translatedText,
    targetLanguage: target,
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

async function generateSpeech(openai, text, lang) {
  const input = prepareTextForSpeech(text, lang);
  if (!input) {
    throw new Error('No speakable text');
  }

  const speech = await withRetry(() =>
    openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input,
      speed: 1.08,
      response_format: 'mp3',
    }),
    2
  );
  return Buffer.from(await speech.arrayBuffer());
}

function prepareTextForSpeech(text, lang) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[…]/g, '...')
    .replace(/\s+/g, ' ');
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

    const lang1 = String(req.body.lang1 || '').toLowerCase().trim();
    const lang2 = String(req.body.lang2 || '').toLowerCase().trim();
    let context = [];

    try {
      context = req.body.context ? JSON.parse(req.body.context) : [];
    } catch {
      context = [];
    }

    if (!lang1 || !lang2 || lang1 === lang2) {
      return res.status(400).json({ error: 'Select two different languages' });
    }
    if (!LANGUAGE_NAMES[lang1] || !LANGUAGE_NAMES[lang2]) {
      return res.status(400).json({ error: 'Invalid language selection' });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio received' });
    }

    const durationMs = parseInt(req.body.durationMs, 10);
    if (Number.isFinite(durationMs) && durationMs > MAX_RECORDING_MS) {
      return res.status(400).json({ error: 'Recording too long — 1 minute max' });
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

      let audioBase64 = null;
      try {
        const audioBuffer = await generateSpeech(openai, translated.translatedText, translated.targetLanguage);
        audioBase64 = audioBuffer.toString('base64');
      } catch (ttsErr) {
        console.error('Inline TTS error:', ttsErr);
      }

      res.json({ rawText, ...translated, audioBase64 });
    } catch (err) {
      console.error('Converse error:', err);
      res.status(500).json({ error: formatApiError(err) });
    }
  });

  app.post('/api/speak', requireAppAuth, speakRateLimit, async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const { text, lang } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const langCode = lang ? String(lang).toLowerCase().trim() : null;

    try {
      const buffer = await generateSpeech(openai, text, langCode);
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
