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
  voiceSampleRateLimit,
} from './security.js';
import {
  findUserByPassword,
  getGuestUser,
  publicUserProfile,
} from './users.js';
import {
  addVoiceSample,
  clearAllVoiceSamples,
  deleteVoiceSample,
  getVoiceProfile,
  listVoiceSampleBuffers,
  MAX_VOICE_SAMPLES,
  resolveVoiceId,
  saveVoiceClone,
} from './voice-store.js';
import {
  createVoiceClone,
  generateClonedSpeech,
  isElevenLabsConfigured,
} from './elevenlabs.js';
import {
  listCloneVoiceLanguageCodes,
  supportsClonedVoice,
} from './elevenlabs-languages.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
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

function buildStreamingSystemPrompt(lang1, lang2) {
  const name1 = LANGUAGE_NAMES[lang1] || lang1;
  const name2 = LANGUAGE_NAMES[lang2] || lang2;
  return `You translate between ${name1} and ${name2}. Detect which language the user wrote in, then output ONLY the translation in the other language. Never repeat the input. No quotes, labels, or JSON.`;
}

function buildTranslationUserMessage(text, lang1, lang2, context, detected) {
  const trimmed = text.trim();
  const source = detected || inferDetectedFromText(trimmed, lang1, lang2) || lang1;
  const target = source === lang1 ? lang2 : lang1;
  const fromName = LANGUAGE_NAMES[source] || source;
  const toName = LANGUAGE_NAMES[target] || target;
  const directive = `Translate from ${fromName} to ${toName}:\n${trimmed}`;

  const recentContext = context
    .filter((m) => [lang1, lang2].includes(m.detectedLanguage))
    .slice(-2)
    .map((m) => `${m.detectedLanguage}: ${m.original} → ${m.translated}`)
    .join('\n');

  return recentContext ? `${recentContext}\n\n${directive}` : directive;
}

function finalizeTranslation(rawText, translatedText, lang1, lang2, gptDetected = null, gptTarget = null) {
  let detected = normalizeLangCode(gptDetected, lang1, lang2)
    || inferDetectedFromText(rawText, lang1, lang2)
    || normalizeLangCode(gptTarget, lang1, lang2)
    || lang1;
  const target = detected === lang1 ? lang2 : lang1;

  const sourceText = stripTrailingPeriod(rawText.trim());
  let translated = stripTrailingPeriod(translatedText || '');

  const aligned = alignTranslationFields(sourceText, translated, detected, target);
  translated = aligned.translatedText === sourceText && aligned.sourceText !== sourceText
    ? aligned.sourceText
    : aligned.translatedText;

  return {
    detectedLanguage: detected,
    sourceText,
    translatedText: translated,
    targetLanguage: target,
  };
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

  if (msg.includes('Too many concurrent requests')) {
    return 'Voice service is busy — wait a moment and try again';
  }
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
  const l1Latin = LATIN_LANGS.has(lang1);
  const l2Latin = LATIN_LANGS.has(lang2);
  if (!l1Latin && !l2Latin) return null;
  if (l1Latin && !l2Latin) return lang1;
  if (l2Latin && !l1Latin) return lang2;

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

  if (hint === 'latin') {
    const l1Latin = LATIN_LANGS.has(lang1);
    const l2Latin = LATIN_LANGS.has(lang2);
    if (l1Latin && !l2Latin) return lang1;
    if (l2Latin && !l1Latin) return lang2;
  }

  const likely = likelyLatinLanguage(text, lang1, lang2);
  if (likely) return likely;
  return null;
}

async function translateTextStream(openai, text, lang1, lang2, context, onDelta, { detected } = {}) {
  const userMessage = buildTranslationUserMessage(text, lang1, lang2, context, detected);

  const stream = await withRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.25,
      max_tokens: 180,
      stream: true,
      messages: [
        { role: 'system', content: buildStreamingSystemPrompt(lang1, lang2) },
        { role: 'user', content: userMessage },
      ],
    })
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) onDelta(delta);
  }
}

function beginTranslationStream(res) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  return (obj) => {
    res.write(`${JSON.stringify(obj)}\n`);
  };
}

