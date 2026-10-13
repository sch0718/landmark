import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareDoc } from 'src/schema/share';

const importLinkMock = vi.hoisted(() => vi.fn());
vi.mock('src/share-viewer/encode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/share-viewer/encode')>()),
  importLink: importLinkMock,
}));
// 지도 iframe은 이 시험의 관심사가 아니다.
vi.mock('src/share-viewer/map-frame', () => ({
  connectMapFrame: () => ({ focus() {}, filter() {} }),
  shareMapUrl: () => 'https://map.test/',
  toMapPlaces: () => [],
}));

const DOC: ShareDoc = {
  format: 'tripmap-share',
  version: 1,
  title: '정자역 카페',
  createdAt: '2026-10-11T03:00:00.000Z',
  labels: [],
  places: [{ id: 'a', name: '서혜커피', address: '경기', lng: 127.1, lat: 37.36, labelIds: [] }],
};

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  document.head.innerHTML = '';
  document.body.innerHTML = `<script type="application/json" id="tripmap-share">${JSON.stringify(DOC)}</script>`;
  vi.resetModules();
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  importLinkMock.mockReset();
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('보기 화면 진입점', () => {
  it('가져오기 링크를 만들지 못해도(reject) 기본 /import 링크가 남고 처리되지 않은 rejection이 없다', async () => {
    importLinkMock.mockRejectedValue(new Error('압축 실패'));
    await import('src/share-viewer/main');
    await flush();
    await flush();
    const a = [...document.querySelectorAll('header a')].find(
      (el) => el.textContent === 'Landmark에 담기',
    );
    expect(a?.getAttribute('href')).toBe('https://landmark-c5f.pages.dev/import');
    expect(importLinkMock).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
  });

  it('만들어지면 링크를 바꾼다', async () => {
    importLinkMock.mockResolvedValue({ kind: 'direct', href: 'https://x.test/import#d=abc' });
    await import('src/share-viewer/main');
    await flush();
    const a = [...document.querySelectorAll('header a')].find(
      (el) => el.textContent === 'Landmark에 담기',
    );
    expect(a?.getAttribute('href')).toBe('https://x.test/import#d=abc');
  });
});
