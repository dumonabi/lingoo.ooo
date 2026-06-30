const SAMPLE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'th', name: 'Thai' },
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   authRequired?: boolean;
 *   onConverse?: (request: import('@playwright/test').Request, index: number) => object | Promise<object>;
 *   onTranslate?: (request: import('@playwright/test').Request, index: number) => object | Promise<object>;
 *   onTranscribe?: (request: import('@playwright/test').Request, index: number) => object | Promise<object>;
 * }} options
 */
export async function setupApiMocks(page, options = {}) {
  const { authRequired = false, onConverse, onTranslate, onTranscribe } = options;
  let converseCount = 0;
  let translateCount = 0;
  let transcribeCount = 0;

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/health') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          authRequired,
          cloneVoiceLanguages: ['en', 'es', 'fr', 'de', 'ja', 'zh', 'it', 'pt'],
        }),
      });
    }

    if (path === '/api/auth/register') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: {
            id: 'test-user-new',
            name: 'User',
            nativeLanguage: 'en',
            voiceReady: false,
            voiceSampleCount: 0,
            voiceStatus: 'none',
          },
          recoveryPhrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        }),
      });
    }

    if (path === '/api/languages') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SAMPLE_LANGUAGES),
      });
    }

    if (path === '/api/auth/verify') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: {
            id: 'test-user',
            name: 'Test User',
            nativeLanguage: 'en',
            voiceReady: false,
            voiceSampleCount: 0,
            voiceStatus: 'none',
          },
        }),
      });
    }

    if (path === '/api/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'test-user',
            name: 'Test User',
            nativeLanguage: 'en',
            voiceReady: false,
            voiceSampleCount: 0,
            voiceStatus: 'none',
          },
          voiceProfile: {
            status: 'none',
            sampleCount: 0,
            voiceReady: false,
            elevenlabsConfigured: false,
            minSamples: 6,
            maxSamples: 6,
            canRecordMore: true,
          },
        }),
      });
    }

    if (path === '/api/voice/profile') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'none',
          sampleCount: 0,
          samples: [],
          voiceReady: false,
          elevenlabsConfigured: false,
          minSamples: 6,
          maxSamples: 6,
          canRecordMore: true,
        }),
      });
    }

    if (path === '/api/transcribe') {
      const index = transcribeCount++;
      const payload = onTranscribe
        ? await onTranscribe(route.request(), index)
        : onConverse
          ? await onConverse(route.request(), index)
          : defaultConverseResponse(index);

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rawText: payload.rawText }),
      });
    }

    if (path === '/api/translate') {
      const index = translateCount++;
      let body = {};
      try {
        body = JSON.parse(route.request().postData() || '{}');
      } catch {
        body = {};
      }

      const payload = onTranslate
        ? await onTranslate(route.request(), index)
        : onConverse
          ? await onConverse(route.request(), index)
          : defaultConverseResponse(index);

      const status = payload.__status ?? 200;
      delete payload.__status;
      payload.rawText = body.text || payload.rawText;
      payload.sourceText = payload.rawText;

      if (status !== 200) {
        return route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(payload.error ? payload : { error: 'Request failed' }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: buildConverseStreamBody(payload),
      });
    }

    if (path === '/api/converse') {
      const index = converseCount++;
      const payload = onConverse
        ? await onConverse(route.request(), index)
        : defaultConverseResponse(index);

      const status = payload.__status ?? 200;
      delete payload.__status;

      if (status !== 200) {
        return route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(payload.error ? payload : { error: 'Request failed' }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: buildConverseStreamBody(payload),
      });
    }

    if (path === '/api/speak') {
      const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
      return route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        body: Buffer.from(bytes),
      });
    }

    return route.fulfill({ status: 404, body: 'Not found' });
  });
}

function defaultConverseResponse(index) {
  const samples = [
    {
      rawText: 'hola',
      detectedLanguage: 'es',
      sourceText: 'hola',
      translatedText: 'hello',
      targetLanguage: 'en',
    },
    {
      rawText: 'สวัสดี',
      detectedLanguage: 'th',
      sourceText: 'สวัสดี',
      translatedText: 'hola',
      targetLanguage: 'es',
    },
  ];
  return samples[index] ?? samples[samples.length - 1];
}

function buildConverseStreamBody(payload) {
  const lines = [];
  lines.push(JSON.stringify({ event: 'transcript', rawText: payload.rawText }));

  const text = payload.translatedText || '';
  for (let i = 0; i < text.length; i += 2) {
    lines.push(JSON.stringify({ event: 'delta', text: text.slice(i, i + 2) }));
  }

  lines.push(JSON.stringify({
    event: 'done',
    rawText: payload.rawText,
    detectedLanguage: payload.detectedLanguage,
    sourceText: payload.sourceText || payload.rawText,
    translatedText: payload.translatedText,
    targetLanguage: payload.targetLanguage,
  }));

  return `${lines.join('\n')}\n`;
}

export async function resetClientState(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('lingu-pending');
  });
}
