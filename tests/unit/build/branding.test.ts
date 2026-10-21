import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pastel } from 'src/theme/tokens/pastel';

describe('앱 아이콘과 설치 메타데이터', () => {
  it('진입 HTML에 파비콘·홈 화면 아이콘·매니페스트와 모드별 바탕색이 있다', () => {
    const html = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html');
    const favicon = html.querySelector('link[rel="icon"]');
    expect(favicon?.getAttribute('href')).toBe('/favicon.svg');
    expect(favicon?.getAttribute('type')).toBe('image/svg+xml');
    expect(html.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
      '/apple-touch-icon.png',
    );
    expect(html.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe(
      '/manifest.webmanifest',
    );
    for (const mode of ['light', 'dark'] as const) {
      expect(
        html
          .querySelector(`meta[name="theme-color"][media="(prefers-color-scheme: ${mode})"]`)
          ?.getAttribute('content'),
      ).toBe(pastel[mode].bg.base);
    }
  });

  it('매니페스트의 필수 값과 일반·maskable 아이콘 파일이 유효하다', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(manifest).toMatchObject({
      name: '랜드마크',
      short_name: '랜드마크',
      lang: 'ko',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: pastel.light.bg.base,
      theme_color: pastel.light.bg.base,
    });
    expect(manifest.icons).toEqual([
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    for (const icon of manifest.icons) {
      expect(existsSync(`public${icon.src}`), icon.src).toBe(true);
      const png = readFileSync(`public${icon.src}`);
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
    const apple = readFileSync('public/apple-touch-icon.png');
    expect(apple.readUInt32BE(16)).toBe(180);
    expect(apple.readUInt32BE(20)).toBe(180);
    expect(readFileSync('public/favicon.svg', 'utf8')).toBe(
      readFileSync('docs/branding/icon-a.svg', 'utf8'),
    );
  });
});
