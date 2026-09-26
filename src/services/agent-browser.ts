import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { storageService } from './storage.js';
import type { IGeminiResult, IGoogleCookies } from '../types/index.js';

type Site = 'chatgpt' | 'gemini';

const SITES = {
  chatgpt: {
    url: 'https://chatgpt.com/',
    signedIn: '[aria-label="Open profile menu"]',
    prompt: 'div.ProseMirror[contenteditable="true"]',
    image: 'button[data-testid="generated-image-preview"] img',
  },
  gemini: {
    url: 'https://gemini.google.com/app',
    videoUrl: 'https://gemini.google.com/videos',
    signedIn: 'a[aria-label^="Google Account:"]',
    prompt: 'div.ql-editor[contenteditable="true"]',
    image: 'model-response img',
    video: 'model-response video',
  },
} as const;

const active = new Set<Site>();
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userCli = join(homedir(), '.npm-global', 'bin', 'agent-browser');
const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN ?? (existsSync(userCli) ? userCli : 'agent-browser');

function command(site: Site, args: string[], timeoutMs = 30_000, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(AGENT_BROWSER_BIN, ['--session', `prompt2pic-${site}`, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let outputBytes = 0;
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 32 * 1024 * 1024) child.kill();
      else stdout += chunk.toString();
    });
    child.stderr.resume();
    child.on('error', (err) => {
      clearTimeout(timer);
      reject('code' in err && err.code === 'ENOENT'
        ? new Error('agent-browser is not installed. Install it and run agent-browser install.')
        : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`agent-browser command failed (exit ${code}). Check the browser window and login state.`));
    });
    child.stdin.end(input);
  });
}

async function evaluate<T>(site: Site, script: string): Promise<T> {
  const output = await command(site, ['--max-output', '33000000', 'eval', '--stdin'], 30_000, script);
  return JSON.parse(output) as T;
}

async function waitFor(site: Site, script: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(site, script)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return false;
}

async function withBrowser<T>(site: Site, action: () => Promise<T>, urlOverride?: string): Promise<T> {
  if (active.has(site)) throw new Error(`${site} browser is already in use.`);
  active.add(site);
  const config = SITES[site];
  try {
    // A named profile is copied to a temporary, read-only snapshot by
    // agent-browser. On macOS the real Chrome binary is needed to decrypt
    // cookies from Chrome's Keychain; Chrome for Testing uses a different key.
    // Headless is fine here: signing in happens in the user's real, separate
    // Chrome window — this snapshot only ever reads that session, never asks
    // the user to interact with it.
    const browserArgs = ['--profile', 'Default'];
    if (platform() === 'darwin' && existsSync(MAC_CHROME)) {
      browserArgs.push('--executable-path', MAC_CHROME);
    }
    await command(site, [...browserArgs, 'open', urlOverride ?? config.url], 60_000);
    return await action();
  } finally {
    await command(site, ['close'], 15_000).catch(() => {});
    active.delete(site);
  }
}

/**
 * Reads a loaded <img>/<video> element's own src via a credentialed fetch
 * instead of a canvas snapshot. Gemini's media CDN responses don't expose
 * COEP/CORP headers, so canvas.drawImage() taints the canvas and
 * toDataURL() silently returns a blank image instead of throwing — fetch
 * bypasses that entirely since it never touches the canvas.
 */
async function readMediaAsBase64(
  site: Site,
  elementExpression: string,
  expectedMimePrefix: 'image/' | 'video/',
): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = await evaluate<string>(site, `(async () => {
    const el = ${elementExpression};
    if (!el || !el.src) throw new Error('Media element is not loaded');
    const res = await fetch(el.src, { credentials: 'include' });
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  })()`);
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match || !match[1].startsWith(expectedMimePrefix)) {
    throw new Error('Media could not be read from the browser.');
  }
  return { base64: match[2], mimeType: match[1] };
}

interface IRawCookie {
  name: string;
  value: string;
  domain?: string;
}

