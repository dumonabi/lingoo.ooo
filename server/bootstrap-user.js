import crypto from 'crypto';

export const SUPER_USER_ID = 'u-super';

const BOOTSTRAP_SALT = Buffer.from('lingu-super-user-v1', 'utf8');
const BOOTSTRAP_HASH = Buffer.from(
  '41f36b40df791c2a60955a15a1f257d2fb3edb8e4a99def8b2b09d8400ef67556edd8792d49b8ca560bd46726ff9d872821d56880b591cef27cd94b9658e39c3',
  'hex',
);

export function getSuperUserRecord() {
  return {
    id: SUPER_USER_ID,
    name: 'Admin',
    nativeLanguage: 'en',
    elevenlabsVoiceId: null,
  };
}

export function verifySuperUserPassword(attempt) {
  if (typeof attempt !== 'string' || !attempt.trim()) return false;

  try {
    const actual = crypto.scryptSync(attempt.trim(), BOOTSTRAP_SALT, 64);
    return crypto.timingSafeEqual(actual, BOOTSTRAP_HASH);
  } catch {
    return false;
  }
}

export function isSuperUser(user) {
  return user?.id === SUPER_USER_ID;
}