async function pipeTranslationStream(res, openai, rawText, lang1, lang2, context) {
  const writeLine = beginTranslationStream(res);
  writeLine({ event: 'transcript', rawText });

  const preDetected = inferDetectedFromText(rawText, lang1, lang2);

  let accumulated = '';
  await translateTextStream(openai, rawText, lang1, lang2, context, (chunk) => {
    accumulated += chunk;
    writeLine({ event: 'delta', text: chunk });
  }, { detected: preDetected });

  const translated = finalizeTranslation(rawText, accumulated, lang1, lang2, preDetected);

  if (!translated.translatedText) {
    writeLine({ event: 'error', error: 'Could not translate message' });
    res.end();
    return;
  }

  writeLine({ event: 'done', rawText, ...translated });
  res.end();
}

function parseConversationContext(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function validateLanguagePair(lang1, lang2, res) {
  if (!lang1 || !lang2 || lang1 === lang2) {
    res.status(400).json({ error: 'Select two different languages' });
    return false;
  }
  if (!LANGUAGE_NAMES[lang1] || !LANGUAGE_NAMES[lang2]) {
    res.status(400).json({ error: 'Invalid language selection' });
    return false;
  }
  return true;
}

function isRetryableTranscribeFallback(err) {
  const status = err?.status;
  if (status === 400 || status === 401 || status === 403 || status === 413) return false;
  if (status === 429) return false;
  const code = err?.code || err?.error?.code;
  if (code === 'insufficient_quota') return false;
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('quota') || msg.includes('billing')) return false;
  return true;
}

function buildTranscriptionPrompt(lang1, lang2) {
  const name1 = LANGUAGE_NAMES[lang1];
  const name2 = LANGUAGE_NAMES[lang2];
  if (!name1 || !name2) return undefined;
  return `The speaker may use ${name1} or ${name2}.`;
}

async function transcribeAudio(openai, file, { lang1, lang2 } = {}) {
  const prompt = buildTranscriptionPrompt(lang1, lang2);
  const primary = { file, model: 'gpt-4o-mini-transcribe' };
  if (prompt) primary.prompt = prompt;

  try {
    return await withRetry(() => openai.audio.transcriptions.create(primary));
  } catch (err) {
    if (!isRetryableTranscribeFallback(err)) throw err;
    const fallback = { file, model: 'whisper-1' };
    if (prompt) fallback.prompt = prompt;
    return await withRetry(() => openai.audio.transcriptions.create(fallback));
  }
}

const ttsCache = new Map();
const TTS_CACHE_MAX = 120;

function ttsCacheKey(text, lang, voiceId = null) {
  return `${voiceId || 'default'}|${lang || ''}|${prepareTextForSpeech(text, lang)}`;
}

function readTtsCache(key) {
  const hit = ttsCache.get(key);
  if (!hit) return null;
  ttsCache.delete(key);
  ttsCache.set(key, hit);
  return hit;
}

function writeTtsCache(key, buffer) {
  if (ttsCache.has(key)) ttsCache.delete(key);
  ttsCache.set(key, buffer);
  while (ttsCache.size > TTS_CACHE_MAX) {
    const oldest = ttsCache.keys().next().value;
    ttsCache.delete(oldest);
  }
}

