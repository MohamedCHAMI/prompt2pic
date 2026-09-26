import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { IAppConfig, IGoogleCookies, TAuthMode, TBrowserBackend } from '../types/index.js';

const CONFIG_DIR = join(homedir(), '.nano-banana');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview';
const DEFAULT_FAST_MODEL = 'gemini-2.5-flash-image';

const cookiesSchema = z.object({
  secure1psid: z.string().min(1, '__Secure-1PSID cannot be empty'),
  secure1psidts: z.string().optional(),
});

const configSchema = z
  .object({
    // authMode defaults to 'apiKey' so legacy config.json (no authMode) stays valid.
    authMode: z.enum(['apiKey', 'gemini-web']).default('apiKey'),
    browserBackend: z.enum(['playwright', 'agent-browser']).default('playwright'),
    geminiApiKey: z.string().min(1).optional(),
    cookies: cookiesSchema.optional(),
    model: z.string().min(1).optional(),
    fastModel: z.string().min(1).optional(),
    openaiApiKey: z.string().min(1).optional(),
    imageDir: z.string().min(1).optional(),
    videoDir: z.string().min(1).optional(),
  });

type TConfigSource = 'env' | 'file' | 'runtime' | 'none';

class SettingsManager {
  private current: IAppConfig | null = null;
  private source: TConfigSource = 'none';

  getDefaultModel(): string {
    return DEFAULT_MODEL;
  }

  async load(): Promise<void> {
    const envKey = process.env.GEMINI_API_KEY;
    const envModel = process.env.GEMINI_MODEL;
    const envFastModel = process.env.GEMINI_FAST_MODEL;
    const envMode = process.env.GEMINI_AUTH_MODE as TAuthMode | undefined;
    const envPsid = process.env.GEMINI_SECURE_1PSID?.trim();
    const envPsidts = process.env.GEMINI_SECURE_1PSIDTS?.trim() || undefined;

    let fileConfig: z.infer<typeof configSchema> | undefined;
    try {
      fileConfig = configSchema.parse(JSON.parse(await readFile(CONFIG_FILE, 'utf-8')));
    } catch {
      // No usable file config.
    }

    // env, gemini-web mode (explicit mode, or 1PSID present without an API key)
    const wantsWeb = envMode === 'gemini-web' || (!envKey && !!envPsid);
    if (wantsWeb && envPsid) {
      this.current = {
        ...fileConfig,
        authMode: 'gemini-web',
        cookies: { secure1psid: envPsid, secure1psidts: envPsidts },
        model: envModel ?? fileConfig?.model,
        fastModel: envFastModel ?? fileConfig?.fastModel,
      };
      this.source = 'env';
      return;
    }

    // env, apiKey mode
    if (envKey) {
      this.current = {
        ...fileConfig,
        authMode: 'apiKey',
        geminiApiKey: envKey,
        model: envModel ?? fileConfig?.model,
        fastModel: envFastModel ?? fileConfig?.fastModel,
      };
      this.source = 'env';
      return;
    }

    // File supports legacy { geminiApiKey, model } without authMode.
    if (fileConfig) {
      const validated = fileConfig;
      this.current = {
        authMode: validated.authMode,
        browserBackend: validated.browserBackend,
        geminiApiKey: validated.geminiApiKey,
        cookies: validated.cookies,
        model: envModel ?? validated.model,
        fastModel: envFastModel ?? validated.fastModel,
        openaiApiKey: validated.openaiApiKey,
        imageDir: validated.imageDir,
        videoDir: validated.videoDir,
      };
      this.source = 'file';
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    if (!apiKey || apiKey.length < 1) {
      throw new Error('API key cannot be empty');
    }
    this.current = {
      ...this.current,
      authMode: 'apiKey',
      geminiApiKey: apiKey,
    };
    this.source = 'runtime';

    await this.persistConfig();
  }

  async setCookies(cookies: IGoogleCookies): Promise<void> {
    if (!cookies.secure1psid) {
      throw new Error('__Secure-1PSID cookie is required');
    }
    this.current = {
      ...this.current,
      authMode: 'gemini-web',
      cookies,
    };
    this.source = 'runtime';

    await this.persistConfig();
  }

  async setAuthMode(mode: TAuthMode): Promise<void> {
    if (!this.current) {
      throw new Error('Configure credentials before selecting an auth mode.');
    }
    if (mode === 'apiKey' && !this.current.geminiApiKey) {
      throw new Error('No API key configured. Use configure_api_key first.');
    }
    if (mode === 'gemini-web' && !this.current.cookies?.secure1psid) {
      throw new Error('No Google cookies configured. Use configure_google_login first.');
    }
    this.current.authMode = mode;

    await this.persistConfig();
  }

  async setModel(model: string): Promise<void> {
    if (!this.current) {
      throw new Error('Credentials must be configured before setting a model.');
    }
    this.current.model = model;

    await this.persistConfig();
  }

  async setFastModel(model: string): Promise<void> {
    if (!this.current) {
      throw new Error('Credentials must be configured before setting a model.');
    }
    this.current.fastModel = model;

    await this.persistConfig();
  }

  async setBrowserBackend(backend: TBrowserBackend): Promise<void> {
    if (backend !== 'playwright' && backend !== 'agent-browser') {
      throw new Error('Browser backend must be playwright or agent-browser.');
    }
    // Keep environment credentials in the environment. Changing this preference
    // must not copy them into config.json.
    let fileConfig: Record<string, unknown> = {};
    try {
      fileConfig = JSON.parse(await readFile(CONFIG_FILE, 'utf-8'));
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err;
    }
    fileConfig.browserBackend = backend;
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_FILE, JSON.stringify(fileConfig, null, 2), { mode: 0o600 });
    await chmod(CONFIG_FILE, 0o600);
    if (!this.current) this.current = { authMode: 'apiKey' };
    this.current.browserBackend = backend;
  }

