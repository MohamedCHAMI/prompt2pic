import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Page } from 'playwright';
import { launchPersistentBrowser, downloadImageFromPage } from './browser-automation.js';
import { storageService } from './storage.js';
import { TContentItem, IGeminiResult } from '../types/index.js';

const PROFILE_DIR = join(homedir(), '.nano-banana', 'chatgpt-profile');
const CHATGPT_URL = 'https://chatgpt.com/';

// ChatGPT's input is an unlabelled ProseMirror contenteditable div (no id/data-testid to
// hook), and generated images render inside a dedicated preview button — verified live
// against the current chatgpt.com build; both may need updating if OpenAI reworks the UI.
const PROMPT_SELECTOR = 'div.ProseMirror[contenteditable="true"]';
const SIGNED_IN_SELECTOR = '[aria-label="Open profile menu"]';
const GENERATED_IMAGE_SELECTOR = 'button[data-testid="generated-image-preview"] img';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const RESPONSE_TIMEOUT_MS = 5 * 60_000;

class ChatGPTWebClient {
  isConfigured(): boolean {
    return existsSync(PROFILE_DIR);
  }

  /**
   * Opens a real, visible Chrome window against the persistent profile so the user
   * can complete OpenAI's login/Cloudflare challenge by hand — this is the only
   * reliable way in, since chatgpt.com actively fingerprints headless automation.
   */
  async login(): Promise<void> {
    await mkdir(PROFILE_DIR, { recursive: true });
    const context = await launchPersistentBrowser(PROFILE_DIR);

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await page.locator(SIGNED_IN_SELECTOR).count()) return;
        await page.waitForTimeout(2_000);
      }

      throw new Error('Timed out waiting for login. Log in to chatgpt.com and try again.');
    } finally {
      await context.close();
    }
  }

  async generateImage(prompt: string): Promise<IGeminiResult> {
    if (!this.isConfigured()) {
      throw new Error('ChatGPT web session not configured. Use configure_chatgpt_login first.');
    }

    const context = await launchPersistentBrowser(PROFILE_DIR);
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      const signedIn = await page.locator(SIGNED_IN_SELECTOR)
        .waitFor({ state: 'attached', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!signedIn) {
        throw new Error('ChatGPT session is signed out. Use configure_chatgpt_login first.');
      }

      const promptBox = page.locator(PROMPT_SELECTOR).first();
      const foundPromptBox = await promptBox
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);

      if (!foundPromptBox) {
        throw new Error(
          'Could not find the ChatGPT prompt box — the session may have expired or hit a login wall. ' +
            'Re-run configure_chatgpt_login.',
        );
      }

      // ChatGPT animates the composer, which can keep Playwright's click stability
      // check waiting indefinitely. Focusing the visible editor avoids that race.
      await promptBox.evaluate((element: HTMLElement) => element.focus());
      await page.keyboard.type(prompt);
      await page.keyboard.press('Enter');

      // Sending from the home screen opens a fresh conversation. Image counts
      // from the previous page no longer apply after that navigation.
      await page.waitForURL((url) => url.pathname.startsWith('/c/'), { timeout: 30_000 });

      const image = page.locator(GENERATED_IMAGE_SELECTOR).first();
      // The preview can be fully loaded while ChatGPT gives it a 0x0 layout
      // box. Playwright's "visible" state never resolves in that case.
      const gotImage = await page
        .waitForFunction((selector) => {
          const img = document.querySelector(selector);
          return img instanceof HTMLImageElement && img.naturalWidth > 0;
        }, GENERATED_IMAGE_SELECTOR, { timeout: RESPONSE_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);

      const contents: TContentItem[] = [];
      let savedPath: string | null = null;

      const replyText = gotImage ? '' : await this.readLatestReply(page);

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
          text: replyText || 'ChatGPT did not return an image. Try rephrasing the prompt to explicitly ask for one.',
        });
      }

      return { contents, savedPath };
    } finally {
      await context.close();
    }
  }

  private async readLatestReply(page: Page): Promise<string> {
    const text = await page.locator('body').innerText().catch(() => '');
    const reply = text.split('ChatGPT said:').at(-1);
    return reply === text ? '' : (reply?.split('ChatGPT can make mistakes')[0] ?? '').trim();
  }

}

export const chatGPTWebClient = new ChatGPTWebClient();
