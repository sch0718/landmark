import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeShareHash } from 'src/share-viewer/encode';
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
  window.onhashchange = null;
  window.history.replaceState(null, '', '/');
  setData(DOC);
  portMock.focus.mockReset();
  portMock.filter.mockReset();
  portMock.draw.mockReset();
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  Element.prototype.scrollIntoView = vi.fn();
  vi.resetModules();
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  importLinkMock.mockReset();
  window.onhashchange = null;
  vi.unstubAllGlobals();
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
    expect(a?.getAttribute('href')).toBe('https://landmark.sch0718.dev/import');
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
        addEventListener: () => undefined,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    setData(makeShareV2Doc());
    importLinkMock.mockResolvedValue({ kind: 'unsupported' });
    await import('src/share-viewer/main');
    expect(document.querySelector<HTMLAnchorElement>('a.directions')!.getAttribute('href')).toMatch(
      /^nmap:\/\//,
    );
  });

  it('화면 폭 질의가 바뀌면(change) 길찾기 링크를 다시 정한다', async () => {
    // 질의는 한 번만 만들고, 그 결과의 matches와 change 듣는 함수를 시험이 쥔다.
    const query = {
      matches: true,
      media: '(max-width: 767px)',
      listeners: [] as Array<() => void>,
      addEventListener(type: string, listener: () => void) {
        if (type === 'change') this.listeners.push(listener);
      },
    };
    const matchMedia = vi.fn((q: string) => {
      expect(q).toBe('(max-width: 767px)');
      return query as unknown as MediaQueryList;
    });
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    setData(makeShareV2Doc());
    importLinkMock.mockResolvedValue({ kind: 'unsupported' });
    await import('src/share-viewer/main');
    const href = () =>
      document.querySelector<HTMLAnchorElement>('a.directions')!.getAttribute('href');
    expect(href()).toMatch(/^nmap:\/\//);
    expect(query.listeners).toHaveLength(1);

    query.matches = false;
    for (const listener of query.listeners) listener();
    expect(href()).toMatch(/^https:\/\/map\.naver\.com\/p\/directions\//);
    expect(document.querySelector<HTMLAnchorElement>('a.directions')!.target).toBe('_blank');

    query.matches = true;
    for (const listener of query.listeners) listener();
    expect(href()).toMatch(/^nmap:\/\//);
    expect(matchMedia).toHaveBeenCalledTimes(1);
  });

  it('옛 브라우저(addListener만 있음)에서도 화면 폭이 바뀌면 길찾기 링크를 다시 정한다', async () => {
    const query = {
      matches: true,
      media: '(max-width: 767px)',
      listeners: [] as Array<() => void>,
      addListener(listener: () => void) {
        this.listeners.push(listener);
      },
    };
    window.matchMedia = (() => query as unknown as MediaQueryList) as typeof window.matchMedia;
    setData(makeShareV2Doc());
    importLinkMock.mockResolvedValue({ kind: 'unsupported' });
    await import('src/share-viewer/main');
    const href = () =>
      document.querySelector<HTMLAnchorElement>('a.directions')!.getAttribute('href');
    expect(href()).toMatch(/^nmap:\/\//);
    expect(query.listeners).toHaveLength(1);

    query.matches = false;
    for (const listener of query.listeners) listener();
    expect(href()).toMatch(/^https:\/\/map\.naver\.com\/p\/directions\//);
  });

  it('화면 폭 변화를 들을 수 없는 브라우저에서도 던지지 않고 보기 화면을 그린다', async () => {
    window.matchMedia = ((query: string) =>
      ({ matches: true, media: query }) as unknown as MediaQueryList) as typeof window.matchMedia;
    setData(makeShareV2Doc());
    importLinkMock.mockResolvedValue({ kind: 'unsupported' });
    await expect(import('src/share-viewer/main')).resolves.toBeDefined();
    expect(document.querySelector('[role=tablist]')).not.toBeNull();
    expect(document.querySelector<HTMLAnchorElement>('a.directions')!.getAttribute('href')).toMatch(
      /^nmap:\/\//,
    );
    expect(portMock.draw).toHaveBeenCalledTimes(1);
  });
});

describe('도메인 링크 보기', () => {
  it('빈 블록이면 해시를 풀고 같은 값으로 같은 탭 가져오기 링크를 만든다', async () => {
    const value = await encodeShareHash(DOC);
    window.history.replaceState(null, '', `/view#d=${value}`);
    document.getElementById('tripmap-share')!.textContent = '';
    await import('src/share-viewer/main');
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe(DOC.title));
    const a = document.querySelector<HTMLAnchorElement>('header a.import-link')!;
    expect(a.getAttribute('href')).toBe(`/import#d=${value}`);
    expect(a.target).toBe('');
    expect(importLinkMock).not.toHaveBeenCalled();
    expect(document.title).toBe(DOC.title);
  });

  it.each(['', '#d=!!', `#d=${'A'.repeat(32_001)}`])(
    '잘못된 링크는 안내와 앱 열기를 표시한다',
    async (hash) => {
      window.history.replaceState(null, '', `/view${hash}`);
      document.getElementById('tripmap-share')!.textContent = '';
      await import('src/share-viewer/main');
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain(
          '링크가 손상됐거나 너무 길어요. 보낸 사람에게 파일로 보내 달라고 해 주세요',
        ),
      );
      const a = document.querySelector<HTMLAnchorElement>('a')!;
      expect(a.textContent).toBe('Landmark 열기');
      expect(a.getAttribute('href')).toBe('/');
    },
  );

  it('데이터 블록이 있는 파일은 기존처럼 새 탭으로 가져온다', async () => {
    importLinkMock.mockResolvedValue({ kind: 'direct', href: 'https://x.test/import#d=abc' });
    await import('src/share-viewer/main');
    await flush();
    expect(document.querySelector<HTMLAnchorElement>('header a.import-link')!.target).toBe(
      '_blank',
    );
  });
});

it('다른 링크 해시로 이동하면 새 문서를 읽도록 같은 탭을 다시 연다', async () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { hash: '', reload });
  document.getElementById('tripmap-share')!.textContent = '';
  await import('src/share-viewer/main');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(reload).toHaveBeenCalledTimes(1);
});

it('#t= 해시면 갱신 모드로 읽는다', async () => {
  document.body.replaceChildren();
  window.history.replaceState(null, '', `/view#t=abcdefghij.${'v'.repeat(43)}`);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 410 })));
  await import('src/share-viewer/main');
  await flush();
  expect(fetch).toHaveBeenCalledWith('/api/trip-live/abcdefghij', expect.anything());
  expect(document.body).toHaveTextContent('공유가 끝난 일정이에요');
});