  getBrowserBackend(): TBrowserBackend {
    return this.current?.browserBackend ?? 'playwright';
  }

  getFastModel(): string {
    return this.current?.fastModel ?? DEFAULT_FAST_MODEL;
  }

  getDefaultFastModel(): string {
    return DEFAULT_FAST_MODEL;
  }

  private async persistConfig(): Promise<void> {
    if (!this.current) return;

    const data: Record<string, unknown> = { authMode: this.current.authMode };
    data.browserBackend = this.getBrowserBackend();
    if (this.current.geminiApiKey) {
      data.geminiApiKey = this.current.geminiApiKey;
    }
    if (this.current.cookies) {
      data.cookies = this.current.cookies;
    }
    if (this.current.model) {
      data.model = this.current.model;
    }
    if (this.current.openaiApiKey) {
      data.openaiApiKey = this.current.openaiApiKey;
    }
    if (this.current.imageDir) {
      data.imageDir = this.current.imageDir;
    }
    if (this.current.videoDir) {
      data.videoDir = this.current.videoDir;
    }

    if (this.current.fastModel) {
      data.fastModel = this.current.fastModel;
    }

    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
    await chmod(CONFIG_FILE, 0o600);
  }

  getModel(): string {
    return this.current?.model ?? DEFAULT_MODEL;
  }

  getConfig(): IAppConfig | null {
    return this.current;
  }

  getSource(): TConfigSource {
    return this.source;
  }

  getAuthMode(): TAuthMode {
    return this.current?.authMode ?? 'apiKey';
  }

  getCookies(): IGoogleCookies | null {
    return this.current?.cookies ?? null;
  }

  isReady(): boolean {
    if (!this.current) return false;
    if (this.current.authMode === 'gemini-web') {
      return !!this.current.cookies?.secure1psid;
    }
    return !!this.current.geminiApiKey;
  }

  getStatusMessage(): string {
    if (!this.isReady() || !this.current) {
      return [
        'Gemini is not configured.',
        'Option A — API key mode (official):',
        '  1. Set GEMINI_API_KEY environment variable, or',
        '  2. Use the configure_api_key tool',
        '  Get a key at: https://aistudio.google.com/apikey',
        'Option B — Free Google-cookie mode (consumer Gemini, unofficial):',
        '  1. Set GEMINI_AUTH_MODE=gemini-web and GEMINI_SECURE_1PSID, or',
        '  2. Use the configure_google_login tool',
      ].join('\n');
    }

    if (this.current.authMode === 'gemini-web') {
      const psid = this.current.cookies?.secure1psid ?? '';
      const masked = psid.length > 10 ? `${psid.slice(0, 6)}...${psid.slice(-4)}` : '(set)';
      return `Configured (mode: gemini-web [free/unofficial], source: ${this.source}, __Secure-1PSID: ${masked})`;
    }

    const key = this.current.geminiApiKey ?? '';
    const masked = key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : '(set)';
    return `Configured (mode: apiKey, source: ${this.source}, key: ${masked}, model: ${this.getModel()}, fastModel: ${this.getFastModel()})`;
  }


  async setOpenAIApiKey(apiKey: string): Promise<void> {
    if (!this.current) {
      this.current = { authMode: 'apiKey' };
    }
    this.current.openaiApiKey = apiKey;
    await this.persistConfig();
  }

  getOpenAIApiKey(): string | undefined {
    return this.current?.openaiApiKey;
  }
  async setImageDir(dir: string): Promise<void> {
    if (!this.current) this.current = { authMode: 'apiKey' };
    this.current.imageDir = dir;
    await this.persistConfig();
  }

  async setVideoDir(dir: string): Promise<void> {
    if (!this.current) this.current = { authMode: 'apiKey' };
    this.current.videoDir = dir;
    await this.persistConfig();
  }

  getImageDir(): string | undefined {
    return this.current?.imageDir;
  }

  getVideoDir(): string | undefined {
    return this.current?.videoDir;
  }

}

export const settingsManager = new SettingsManager();
