import { test, expect } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

async function prepareApp(page, apiOptions = {}) {
  await resetClientState(page);
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
  await setupApiMocks(page, apiOptions);
  await page.goto('/');
  await expect(page.locator('#compose-mic')).toBeVisible();
}

async function recordOnce(page, { holdMs = 550, translate = true } = {}) {
  const composeBox = page.locator('#compose-box');
  const mic = page.locator('#compose-mic');
  await expect(mic).toBeEnabled();
  await mic.click();
  await expect(composeBox).toHaveClass(/is-recording/, { timeout: 600 });
  await page.waitForTimeout(holdMs);
  await page.locator('#recording-send').click();
  await expect(composeBox).not.toHaveClass(/is-recording/, { timeout: 8000 });
  await expect(page.locator('#dictation-input')).not.toHaveValue('', { timeout: 8000 });
  if (translate) {
    await page.locator('#dictation-translate').click();
    await expect(page.locator('.message-translated-text')).not.toHaveText('', { timeout: 8000 });
  }
}

test.describe('Lingu.ooo', () => {
  test('loads and enables the microphone', async ({ page }) => {
    await prepareApp(page);
    const mic = page.getByRole('button', { name: 'Record message' });
    await expect(mic).toBeEnabled();
  });

  test('shows recording state quickly after tap', async ({ page }) => {
    await prepareApp(page);
    const composeBox = page.locator('#compose-box');
    const startedAt = Date.now();
    await page.locator('#compose-mic').click();
    await expect(composeBox).toHaveClass(/is-recording/);
    expect(Date.now() - startedAt).toBeLessThan(900);
  });

  test('displays a translation after recording', async ({ page }) => {
    await prepareApp(page);
    await recordOnce(page);
    await expect(page.locator('.message-translated-text')).toHaveText('hello');
  });

  test('replaces the previous translation on a new recording', async ({ page }) => {
    await prepareApp(page);
    await recordOnce(page);
    await expect(page.locator('.message-translated-text')).toHaveText('hello');

    await recordOnce(page, { translate: false });
    await expect(page.locator('#dictation-input')).toHaveValue('สวัสดี ');
    await page.locator('#dictation-translate').click();
    await expect(page.locator('.message-translated-text')).toHaveText('hola');
    await expect(page.locator('.message-translated-text')).not.toHaveText('hello');
  });

  test('ignores stale pending items after a successful translation', async ({ page }) => {
    await prepareApp(page, {
      onTranscribe: (_request, index) => {
        if (index === 0) {
          return {
            rawText: 'uno',
            detectedLanguage: 'es',
            sourceText: 'uno',
            translatedText: 'one',
            targetLanguage: 'en',
          };
        }
        return {
          rawText: 'dos',
          detectedLanguage: 'es',
          sourceText: 'dos',
          translatedText: 'two',
          targetLanguage: 'en',
        };
      },
      onTranslate: (_request, index) => {
        if (index === 0) {
          return {
            rawText: 'uno',
            detectedLanguage: 'es',
            sourceText: 'uno',
            translatedText: 'one',
            targetLanguage: 'en',
          };
        }
        return {
          rawText: 'dos',
          detectedLanguage: 'es',
          sourceText: 'dos',
          translatedText: 'two',
          targetLanguage: 'en',
        };
      },
    });

    await recordOnce(page);
    await expect(page.locator('.message-translated-text')).toHaveText('one');

    await page.evaluate(async () => {
      const openDb = () => new Promise((resolve, reject) => {
        const req = indexedDB.open('lingu-pending', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('recordings', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('recordings', 'readwrite');
        tx.objectStore('recordings').put({
          id: 'stale-recording',
          blob: new Blob([new Uint8Array(1400)], { type: 'audio/webm' }),
          mimeType: 'audio/webm',
          lang1: 'es',
          lang2: 'en',
          contextJson: '[]',
          recordingMs: 5000,
          createdAt: Date.now() - 120_000,
          attempts: 0,
          lastError: '',
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    await recordOnce(page);
    await expect(page.locator('.message-translated-text')).toHaveText('two');

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(2500);
    await expect(page.locator('.message-translated-text')).toHaveText('two');
    await expect(page.locator('.message-translated-text')).not.toHaveText('one');
  });

  test('shows the voice button after translation', async ({ page }) => {
    await prepareApp(page);
    await recordOnce(page);
    const voiceBtn = page.getByRole('button', { name: 'Play' });
    await expect(voiceBtn).toBeVisible({ timeout: 8000 });
  });

  test('restores saved language pair and sends it with translate requests', async ({ page }) => {
    let translateRequest = null;
    await prepareApp(page, {
      onTranslate: async (request) => {
        translateRequest = JSON.parse(request.postData() || '{}');
        return {
          rawText: 'hola',
          detectedLanguage: 'es',
          sourceText: 'hola',
          translatedText: 'สวัสดี',
          targetLanguage: 'th',
        };
      },
    });
    await page.addInitScript(() => {
      localStorage.setItem('lingo-languages', JSON.stringify({ lang1: 'es', lang2: 'th' }));
    });
    await page.reload();
    await expect(page.locator('#dictation-translate')).toBeHidden();

    await page.locator('#dictation-input').fill('hola');
    await expect(page.locator('#dictation-translate')).toBeVisible();
    await expect(page.locator('#dictation-translate')).toBeEnabled();
    await page.locator('#dictation-translate').click();
    await expect(page.locator('.message-translated-text')).toHaveText('สวัสดี', { timeout: 8000 });
    expect(translateRequest?.lang1).toBe('es');
    expect(translateRequest?.lang2).toBe('th');
  });
});
