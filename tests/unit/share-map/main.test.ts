import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { envelope, type MapPlace, type ToMap } from 'src/share-protocol';
import { startShareMap } from 'src/share-map/main';

const NOTICE = 'trip-map에서 내보낸 파일 안에서 쓰는 지도예요';

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
  async function setupFrame(opts: { dark?: boolean } = {}) {
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
    startShareMap(win, root);
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

  it('iframe 안이면 시작하자마자 parent에 ready(maxV 1)를 출처 "*"로 보낸다', async () => {
    const { post } = await setupFrame();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      { kind: 'ready', maxV: 1, source: 'tripmap-share', v: 1 },
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

  it('가짜 지도가 아니고 클라이언트 ID가 비어 있으면 ready 뒤 tiles-failed를 보내고 지도를 만들지 않는다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', '');
    const { post, root, receive, markers } = await setupFrame();
    expect(post.mock.calls).toEqual([
      [{ kind: 'ready', maxV: 1, source: 'tripmap-share', v: 1 }, '*'],
      [{ kind: 'tiles-failed', source: 'tripmap-share', v: 1 }, '*'],
    ]);
    receive(envelope({ kind: 'init', places: PLACES }));
    expect(markers()).toHaveLength(0);
    expect(root.querySelector('script')).toBeNull();
  });
});