async function generateSpeech(openai, text, lang, voiceId = null) {
  const input = prepareTextForSpeech(text, lang);
  if (!input) {
    throw new Error('No speakable text');
  }

  const cacheKey = ttsCacheKey(input, lang, voiceId);
  const cached = readTtsCache(cacheKey);
  if (cached) return cached;

  let buffer;
  if (voiceId && isElevenLabsConfigured() && supportsClonedVoice(lang)) {
    buffer = await generateClonedSpeech(input, voiceId);
  } else {
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
    buffer = Buffer.from(await speech.arrayBuffer());
  }

  writeTtsCache(cacheKey, buffer);
  return buffer;
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
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      authRequired: isAuthRequired(),
      cloneVoiceLanguages: listCloneVoiceLanguageCodes(),
    });
  });

  app.post('/api/auth/verify', authVerifyRateLimit, async (req, res) => {
    if (!isAuthRequired()) {
      const guest = getGuestUser();
      const voiceProfile = await getVoiceProfile(guest.id);
      return res.json({ ok: true, user: publicUserProfile(guest, voiceProfile) });
    }

    const { password } = req.body || {};
    const user = findUserByPassword(password);
    if (user) {
      const voiceProfile = await getVoiceProfile(user.id);
      return res.json({ ok: true, user: publicUserProfile(user, voiceProfile) });
    }

    res.status(401).json({ error: 'Wrong access code' });
  });

  app.get('/api/me', requireAppAuth, async (req, res) => {
    const voiceProfile = await getVoiceProfile(req.user.id);
    res.json({
      user: publicUserProfile(req.user, voiceProfile),
      voiceProfile: {
        status: voiceProfile.status,
        sampleCount: voiceProfile.samples.length,
        voiceReady: Boolean(resolveVoiceId(req.user, voiceProfile)),
        elevenlabsConfigured: isElevenLabsConfigured(),
        minSamples: MAX_VOICE_SAMPLES,
        maxSamples: MAX_VOICE_SAMPLES,
        canRecordMore: voiceProfile.samples.length < MAX_VOICE_SAMPLES,
      },
    });
  });

  app.get('/api/voice/profile', requireAppAuth, async (req, res) => {
    const voiceProfile = await getVoiceProfile(req.user.id);
    res.json({
      status: voiceProfile.status,
      sampleCount: voiceProfile.samples.length,
      samples: voiceProfile.samples.map(({ id, createdAt }) => ({ id, createdAt })),
      voiceReady: Boolean(resolveVoiceId(req.user, voiceProfile)),
      elevenlabsConfigured: isElevenLabsConfigured(),
      minSamples: MAX_VOICE_SAMPLES,
      maxSamples: MAX_VOICE_SAMPLES,
      canRecordMore: voiceProfile.samples.length < MAX_VOICE_SAMPLES,
    });
  });

  app.post('/api/voice/samples', requireAppAuth, voiceSampleRateLimit, upload.single('audio'), async (req, res) => {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio received' });
    }

    try {
      const mimeType = req.file.mimetype || 'audio/webm';
      const profile = await addVoiceSample(req.user.id, req.file.buffer, mimeType);
      res.json({
        ok: true,
        sampleCount: profile.samples.length,
        status: profile.status,
        canRecordMore: profile.samples.length < MAX_VOICE_SAMPLES,
        readyForClone: profile.samples.length >= MAX_VOICE_SAMPLES,
      });
    } catch (err) {
      console.error('Voice sample upload error:', err);
      const status = err.code === 'SAMPLE_LIMIT' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Could not save voice sample' });
    }
  });

  app.delete('/api/voice/samples', requireAppAuth, async (req, res) => {
    try {
      const profile = await clearAllVoiceSamples(req.user.id);
      res.json({
        ok: true,
        sampleCount: profile.samples.length,
        status: profile.status,
        voiceReady: false,
        canRecordMore: true,
      });
    } catch (err) {
      console.error('Voice samples reset error:', err);
      res.status(500).json({ error: err.message || 'Could not reset voice samples' });
    }
  });

  app.delete('/api/voice/samples/:sampleId', requireAppAuth, async (req, res) => {
    try {
      const profile = await deleteVoiceSample(req.user.id, req.params.sampleId);
      if (!profile) {
        return res.status(404).json({ error: 'Sample not found' });
      }
      res.json({
        ok: true,
        sampleCount: profile.samples.length,
        status: profile.status,
        voiceReady: Boolean(resolveVoiceId(req.user, profile)),
      });
    } catch (err) {
      console.error('Voice sample delete error:', err);
      res.status(500).json({ error: err.message || 'Could not delete voice sample' });
    }
  });

  app.post('/api/voice/create', requireAppAuth, async (req, res) => {
    if (!isElevenLabsConfigured()) {
      return res.status(503).json({ error: 'Voice cloning is not configured on the server' });
    }

    try {
      const { profile, buffers } = await listVoiceSampleBuffers(req.user.id);
      if (buffers.length < MAX_VOICE_SAMPLES) {
        return res.status(400).json({ error: `Record at least ${MAX_VOICE_SAMPLES} voice samples first` });
      }

      const voiceId = await createVoiceClone({
        name: `Lingu ${req.user.name}`,
        description: `Personal voice profile for ${req.user.name}`,
        samples: buffers,
      });

      const saved = await saveVoiceClone(req.user.id, voiceId);
      res.json({
        ok: true,
        voiceReady: true,
        status: saved.status,
        sampleCount: saved.samples.length,
      });
    } catch (err) {
      console.error('Voice clone error:', err);
      res.status(500).json({ error: err.message || 'Could not create voice profile' });
    }
  });

  app.get('/api/languages', requireAppAuth, (_req, res) => {
    res.json(getLanguagesList());
  });

  app.post('/api/transcribe', requireAppAuth, converseRateLimit, upload.single('audio'), async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const lang1 = String(req.body.lang1 || '').toLowerCase().trim();
    const lang2 = String(req.body.lang2 || '').toLowerCase().trim();

    if (!validateLanguagePair(lang1, lang2, res)) return;
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio received' });
    }

    const mimeType = req.file.mimetype || 'audio/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';

    try {
      const file = await toFile(req.file.buffer, `audio.${ext}`, { type: mimeType });
      const transcription = await transcribeAudio(openai, file, { lang1, lang2 });
      const rawText = transcription.text?.trim();

      if (!rawText) {
        return res.status(400).json({ error: 'No speech detected' });
      }

      res.json({ rawText });
    } catch (err) {
      console.error('Transcribe error:', err);
      res.status(500).json({ error: formatApiError(err) });
    }
  });

  app.post('/api/converse', requireAppAuth, converseRateLimit, upload.single('audio'), async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const lang1 = String(req.body.lang1 || '').toLowerCase().trim();
    const lang2 = String(req.body.lang2 || '').toLowerCase().trim();
    const context = parseConversationContext(req.body.context);

    if (!validateLanguagePair(lang1, lang2, res)) return;
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio received' });
    }

    const mimeType = req.file.mimetype || 'audio/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';

    try {
      const file = await toFile(req.file.buffer, `audio.${ext}`, { type: mimeType });
      const transcription = await transcribeAudio(openai, file, { lang1, lang2 });
      const rawText = transcription.text?.trim();

      if (!rawText) {
        return res.status(400).json({ error: 'No speech detected' });
      }

      await pipeTranslationStream(res, openai, rawText, lang1, lang2, context);
    } catch (err) {
      console.error('Converse error:', err);
      if (res.headersSent) {
        res.write(`${JSON.stringify({ event: 'error', error: formatApiError(err) })}\n`);
        res.end();
      } else {
        res.status(500).json({ error: formatApiError(err) });
      }
    }
  });

  app.post('/api/translate', requireAppAuth, converseRateLimit, async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const lang1 = String(req.body.lang1 || '').toLowerCase().trim();
    const lang2 = String(req.body.lang2 || '').toLowerCase().trim();
    const context = parseConversationContext(req.body.context);
    const rawText = String(req.body.text || '').trim();

    if (!validateLanguagePair(lang1, lang2, res)) return;
    if (!rawText) {
      return res.status(400).json({ error: 'Text is required' });
    }

    try {
      await pipeTranslationStream(res, openai, rawText, lang1, lang2, context);
    } catch (err) {
      console.error('Translate error:', err);
      if (res.headersSent) {
        res.write(`${JSON.stringify({ event: 'error', error: formatApiError(err) })}\n`);
        res.end();
      } else {
        res.status(500).json({ error: formatApiError(err) });
      }
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
    const wantsClone = req.body.voiceMode !== 'default';

    try {
      const voiceProfile = await getVoiceProfile(req.user.id);
      const voiceId = resolveVoiceId(req.user, voiceProfile);
      const useClone = wantsClone && voiceId && supportsClonedVoice(langCode);

      if (wantsClone && supportsClonedVoice(langCode) && !voiceId) {
        return res.status(400).json({ error: 'Personal voice not ready — set up your voice profile first' });
      }

      const buffer = await generateSpeech(openai, text, langCode, useClone ? voiceId : null);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'private, max-age=3600');
      res.set('X-Voice-Mode', useClone ? 'clone' : 'default');
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
