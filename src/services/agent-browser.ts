import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { storageService } from './storage.js';
import type { IGeminiResult } from '../types/index.js';

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
    signedIn: 'a[aria-label^="Google Account:"]',
    prompt: 'div.ql-editor[contenteditable="true"]',
    image: 'model-response img',
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

async function withBrowser<T>(site: Site, action: () => Promise<T>): Promise<T> {
  if (active.has(site)) throw new Error(`${site} browser is already in use.`);
  active.add(site);
  const config = SITES[site];
  try {
    // A named profile is copied to a temporary, read-only snapshot by
    // agent-browser. On macOS the real Chrome binary is needed to decrypt
    // cookies from Chrome's Keychain; Chrome for Testing uses a different key.
    const browserArgs = ['--profile', 'Default', '--headed'];
    if (platform() === 'darwin' && existsSync(MAC_CHROME)) {
      browserArgs.push('--executable-path', MAC_CHROME);
    }
    await command(site, [...browserArgs, 'open', config.url], 60_000);
    return await action();
  } finally {
    await command(site, ['close'], 15_000).catch(() => {});
    active.delete(site);
  }
}

async function readImage(site: Site, imageExpression: string): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = await evaluate<string>(site, `(() => {
    const img = ${imageExpression};
    if (!(img instanceof HTMLImageElement) || !img.naturalWidth) throw new Error('Image is not loaded');
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  })()`);
  if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('Image could not be read from the browser.');
  return { base64: dataUrl.slice('data:image/png;base64,'.length), mimeType: 'image/png' };
}

export const agentBrowserClient = {
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

      const { base64, mimeType } = await readImage(site, imageExpression);
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
};
