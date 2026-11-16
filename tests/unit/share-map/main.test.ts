import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { envelope, type MapPlace, type ToMap } from 'src/share-protocol';
import { startShareMap } from 'src/share-map/main';
import * as mapModule from 'src/share-map/map';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import type { MapProvider } from 'src/components/map/map-provider';

const NOTICE = '랜드마크에서 내보낸 파일 안에서 쓰는 지도예요';

const PLACES: MapPlace[] = [
  { id: 'a', name: '서혜커피', lng: 127.11, lat: 37.37, color: 'orange' },
  { id: 'b', name: '정자 빵집', lng: 127.13, lat: 37.36, color: null },
];

/** 가짜 어댑터의 mount(Promise)가 끝나도록 기다린다. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('startShareMap', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    // 기본은 DOM 가짜 지도(e2e 빌드와 같은 규칙).
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    document.body.replaceChildren();
  });

  it('iframe 없이 직접 열면(parent가 자기 자신) 안내 문구만 보이고 지도를 만들지 않는다', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    startShareMap(window, root);
    await settle();
    expect(root.textContent).toBe(NOTICE);
    expect(root.querySelector('[data-testid="fake-map"]')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  /** jsdom iframe의 창을 지도 페이지 창으로 쓴다: 그 `parent`가 내보낸 파일 쪽 창이다. */
  async function setupFrame(
    opts: { dark?: boolean; createAdapter?: Parameters<typeof startShareMap>[2] } = {},
  ) {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const win = frame.contentWindow;
    if (win === null) throw new Error('iframe 창 없음');
    const parent = win.parent;
    expect(parent).not.toBe(win);
    win.matchMedia = vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && opts.dark === true,
    })) as unknown as Window['matchMedia'];
    const post = vi.spyOn(parent, 'postMessage').mockImplementation(() => {});
    const root = document.createElement('div');
    Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(root, 'clientHeight', { configurable: true, get: () => 600 });
    document.body.append(root);
    startShareMap(win, root, opts.createAdapter);
    await settle();
    // iframe 창의 MessageEvent로 만들어야 jsdom이 그 창에 보낼 수 있다.
    const FrameMessageEvent = (win as unknown as { MessageEvent: typeof MessageEvent })
      .MessageEvent;
    const receive = (msg: ToMap | unknown, source: MessageEventSource | null = parent) => {
      win.dispatchEvent(new FrameMessageEvent('message', { data: msg, source }));
    };
    const markers = () => [...root.querySelectorAll<HTMLElement>('[data-testid^="marker-"]')];
    return { win, post, root, receive, markers };
  }

  it('iframe 안이면 시작하자마자 parent에 ready(maxV 2, 봉투는 v 1)를 출처 "*"로 보낸다', async () => {
    const { post } = await setupFrame();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      { kind: 'ready', maxV: 2, source: 'tripmap-share', v: 1 },
      '*',
    );
  });

  it('parent가 보낸 init으로 마커를 그린다', async () => {
    const { receive, markers, root } = await setupFrame();
    expect(root.textContent).not.toContain(NOTICE);
    receive(envelope({ kind: 'init', places: PLACES }));
    expect(markers().map((m) => m.textContent)).toEqual(['서혜커피', '정자 빵집']);
  });

  it('parent가 아닌 창에서 온 메시지는 무시한다', async () => {
    const { win, receive, markers } = await setupFrame();
    receive(envelope({ kind: 'init', places: PLACES }), win);
    receive(envelope({ kind: 'init', places: PLACES }), null);
    expect(markers()).toHaveLength(0);
  });

  it('모양이 틀린 메시지는 무시한다', async () => {
    const { receive, markers } = await setupFrame();
    receive({ kind: 'init', places: PLACES });
    receive(envelope({ kind: 'init', places: [{ id: 'x' }] } as unknown as ToMap));
    expect(markers()).toHaveLength(0);
  });

  it('focus·filter를 지도에 전하고, 마커를 누르면 select를 parent에 보낸다', async () => {
    const { receive, markers, post } = await setupFrame();
    receive(envelope({ kind: 'init', places: PLACES }));
    receive(envelope({ kind: 'focus', placeId: 'b' }));
    const marker = (name: string) => markers().find((m) => m.textContent === name);
    expect(marker('정자 빵집')?.getAttribute('aria-pressed')).toBe('true');
    expect(marker('서혜커피')?.hasAttribute('aria-pressed')).toBe(false);

    receive(envelope({ kind: 'filter', placeIds: ['a'] }));
    expect(markers().map((m) => m.textContent)).toEqual(['서혜커피']);

    markers()[0]?.click();
    expect(post).toHaveBeenLastCalledWith(
      { kind: 'select', placeId: 'a', source: 'tripmap-share', v: 1 },
      '*',
    );
  });

  it('prefers-color-scheme가 다크면 다크 토큰으로 칠한다', async () => {
    const { receive, markers } = await setupFrame({ dark: true });
    receive(envelope({ kind: 'init', places: PLACES }));
    const plain = markers().find((m) => m.textContent === '정자 빵집')
      ?.firstElementChild as HTMLElement;
    // pastel.dark.bg.surface #1B1B1F
    expect(plain.style.background).toContain('rgb(27, 27, 31)');
  });

  it('v 2 봉투 draw가 오면 마커와 경로선을 그린다', async () => {
    const { receive, markers, root } = await setupFrame();
    const draw = envelope(
      {
        kind: 'draw',
        pins: [
          { id: 's1', label: '1 서혜커피', lng: 127.11, lat: 37.37, day: 0, role: 'stop' },
          { id: 'start:h', label: '🏠 집', lng: 127.1, lat: 37.35, day: 0, role: 'endpoint' },
        ],
        lines: [
          {
            id: 'leg1',
            day: 0,
            walk: false,
            path: [
              [127.1, 37.35],
              [127.11, 37.37],
            ],
          },
        ],
      },
      2,
    );
    receive(draw);
    expect(markers().map((m) => m.textContent)).toEqual(['1 서혜커피', '🏠 집']);
    expect(root.querySelectorAll('[data-testid^="polyline-"]')).toHaveLength(1);
  });

  it('v 1 봉투 draw는 무시한다', async () => {
    const { receive, markers } = await setupFrame();
    receive(
      envelope({
        kind: 'draw',
        pins: [{ id: 's1', label: '1', lng: 127.11, lat: 37.37, day: 0, role: 'stop' }],
        lines: [],
      }),
    );
    expect(markers()).toHaveLength(0);
  });

  it('일정 지도의 마커를 누르면 핀 id로 select를 보낸다', async () => {
    const { receive, markers, post } = await setupFrame();
    receive(
      envelope(
        {
          kind: 'draw',
          pins: [
            { id: 'start:h', label: '🏠 집', lng: 127.1, lat: 37.35, day: 0, role: 'endpoint' },
          ],
          lines: [],
        },
        2,
      ),
    );
    markers()[0]?.click();
    expect(post).toHaveBeenLastCalledWith(
      { kind: 'select', placeId: 'start:h', source: 'tripmap-share', v: 1 },
      '*',
    );
  });

  it('v 2 봉투의 focus도 받는다', async () => {
    const { receive, markers } = await setupFrame();
    receive(envelope({ kind: 'init', places: PLACES }));
    receive(envelope({ kind: 'focus', placeId: 'b' }, 2));
    const marker = markers().find((m) => m.textContent === '정자 빵집');
    expect(marker?.getAttribute('aria-pressed')).toBe('true');
  });

  it.each([
    ['해외 장소', [{ ...PLACES[0]!, lng: 135.5, lat: 34.7 }], 'google'],
    ['한국 장소', PLACES, 'naver'],
    ['빈 목록', [], 'naver'],
  ] as const)('구글 키가 있으면 첫 init의 %s로 지도를 고른다', async (_, places, provider) => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'id');
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'key');
    const createAdapter = vi.fn<(provider: MapProvider) => Promise<{ adapter: FakeMapAdapter }>>(
      async () => ({
        adapter: new FakeMapAdapter(),
      }),
    );
    const { receive, markers } = await setupFrame({ createAdapter });
    expect(createAdapter).not.toHaveBeenCalled();
    receive(envelope({ kind: 'init', places: [...places] }));
    await settle();
    expect(createAdapter).toHaveBeenCalledExactlyOnceWith(provider);
    expect(markers()).toHaveLength(places.length);
    receive(envelope({ kind: 'init', places: PLACES }));
    expect(createAdapter).toHaveBeenCalledTimes(1);
  });

  it('첫 draw의 해외 핀으로 구글을 고른다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'id');
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'key');
    const createAdapter = vi.fn<(provider: MapProvider) => Promise<{ adapter: FakeMapAdapter }>>(
      async () => ({
        adapter: new FakeMapAdapter(),
      }),
    );
    const { receive, markers } = await setupFrame({ createAdapter });
    receive(
      envelope(
        {
          kind: 'draw',
          pins: [{ id: '해외', label: '명소', lng: 135.5, lat: 34.7, day: 0, role: 'stop' }],
          lines: [],
        },
        2,
      ),
    );
    await settle();
    expect(createAdapter).toHaveBeenCalledExactlyOnceWith('google');
    expect(markers()).toHaveLength(1);
  });

  it('어댑터 생성이 늦으면 첫 init 전후의 메시지를 모두 받은 순서대로 넘긴다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'id');
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'key');
    let release!: (value: { adapter: FakeMapAdapter }) => void;
    const createAdapter = vi.fn(
      () =>
        new Promise<{ adapter: FakeMapAdapter }>((resolve) => {
          release = resolve;
        }),
    );
    const calls: string[] = [];
    vi.spyOn(mapModule, 'createShareMap').mockReturnValue({
      init: () => {
        calls.push('init');
      },
      draw: () => {
        calls.push('draw');
      },
      filter: () => {
        calls.push('filter');
      },
      focus: () => {
        calls.push('focus');
      },
    });
    const { receive } = await setupFrame({ createAdapter });
    receive(envelope({ kind: 'focus', placeId: 'a' }));
    receive(envelope({ kind: 'filter', placeIds: ['a'] }));
    expect(createAdapter).not.toHaveBeenCalled();
    receive(envelope({ kind: 'init', places: PLACES }));
    receive(envelope({ kind: 'filter', placeIds: ['b'] }));
    receive(envelope({ kind: 'focus', placeId: 'b' }));
    expect(calls).toEqual([]);
    release({ adapter: new FakeMapAdapter() });
    await settle();
    expect(calls).toEqual(['focus', 'filter', 'init', 'filter', 'focus']);
    receive(envelope({ kind: 'focus', placeId: null }));
    expect(calls.at(-1)).toBe('focus');
    expect(createAdapter).toHaveBeenCalledTimes(1);
  });

  it('어댑터 import 실패는 tiles-failed로 알린다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'id');
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'key');
    const createAdapter = vi.fn(() => Promise.reject(new Error('불러오기 실패')));
    const { receive, post } = await setupFrame({ createAdapter });
    receive(envelope({ kind: 'init', places: PLACES }));
    await settle();
    expect(post).toHaveBeenLastCalledWith(envelope({ kind: 'tiles-failed' }), '*');
  });

  it('가짜 지도가 아니고 클라이언트 ID가 비어 있으면 ready 뒤 tiles-failed를 보내고 지도를 만들지 않는다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', '');
    const { post, root, receive, markers } = await setupFrame();
    expect(post.mock.calls).toEqual([
      [{ kind: 'ready', maxV: 2, source: 'tripmap-share', v: 1 }, '*'],
      [{ kind: 'tiles-failed', source: 'tripmap-share', v: 1 }, '*'],
    ]);
    receive(envelope({ kind: 'init', places: PLACES }));
    expect(markers()).toHaveLength(0);
    expect(root.querySelector('script')).toBeNull();
  });
});
