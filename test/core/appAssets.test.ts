import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pngSize } from '../../src/hooks/launcherFiles.js';

// The icons the launchers read from plugin/dist/ui/icons and the web app manifest (spec
// 2026-11-24-launcher-windows-macos §3): checked at their source in ui/, which the build copies as is.
const ui = path.resolve(__dirname, '..', '..', 'ui');
const icon = (f: string) => fs.readFileSync(path.join(ui, 'public', 'icons', f));

describe('app assets', () => {
  it('the launcher icons have the sizes the ICO (256) and ICNS (512) containers need', () => {
    expect(pngSize(icon('icon-256.png'))).toEqual({ width: 256, height: 256 });
    expect(pngSize(icon('icon-512.png'))).toEqual({ width: 512, height: 512 });
  });

  it('the manifest names the app and lists the 192, 512 and maskable icons, which exist', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ui, 'public', 'manifest.webmanifest'), 'utf8'));
    expect(m).toMatchObject({ name: 'AI Chat Center', short_name: 'AI Chat', start_url: '/', scope: '/', display: 'standalone' });
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.icons).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    for (const i of m.icons as { src: string; sizes: string }[]) {
      const { width, height } = pngSize(fs.readFileSync(path.join(ui, 'public', i.src)));
      expect(`${width}x${height}`).toBe(i.sizes);
    }
  });

  it('index.html links the manifest and sets the theme colour', () => {
    const html = fs.readFileSync(path.join(ui, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}" \/>/i);
  });
});