export const agentBrowserClient = {
  /**
   * Reads __Secure-1PSID/__Secure-1PSIDTS straight from the signed-in Gemini
   * session in Chrome Default, instead of the user copying them out of DevTools.
   * The values only ever pass through this process's memory on their way into
   * settingsManager.setCookies() — never logged, never returned to a caller
   * that might print them.
   */
  async extractGoogleCookies(): Promise<IGoogleCookies> {
    return withBrowser('gemini', async () => {
      const signedIn = await waitFor('gemini',
        `!!document.querySelector(${JSON.stringify(SITES.gemini.signedIn)})`, 20_000);
      if (!signedIn) {
        throw new Error('Sign in to gemini.google.com in your regular Chrome Default profile, then retry.');
      }

      const raw = await command('gemini', ['cookies', 'get', '--json'], 15_000);
      const parsed = JSON.parse(raw) as
        | IRawCookie[]
        | { cookies: IRawCookie[] }
        | { success: boolean; data?: IRawCookie[] | { cookies: IRawCookie[] }; error?: string };
      const list = Array.isArray(parsed)
        ? parsed
        : 'cookies' in parsed
          ? parsed.cookies
          : Array.isArray(parsed.data)
            ? parsed.data
            : parsed.data?.cookies;

      if (!list) {
        const errMsg = !Array.isArray(parsed) && 'error' in parsed ? parsed.error : undefined;
        throw new Error(`Could not read cookies from agent-browser${errMsg ? `: ${errMsg}` : '.'}`);
      }

      const secure1psid = list.find((c) => c.name === '__Secure-1PSID')?.value;
      const secure1psidts = list.find((c) => c.name === '__Secure-1PSIDTS')?.value;

      if (!secure1psid) {
        throw new Error('__Secure-1PSID cookie not found. Make sure you are signed in to a personal Google account (not a Workspace SSO session) in Chrome Default.');
      }

      return { secure1psid, secure1psidts };
    });
  },

  async login(site: Site): Promise<void> {
    const config = SITES[site];
    await withBrowser(site, async () => {
      const signedIn = await waitFor(site,
        `!!document.querySelector(${JSON.stringify(config.signedIn)})`, 20_000);
      if (!signedIn) {
        throw new Error(`Sign in to ${site} in your regular Chrome Default profile, then retry. Agent-browser's profile snapshot does not save login changes back to Chrome.`);
      }
    });
  },

  async generateImage(site: Site, prompt: string): Promise<IGeminiResult> {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt is required.');
    const config = SITES[site];
    return withBrowser(site, async () => {
      const signedIn = await waitFor(site,
        `!!document.querySelector(${JSON.stringify(config.signedIn)})`, 20_000);
      if (!signedIn) throw new Error(`${site} session is signed out. Run its login tool first.`);

      const promptReady = await waitFor(site,
        `!!document.querySelector(${JSON.stringify(config.prompt)})`, 20_000);
      if (!promptReady) throw new Error(`${site} prompt box was not found.`);

      const imagesBefore = site === 'gemini'
        ? await evaluate<number>(site, `document.querySelectorAll('model-response').length`)
        : 0;
      await command(site, ['fill', config.prompt, prompt], 30_000);
      await command(site, ['press', 'Enter'], 30_000);

      const imageExpression = site === 'gemini'
        ? `document.querySelectorAll('model-response')[${imagesBefore}]?.querySelector('img')`
        : `document.querySelector(${JSON.stringify(config.image)})`;
      const hasImage = await waitFor(site,
        `(() => { const img = ${imageExpression}; return img instanceof HTMLImageElement && img.naturalWidth > 0; })()`,
        5 * 60_000);
      if (!hasImage) {
        const reply = await evaluate<string>(site,
          site === 'gemini'
            ? `document.querySelectorAll('model-response')[${imagesBefore}]?.innerText || ''`
            : `document.body.innerText.split('ChatGPT said:').at(-1) || ''`);
        return { contents: [{ type: 'text', text: reply.trim() || `${site} did not return an image.` }], savedPath: null };
      }

      const { base64, mimeType } = await readMediaAsBase64(site, imageExpression, 'image/');
      const savedPath = await storageService.saveImage(base64, 'gen');
      return {
        contents: [
          { type: 'image', data: base64, mimeType },
          { type: 'text', text: `Image saved to: ${savedPath}` },
        ],
        savedPath,
      };
    });
  },

  /**
   * Generates a video via Gemini's web "Videos" composer (Veo, no API key).
   * Submitting there redirects the tab into a normal chat thread, same as
   * an image reply, so the wait/select logic mirrors generateImage's.
   */
  async generateVideo(prompt: string): Promise<IGeminiResult> {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt is required.');
    const config = SITES.gemini;
    return withBrowser(
      'gemini',
      async () => {
        const signedIn = await waitFor('gemini',
          `!!document.querySelector(${JSON.stringify(config.signedIn)})`, 20_000);
        if (!signedIn) throw new Error('Gemini session is signed out. Run configure_gemini_browser_login first.');

        const promptReady = await waitFor('gemini',
          `!!document.querySelector(${JSON.stringify(config.prompt)})`, 20_000);
        if (!promptReady) throw new Error('Gemini video prompt box was not found.');

        const responsesBefore = await evaluate<number>('gemini', `document.querySelectorAll('model-response').length`);
        await command('gemini', ['fill', config.prompt, prompt], 30_000);
        await command('gemini', ['press', 'Enter'], 30_000);

        const videoExpression = `document.querySelectorAll('model-response')[${responsesBefore}]?.querySelector('video')`;
        const hasVideo = await waitFor('gemini',
          `(() => { const v = ${videoExpression}; return v instanceof HTMLVideoElement && v.readyState >= 1; })()`,
          5 * 60_000);
        if (!hasVideo) {
          const reply = await evaluate<string>('gemini',
            `document.querySelectorAll('model-response')[${responsesBefore}]?.innerText || ''`);
          return { contents: [{ type: 'text', text: reply.trim() || 'Gemini did not return a video.' }], savedPath: null };
        }

        const { base64 } = await readMediaAsBase64('gemini', videoExpression, 'video/');
        const savedPath = await storageService.saveVideo(base64, 'video');
        const info = await storageService.getVideoInfo(savedPath);
        const sizeStr = info ? `${(info.size / (1024 * 1024)).toFixed(1)} MB` : 'unknown size';
        return {
          contents: [{ type: 'text', text: `Video saved to: ${savedPath} (${sizeStr})` }],
          savedPath,
        };
      },
      config.videoUrl,
    );
  },
};
