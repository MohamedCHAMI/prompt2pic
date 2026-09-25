#!/usr/bin/env node
import { fetch as undiciFetch, Agent, setGlobalDispatcher } from "undici";
setGlobalDispatcher(new Agent({ maxResponseHeadersSize: 1048576 } as any));
global.fetch = undiciFetch as any;

import { Command } from 'commander';
import { settingsManager } from './config/settings.js';
import { geminiWebClient } from './services/gemini-web.js';
import type { TAuthMode } from './types/index.js';
import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';

function hiddenPrompt(query: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(query);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.resume();
    stdin.setRawMode?.(true);
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (char: string) => {
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.setRawMode?.(!!wasRaw);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value.trim());
          break;
        case '\u0003':
          process.exit(1);
          break;
        case '\u007f':
        case '\b':
          value = value.slice(0, -1);
          break;
        default:
          value += char;
          break;
      }
    };
    stdin.on('data', onData);
  });
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const program = new Command();

program
  .name('prompt2pic')
  .description('Universal AI Image Generator CLI & MCP Server')
  .version('1.3.0');

program
  .command('mcp')
  .description('Start the MCP server (Stdio)')
  .action(() => {
    // We just run index.js which starts the stdio server
    import('./index.js');
  });

program
  .command('serve')
  .description('Start the Express REST Bridge')
  .option('-p, --port <number>', 'Port to listen on', '3333')
  .action((options) => {
    process.env.PORT = options.port;
    import('./express.js');
  });

program
  .command('generate')
  .description('Generate an image directly from the command line')
  .argument('<prompt>', 'The prompt for the image')
  .action(async (prompt) => {
    await settingsManager.load();
    
    if (settingsManager.getAuthMode() !== 'gemini-web') {
      console.error('CLI direct generation currently only supports gemini-web auth mode.');
      console.error('Run: prompt2pic config --auth-mode gemini-web');
      process.exit(1);
    }
    
    if (!settingsManager.isReady()) {
      console.error(settingsManager.getStatusMessage());
      process.exit(1);
    }
    
    geminiWebClient.configure(settingsManager.getConfig()!.cookies!);
    console.log(`🎨 Generating image for: "${prompt}"...`);
    
    try {
      const result = await geminiWebClient.generateImage(prompt);
      if (result.savedPath) {
        console.log(`✅ Success! Image saved to: ${result.savedPath}`);
      } else {
        console.log('⚠️ Generated, but no image was saved.');
        console.log(result.contents);
      }
      process.exit(0);
    } catch (error) {
      console.error('❌ Error generating image:');
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Show or update configuration')
  .action(async () => {
    await settingsManager.load();
    console.log(settingsManager.getStatusMessage());
    console.log('');
    console.log('To change settings, you can edit: ~/.nano-banana/config.json');
    console.log('Or use the MCP tools in your chat client.');
  });

program
  .command('cookies')
  .description('Configure free gemini-web auth by pasting fresh Google cookies (hidden input)')
  .option('--psid <value>', 'Set __Secure-1PSID non-interactively (lands in shell history — prefer interactive mode)')
  .option('--psidts <value>', 'Set __Secure-1PSIDTS non-interactively')
  .action(async (options) => {
    await settingsManager.load();
    let psid = options.psid as string | undefined;
    let psidts = options.psidts as string | undefined;
    if (!psid) {
      console.log('Get these from gemini.google.com → DevTools → Application → Cookies.');
      psid = await hiddenPrompt('__Secure-1PSID: ');
      const ts = await hiddenPrompt('__Secure-1PSIDTS (optional, Enter to skip): ');
      psidts = ts || undefined;
    }
    if (!psid) {
      console.error('__Secure-1PSID is required.');
      process.exit(1);
    }
    await settingsManager.setCookies({ secure1psid: psid, secure1psidts: psidts });
    console.log('✅ Cookies saved to ~/.nano-banana/config.json — gemini-web mode active.');
    console.log('Restart the MCP server (or reload it in your client) to pick this up.');
  });

program
  .command('apikey')
  .description('Configure official Gemini API key mode (no cookies, no expiry, billed)')
  .option('--key <value>', 'Set GEMINI_API_KEY non-interactively (lands in shell history — prefer interactive mode)')
  .action(async (options) => {
    await settingsManager.load();
    let key = options.key as string | undefined;
    if (!key) {
      console.log('Get a key at: https://aistudio.google.com/apikey');
      key = await hiddenPrompt('GEMINI_API_KEY: ');
    }
    if (!key) {
      console.error('API key is required.');
      process.exit(1);
    }
    await settingsManager.setApiKey(key);
    console.log('✅ API key saved to ~/.nano-banana/config.json — apiKey mode active.');
    console.log('Restart the MCP server (or reload it in your client) to pick this up.');
  });

program
  .command('mode <mode>')
  .description('Switch between already-configured auth modes: apiKey | gemini-web')
  .action(async (mode: string) => {
    await settingsManager.load();
    if (mode !== 'apiKey' && mode !== 'gemini-web') {
      console.error('Mode must be "apiKey" or "gemini-web"');
      process.exit(1);
    }
    try {
      await settingsManager.setAuthMode(mode as TAuthMode);
      console.log(`✅ Auth mode switched to ${mode}.`);
      console.log('Restart the MCP server (or reload it in your client) to pick this up.');
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

program.parse(process.argv);
