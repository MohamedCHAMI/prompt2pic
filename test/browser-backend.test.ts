import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('browser backend persists without copying an environment API key to disk', async () => {
  const home = await mkdtemp(join(tmpdir(), 'prompt2pic-browser-'));
  const previousHome = process.env.HOME;
  const previousKey = process.env.GEMINI_API_KEY;
  try {
    process.env.HOME = home;
    process.env.GEMINI_API_KEY = 'fake-key';
    const { settingsManager } = await import('../src/config/settings.js');
    await settingsManager.load();
    assert.equal(settingsManager.getBrowserBackend(), 'playwright');

    await settingsManager.setBrowserBackend('agent-browser');
    const raw = await readFile(join(home, '.nano-banana', 'config.json'), 'utf-8');
    assert.equal(JSON.parse(raw).browserBackend, 'agent-browser');
    assert.equal(raw.includes('fake-key'), false);

    await settingsManager.load();
    assert.equal(settingsManager.getBrowserBackend(), 'agent-browser');
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    await rm(home, { recursive: true, force: true });
  }
});
