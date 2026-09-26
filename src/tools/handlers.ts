import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { settingsManager } from '../config/index.js';
import { geminiService } from '../services/gemini.js';
import { geminiWebClient } from '../services/gemini-web.js';
import { chatGPTWebClient } from '../services/chatgpt-web.js';
import { geminiBrowserClient } from '../services/gemini-browser.js';
import { storageService } from '../services/storage.js';
import { IImageRecord, IVideoRecord, IGenerateVideoParams, IGeminiResult, IGoogleCookies } from '../types/index.js';

let lastImagePath: string | null = null;
let lastVideoPath: string | null = null;

function textResponse(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

export async function handleConfigureApiKey(args: { apiKey: string }): Promise<CallToolResult> {
  try {
    await settingsManager.setApiKey(args.apiKey);
    geminiService.configure(args.apiKey);
    return textResponse(
      'API 키(apiKey 모드)가 설정되었습니다. 이제 이미지·영상 생성/편집을 사용할 수 있습니다.',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to configure API key';
    return textResponse(msg, true);
  }
}

export async function handleConfigureGoogleLogin(args: {
  secure1psid: string;
  secure1psidts?: string;
}): Promise<CallToolResult> {
  try {
    const secure1psid = args.secure1psid?.trim();
    if (!secure1psid) {
      return textResponse('__Secure-1PSID 쿠키 값이 필요합니다.', true);
    }
    const cookies: IGoogleCookies = {
      secure1psid,
      secure1psidts: args.secure1psidts?.trim() || undefined,
    };
    await settingsManager.setCookies(cookies);
    geminiWebClient.configure(cookies);
    return textResponse(
      'Google 쿠키(무료/비공식 gemini-web 모드)가 설정되었습니다. 이제 generate_image / edit_image를 사용할 수 있습니다. ' +
        '(영상 생성은 API 키 모드 전용입니다. configure_api_key로 되돌릴 수 있습니다.)',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to configure Google login';
    return textResponse(msg, true);
  }
}

export async function handleConfigureModel(args: { model: string; quality?: string }): Promise<CallToolResult> {
  try {
    if (args.quality === 'fast') {
      await settingsManager.setFastModel(args.model);
      return textResponse(`Fast model set to: ${args.model}`);
    }
    await settingsManager.setModel(args.model);
    return textResponse(`Model set to: ${args.model}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to configure model';
    return textResponse(msg, true);
  }
}

export async function handleGenerateImage(args: { prompt: string; model?: string; quality?: string }): Promise<CallToolResult> {
  ensureReady();

  try {
    const result: IGeminiResult =
      settingsManager.getAuthMode() === 'gemini-web'
        ? await geminiWebClient.generateImage(args.prompt)
        : await geminiService.generateImage(args.prompt, args.model, args.quality);

    if (result.savedPath) {
      lastImagePath = result.savedPath;
      await storageService.appendHistory({
        filePath: result.savedPath,
        prompt: args.prompt,
        createdAt: new Date().toISOString(),
        type: 'generated',
      });
    }

    return { content: result.contents };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Image generation failed';
    return textResponse(`Generation error: ${msg}`, true);
  }
}

export async function handleEditImage(args: {
  imagePath: string;
  prompt: string;
  referenceImages?: string[];
  model?: string;
  quality?: string;
}): Promise<CallToolResult> {
  ensureReady();

  try {
    const result: IGeminiResult =
      settingsManager.getAuthMode() === 'gemini-web'
        ? await geminiWebClient.editImage(args.imagePath, args.prompt, args.referenceImages)
        : await geminiService.editImage(args.imagePath, args.prompt, args.referenceImages, args.model, args.quality);

    if (result.savedPath) {
      lastImagePath = result.savedPath;
      await storageService.appendHistory({
        filePath: result.savedPath,
        prompt: args.prompt,
        createdAt: new Date().toISOString(),
        type: 'edited',
      });
    }

    return { content: result.contents };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Image editing failed';
    return textResponse(`Edit error: ${msg}`, true);
  }
}

export async function handleContinueEditing(args: {
  prompt: string;
  referenceImages?: string[];
  model?: string;
  quality?: string;
}): Promise<CallToolResult> {
  if (!lastImagePath) {
    return textResponse(
      'No previous image in this session. Use generate_image or edit_image first.',
      true,
    );
  }

  return handleEditImage({
    imagePath: lastImagePath,
    prompt: args.prompt,
    referenceImages: args.referenceImages,
    model: args.model,
    quality: args.quality,
  });
}

export async function handleGenerateVideo(args: IGenerateVideoParams): Promise<CallToolResult> {
  if (settingsManager.getAuthMode() === 'gemini-web') {
    return textResponse(
      '영상 생성은 API 키 모드에서만 지원됩니다. configure_api_key로 Gemini API 키를 설정한 뒤 다시 시도하세요.',
      true,
    );
  }
  ensureReady();

  try {
    const result = await geminiService.generateVideo(args);

    if (result.savedPath) {
      lastVideoPath = result.savedPath;
      const record: IVideoRecord = {
        filePath: result.savedPath,
        prompt: args.prompt,
        createdAt: new Date().toISOString(),
        type: 'generated',
        model: args.model ?? 'veo-3.1-generate-preview',
        durationSeconds: args.durationSeconds,
        resolution: args.resolution,
        aspectRatio: args.aspectRatio,
      };
      await storageService.appendVideoHistory(record);
    }

    return { content: result.contents };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Video generation failed';
    return textResponse(`Video generation error: ${msg}`, true);
  }
}

export async function handleListVideoHistory(args: { count?: number }): Promise<CallToolResult> {
  const count = Math.min(Math.max(args.count ?? 10, 1), 50);
  const records: IVideoRecord[] = await storageService.listRecentVideos(count);

  if (records.length === 0) {
    return textResponse('No video history found.');
  }

  const lines = [`=== Recent Videos (${records.length}) ===`, ''];

  for (const record of records) {
    const tag = record.type === 'generated' ? '[GEN]' : '[EXT]';
    lines.push(`${tag} ${record.createdAt}`);
    lines.push(`  Model: ${record.model}`);
    lines.push(`  Path: ${record.filePath}`);
    if (record.resolution) lines.push(`  Resolution: ${record.resolution}`);
    if (record.durationSeconds) lines.push(`  Duration: ${record.durationSeconds}s`);
    if (record.aspectRatio) lines.push(`  Aspect Ratio: ${record.aspectRatio}`);
    lines.push(`  Prompt: ${record.prompt.substring(0, 80)}${record.prompt.length > 80 ? '...' : ''}`);
    lines.push('');
  }

  return textResponse(lines.join('\n'));
}

export async function handleGetStatus(): Promise<CallToolResult> {
  const configStatus = settingsManager.getStatusMessage();
  const outputDir = storageService.getOutputDirectory();
  const videoOutputDir = storageService.getVideoOutputDirectory();
  const authMode = settingsManager.getAuthMode();
  const isWeb = authMode === 'gemini-web';

  const lines = [
    '=== Nano Banana MCP Status ===',
    '',
    `Auth mode: ${authMode}${isWeb ? ' (free / unofficial consumer Gemini)' : ''}`,
    `Configuration: ${configStatus}`,
  ];

  if (isWeb) {
    lines.push('Image generation/editing: via consumer Gemini web (model fixed by your account)');
    lines.push('Video generation: unavailable in gemini-web mode (use apiKey mode)');
  } else {
    lines.push(`Image Model (high): ${settingsManager.getModel()}`);
    lines.push(`Image Model (fast): ${settingsManager.getFastModel()}`);
    lines.push('Video Model: veo-3.1-generate-preview (default)');
  }

  lines.push(
    `Image output directory: ${outputDir}`,
    `Video output directory: ${videoOutputDir}`,
    `Last image: ${lastImagePath ?? 'None (no images in this session)'}`,
    `Last video: ${lastVideoPath ?? 'None (no videos in this session)'}`,
  );

  if (lastImagePath) {
    const info = await storageService.getImageInfo(lastImagePath);
    if (info) {
      lines.push(`  Image size: ${(info.size / 1024).toFixed(1)} KB`);
      lines.push(`  Modified: ${info.modified}`);
    }
  }

  if (lastVideoPath) {
    const info = await storageService.getVideoInfo(lastVideoPath);
    if (info) {
      lines.push(`  Video size: ${(info.size / (1024 * 1024)).toFixed(1)} MB`);
      lines.push(`  Modified: ${info.modified}`);
    }
  }

  return textResponse(lines.join('\n'));
}

export async function handleListHistory(args: { count?: number }): Promise<CallToolResult> {
  const count = Math.min(Math.max(args.count ?? 10, 1), 50);
  const records: IImageRecord[] = await storageService.listRecentImages(count);

  if (records.length === 0) {
    return textResponse('No image history found.');
  }

  const lines = [`=== Recent Images (${records.length}) ===`, ''];

  for (const record of records) {
    const tag = record.type === 'generated' ? '[GEN]' : '[EDIT]';
    lines.push(`${tag} ${record.createdAt}`);
    lines.push(`  Path: ${record.filePath}`);
    lines.push(`  Prompt: ${record.prompt.substring(0, 80)}${record.prompt.length > 80 ? '...' : ''}`);
    lines.push('');
  }

  return textResponse(lines.join('\n'));
}

function ensureReady(): void {
  const ready =
    settingsManager.getAuthMode() === 'gemini-web'
      ? geminiWebClient.isConfigured()
      : geminiService.isConfigured();
  if (!ready) {
    throw new Error(settingsManager.getStatusMessage());
  }
}

export async function handleConfigureOpenAIApiKey(args: { apiKey: string }): Promise<CallToolResult> {
  try {
    await settingsManager.setOpenAIApiKey(args.apiKey);
    return textResponse('OpenAI API key configured successfully.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to configure OpenAI API key';
    return textResponse(msg, true);
  }
}

export async function handleGenerateOpenAIImage(args: { prompt: string; model?: string; size?: string }): Promise<CallToolResult> {
  const openaiApiKey = settingsManager.getOpenAIApiKey() || process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return textResponse('OpenAI API key not configured. Use configure_openai_api_key or set OPENAI_API_KEY.', true);
  }

  const model = args.model || 'dall-e-3';
  const size = args.size || '1024x1024';

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model,
        prompt: args.prompt,
        n: 1,
        size,
        response_format: 'b64_json'
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      return textResponse(`OpenAI API error: ${res.status} ${errorText}`, true);
    }

    const data = (await res.json()) as any;
    if (!data.data || data.data.length === 0 || !data.data[0].b64_json) {
      return textResponse('Could not find image bytes in OpenAI response', true);
    }

    const base64 = data.data[0].b64_json;
    const path = await storageService.saveImage(base64, 'gen');
    lastImagePath = path;

    await storageService.appendHistory({
      filePath: path,
      prompt: args.prompt,
      createdAt: new Date().toISOString(),
      type: 'generated',
    });

    return {
      content: [
        { type: 'image', data: base64, mimeType: 'image/png' },
        { type: 'text', text: `OpenAI image saved to: ${path}` }
      ]
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return textResponse(`OpenAI Generation error: ${msg}`, true);
  }
}

export async function handleConfigureChatGPTLogin(): Promise<CallToolResult> {
  try {
    await chatGPTWebClient.login();
    return textResponse(
      'ChatGPT web session saved. A Chrome window opened for login and closed once the chat UI was detected. ' +
        'You can now use generate_chatgpt_image.',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to configure ChatGPT login';
    return textResponse(msg, true);
  }
}

export async function handleGenerateChatGPTImage(args: { prompt: string }): Promise<CallToolResult> {
  if (!chatGPTWebClient.isConfigured()) {
    return textResponse('ChatGPT web session not configured. Use configure_chatgpt_login first.', true);
  }

  try {
    const result = await chatGPTWebClient.generateImage(args.prompt);

    if (result.savedPath) {
      lastImagePath = result.savedPath;
      await storageService.appendHistory({
        filePath: result.savedPath,
        prompt: args.prompt,
        createdAt: new Date().toISOString(),
        type: 'generated',
      });
    }

    return { content: result.contents };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Image generation failed';
    return textResponse(`ChatGPT generation error: ${msg}`, true);
  }
}

export async function handleConfigureGeminiBrowserLogin(): Promise<CallToolResult> {
  try {
    await geminiBrowserClient.login();
    return textResponse(
      'Gemini browser session saved. A Chrome window opened for login and closed once the account menu was detected. ' +
        'You can now use generate_gemini_browser_image.',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to configure Gemini browser login';
    return textResponse(msg, true);
  }
}

export async function handleGenerateGeminiBrowserImage(args: { prompt: string }): Promise<CallToolResult> {
  if (!geminiBrowserClient.isConfigured()) {
    return textResponse('Gemini browser session not configured. Use configure_gemini_browser_login first.', true);
  }

  try {
    const result = await geminiBrowserClient.generateImage(args.prompt);

    if (result.savedPath) {
      lastImagePath = result.savedPath;
      await storageService.appendHistory({
        filePath: result.savedPath,
        prompt: args.prompt,
        createdAt: new Date().toISOString(),
        type: 'generated',
      });
    }

    return { content: result.contents };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Image generation failed';
    return textResponse(`Gemini browser generation error: ${msg}`, true);
  }
}

export async function handleConfigureStorage(args: {
  imageDir?: string;
  videoDir?: string;
}): Promise<CallToolResult> {
  try {
    if (args.imageDir) {
      await settingsManager.setImageDir(args.imageDir);
    }
    if (args.videoDir) {
      await settingsManager.setVideoDir(args.videoDir);
    }
    const msg = [];
    if (args.imageDir) msg.push(`Image output directory set to: ${args.imageDir}`);
    if (args.videoDir) msg.push(`Video output directory set to: ${args.videoDir}`);
    if (msg.length === 0) return textResponse('No directory provided.');
    return textResponse(msg.join('\n'));
  } catch (error) {
    return textResponse(String(error), true);
  }
}
