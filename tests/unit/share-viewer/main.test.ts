import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareDoc } from 'src/schema/share';
import { makeShareV2Doc } from '../helpers/share-v2-doc';

const importLinkMock = vi.hoisted(() => vi.fn());
const portMock = vi.hoisted(() => ({ focus: vi.fn(), filter: vi.fn(), draw: vi.fn() }));
vi.mock('src/share-viewer/encode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/share-viewer/encode')>()),
  importLink: importLinkMock,
}));
// 지도 iframe은 이 시험의 관심사가 아니다.
vi.mock('src/share-viewer/map-frame', () => ({
  connectMapFrame: () => portMock,
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

function setData(data: ShareDoc) {
  document.body.innerHTML = `<script type="application/json" id="tripmap-share">${JSON.stringify(data)}</script>`;
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  document.head.innerHTML = '';
  setData(DOC);
  portMock.focus.mockReset();
  portMock.filter.mockReset();
  portMock.draw.mockReset();
  window.matchMedia = ((query: string) =>
    ({ matches: false, media: query }) as MediaQueryList) as typeof window.matchMedia;
  Element.prototype.scrollIntoView = vi.fn();
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

  it('v1 데이터는 장소 목록으로 그린다(탭 없음)', async () => {
    importLinkMock.mockResolvedValue({ kind: 'unsupported' });
    await import('src/share-viewer/main');
    expect(document.querySelector('[role=tablist]')).toBeNull();
    expect(document.querySelector('ul[aria-label="장소 목록"]')).not.toBeNull();
    expect(portMock.draw).not.toHaveBeenCalled();
  });

  it('v2 데이터는 일정 모드로 그리고, 연결 전에 그린 첫 draw를 지도에 보낸다', async () => {
    setData(makeShareV2Doc());
    importLinkMock.mockResolvedValue({ kind: 'unsupported' });
    await import('src/share-viewer/main');
    expect(document.querySelector('[role=tablist]')).not.toBeNull();
    expect(document.querySelector('ul[aria-label="장소 목록"]')).toBeNull();
    expect(portMock.draw).toHaveBeenCalledTimes(1);
    expect(portMock.draw.mock.calls[0]![0].pins.length).toBeGreaterThan(0);

    // 탭을 바꾸면 연결된 지도로 바로 간다.
    [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')][1]!.click();
    expect(portMock.draw).toHaveBeenCalledTimes(2);
  });

  it('길찾기 링크는 화면 폭(767px 이하)에 따라 앱 주소를 쓴다', async () => {
    window.matchMedia = ((query: string) =>
      ({
        matches: query === '(max-width: 767px)',
        media: query,
      }) as MediaQueryList) as typeof window.matchMedia;
    setData(makeShareV2Doc());
    importLinkMock.mockResolvedValue({ kind: 'unsupported' });
    await import('src/share-viewer/main');
    expect(document.querySelector<HTMLAnchorElement>('a.directions')!.getAttribute('href')).toMatch(
      /^nmap:\/\//,
    );
  });
});
