import { chromium, BrowserContext, Locator } from 'playwright';

export async function launchPersistentBrowser(
  profileDir: string,
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

/**
 * blob: sources are read straight off the already-decoded <img> via canvas — some apps'
 * CSP (e.g. Gemini's) blocks `fetch()` on blob: URLs even from same-page script, but canvas
 * readback of a same-origin/blob image isn't a network request, so CSP connect-src never applies.
 * https sources go through the context's request API so the auth cookies are attached.
 */
export async function downloadImageFromPage(
  context: BrowserContext,
  image: Locator,
  src: string,
): Promise<{ base64: string; mimeType: string }> {
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    const base64 = await image.evaluate((img: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    return { base64, mimeType: 'image/png' };
  }

  if (!src.startsWith('https://')) {
    throw new Error('Generated image source must use HTTPS');
  }

  const res = await context.request.get(src);
  if (!res.ok()) {
    throw new Error(`Failed to download generated image (status ${res.status()})`);
  }
  const buffer = await res.body();
  const mimeType = res.headers()['content-type']?.split(';')[0]?.trim() || 'image/png';
  return { base64: buffer.toString('base64'), mimeType };
}
