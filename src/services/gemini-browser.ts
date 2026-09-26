import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { launchPersistentBrowser, downloadImageFromPage } from './browser-automation.js';
import { storageService } from './storage.js';
import { TContentItem, IGeminiResult } from '../types/index.js';

const PROFILE_DIR = join(homedir(), '.nano-banana', 'gemini-browser-profile');
const GEMINI_URL = 'https://gemini.google.com/app';

// Gemini's Angular app: the prompt box is a Quill contenteditable div, and each
// turn is wrapped in a <model-response> custom element — neither is a stable
// public API, so these selectors may need updating if Google reworks the UI.
const PROMPT_SELECTOR = 'div.ql-editor[contenteditable="true"]';
// Gemini lets signed-out guests type into the same prompt box, so PROMPT_SELECTOR alone
// can't detect login — this account-menu link only renders once actually signed in.
const SIGNED_IN_SELECTOR = 'a[aria-label^="Google Account:"]';
const MODEL_RESPONSE_SELECTOR = 'model-response';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const NEW_TURN_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 5 * 60_000;

class GeminiBrowserClient {
  isConfigured(): boolean {
    return existsSync(PROFILE_DIR);
  }

  /**
   * Opens a real, visible Chrome window against the persistent profile so the user
   * can complete Google's login/2FA by hand.
   */
  async login(): Promise<void> {
    await mkdir(PROFILE_DIR, { recursive: true });
    const context = await launchPersistentBrowser(PROFILE_DIR);

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await page.locator(SIGNED_IN_SELECTOR).count()) return;
        await page.waitForTimeout(2_000);
      }

      throw new Error('Timed out waiting for login. Log in to gemini.google.com and try again.');
    } finally {
      await context.close();
    }
  }

  async generateImage(prompt: string): Promise<IGeminiResult> {
    if (!this.isConfigured()) {
      throw new Error('Gemini browser session not configured. Use configure_gemini_browser_login first.');
    }

    const context = await launchPersistentBrowser(PROFILE_DIR);
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      const signedIn = await page.locator(SIGNED_IN_SELECTOR)
        .waitFor({ state: 'attached', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!signedIn) {
        throw new Error('Gemini session is signed out. Use configure_gemini_browser_login first.');
      }

      const promptBox = page.locator(PROMPT_SELECTOR).first();
      const foundPromptBox = await promptBox
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);

      if (!foundPromptBox) {
        throw new Error(
          'Could not find the Gemini prompt box — the session may have expired or hit a login wall. ' +
            'Re-run configure_gemini_browser_login.',
        );
      }

      const turnsBefore = await page.locator(MODEL_RESPONSE_SELECTOR).count();

      await promptBox.click();
      await page.keyboard.type(prompt);
      await page.keyboard.press('Enter');

      const newTurn = page.locator(MODEL_RESPONSE_SELECTOR).nth(turnsBefore);
      await newTurn.waitFor({ state: 'attached', timeout: NEW_TURN_TIMEOUT_MS });

      const image = newTurn.locator('img').first();
      const gotImage = await image
        .waitFor({ state: 'visible', timeout: RESPONSE_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);

      const contents: TContentItem[] = [];
      let savedPath: string | null = null;

      const replyText = (await newTurn.innerText().catch(() => '')).trim();

      if (gotImage) {
        const src = await image.getAttribute('src');
        if (src) {
          const { base64, mimeType } = await downloadImageFromPage(context, image, src);
          const path = await storageService.saveImage(base64, 'gen');
          savedPath = path;

          contents.push({ type: 'image', data: base64, mimeType });
          contents.push({ type: 'text', text: `Image saved to: ${path}` });
        }
      }

      if (contents.length === 0) {
        contents.push({
          type: 'text',
          text: replyText || 'Gemini did not return an image. Try rephrasing the prompt to explicitly ask for one.',
        });
      }

      return { contents, savedPath };
    } finally {
      await context.close();
    }
  }
}

export const geminiBrowserClient = new GeminiBrowserClient();
