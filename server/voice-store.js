import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.VOICE_DATA_DIR?.trim()
  || path.join(__dirname, '..', 'data', 'voices');

function userDir(userId) {
  return path.join(DATA_ROOT, userId);
}

function metaPath(userId) {
  return path.join(userDir(userId), 'meta.json');
}

function samplesDir(userId) {
  return path.join(userDir(userId), 'samples');
}

const MAX_VOICE_SAMPLES = 6;

function emptyProfile() {
  return {
    status: 'none',
    elevenlabsVoiceId: null,
    samples: [],
    updatedAt: null,
  };
}

async function writeMeta(userId, meta) {
  const dir = userDir(userId);
  await fs.mkdir(dir, { recursive: true });
  meta.updatedAt = Date.now();
  await fs.writeFile(metaPath(userId), JSON.stringify(meta, null, 2));
}

export { MAX_VOICE_SAMPLES };

export async function getVoiceProfile(userId) {
  try {
    const raw = await fs.readFile(metaPath(userId), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...emptyProfile(),
      ...parsed,
      samples: Array.isArray(parsed.samples) ? parsed.samples : [],
    };
  } catch {
    return emptyProfile();
  }
}

export async function listVoiceSampleBuffers(userId) {
  const profile = await getVoiceProfile(userId);
  const buffers = [];

  for (const sample of profile.samples) {
    const filePath = path.join(samplesDir(userId), `${sample.id}.${sample.ext}`);
    try {
      const buffer = await fs.readFile(filePath);
      buffers.push({ id: sample.id, buffer, ext: sample.ext, mimeType: sample.mimeType || 'audio/webm' });
    } catch {
      // skip missing files
    }
  }

  return { profile, buffers };
}

export async function addVoiceSample(userId, buffer, mimeType = 'audio/webm') {
  const profile = await getVoiceProfile(userId);
  if (profile.samples.length >= MAX_VOICE_SAMPLES) {
    const err = new Error(`You already have ${MAX_VOICE_SAMPLES} samples`);
    err.code = 'SAMPLE_LIMIT';
    throw err;
  }
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await fs.mkdir(samplesDir(userId), { recursive: true });
  await fs.writeFile(path.join(samplesDir(userId), `${id}.${ext}`), buffer);

  profile.samples.push({
    id,
    ext,
    mimeType,
    createdAt: Date.now(),
  });
  profile.status = profile.elevenlabsVoiceId ? 'needs_update' : 'collecting';

  await writeMeta(userId, profile);
  return profile;
}

export async function deleteVoiceSample(userId, sampleId) {
  const profile = await getVoiceProfile(userId);
  const sample = profile.samples.find((entry) => entry.id === sampleId);
  if (!sample) return null;

  profile.samples = profile.samples.filter((entry) => entry.id !== sampleId);

  try {
    await fs.unlink(path.join(samplesDir(userId), `${sample.id}.${sample.ext}`));
  } catch {
    // ignore missing file
  }

  if (!profile.samples.length) {
    profile.status = profile.elevenlabsVoiceId ? 'needs_update' : 'none';
  } else if (!profile.elevenlabsVoiceId) {
    profile.status = 'collecting';
  } else {
    profile.status = 'needs_update';
  }

  await writeMeta(userId, profile);
  return profile;
}

export async function clearAllVoiceSamples(userId) {
  const profile = await getVoiceProfile(userId);

  for (const sample of profile.samples) {
    try {
      await fs.unlink(path.join(samplesDir(userId), `${sample.id}.${sample.ext}`));
    } catch {
      // ignore missing file
    }
  }

  profile.samples = [];
  profile.elevenlabsVoiceId = null;
  profile.status = 'none';
  await writeMeta(userId, profile);
  return profile;
}

export async function saveVoiceClone(userId, elevenlabsVoiceId) {
  const profile = await getVoiceProfile(userId);
  profile.elevenlabsVoiceId = elevenlabsVoiceId;
  profile.status = 'ready';
  await writeMeta(userId, profile);
  return profile;
}

export async function clearVoiceClone(userId) {
  const profile = await getVoiceProfile(userId);
  profile.elevenlabsVoiceId = null;
  profile.status = profile.samples.length ? 'collecting' : 'none';
  await writeMeta(userId, profile);
  return profile;
}

export function resolveVoiceId(user, voiceProfile) {
  return voiceProfile?.elevenlabsVoiceId || user?.elevenlabsVoiceId || null;
}
