import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { envelope, type MapPlace, type ToMap } from 'src/share-protocol';
import { startShareMap } from 'src/share-map/main';

const NOTICE = 'trip-map에서 내보낸 파일 안에서 쓰는 지도예요';

const PLACES: MapPlace[] = [
  { id: 'a', name: '서혜커피', lng: 127.11, lat: 37.37, color: 'orange' },
  { id: 'b', name: '정자 빵집', lng: 127.13, lat: 37.36, color: null },
];

describe('startShareMap', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('iframe 없이 직접 열면(parent가 자기 자신) 안내 문구만 보이고 지도를 만들지 않는다', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    startShareMap(window, root);
    expect(root.textContent).toBe(NOTICE);
    expect(root.querySelector('.leaflet-container')).toBeNull();
    expect(root.classList.contains('leaflet-container')).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  /** jsdom iframe의 창을 지도 페이지 창으로 쓴다: 그 `parent`가 내보낸 파일 쪽 창이다. */
  function setupFrame(opts: { dark?: boolean } = {}) {
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
    // iframe 창의 MessageEvent로 만들어야 jsdom이 그 창에 보낼 수 있다.
    const FrameMessageEvent = (win as unknown as { MessageEvent: typeof MessageEvent })
      .MessageEvent;
    const receive = (msg: ToMap | unknown, source: MessageEventSource | null = parent) => {
      win.dispatchEvent(new FrameMessageEvent('message', { data: msg, source }));
    };
    const icons = () => [...root.querySelectorAll<HTMLElement>('.leaflet-marker-icon')];
    return { win, post, root, receive, icons };
  }

  it('iframe 안이면 시작하자마자 parent에 ready(maxV 1)를 출처 "*"로 보낸다', () => {
    const { post } = setupFrame();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      { kind: 'ready', maxV: 1, source: 'tripmap-share', v: 1 },
      '*',
    );
  });

  it('parent가 보낸 init으로 마커를 그린다', () => {
    const { receive, icons, root } = setupFrame();
    expect(root.textContent).not.toContain(NOTICE);
    receive(envelope({ kind: 'init', places: PLACES }));
    expect(icons().map((i) => i.textContent)).toEqual(['서혜커피', '정자 빵집']);
  });

  it('parent가 아닌 창에서 온 메시지는 무시한다', () => {
    const { win, receive, icons } = setupFrame();
    receive(envelope({ kind: 'init', places: PLACES }), win);
    receive(envelope({ kind: 'init', places: PLACES }), null);
    expect(icons()).toHaveLength(0);
  });

  it('모양이 틀린 메시지는 무시한다', () => {
    const { receive, icons } = setupFrame();
    receive({ kind: 'init', places: PLACES });
    receive(envelope({ kind: 'init', places: [{ id: 'x' }] } as unknown as ToMap));
    expect(icons()).toHaveLength(0);
  });

  it('focus·filter를 지도에 전하고, 마커를 누르면 select를 parent에 보낸다', () => {
    const { receive, icons, post } = setupFrame();
    receive(envelope({ kind: 'init', places: PLACES }));
    receive(envelope({ kind: 'focus', placeId: 'b' }));
    const label = (name: string) =>
      icons().find((i) => i.textContent === name)?.firstElementChild as HTMLElement;
    expect(label('정자 빵집').style.borderWidth).toBe('3px');

    receive(envelope({ kind: 'filter', placeIds: ['a'] }));
    expect(icons().map((i) => i.textContent)).toEqual(['서혜커피']);

    icons()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(post).toHaveBeenLastCalledWith(
      { kind: 'select', placeId: 'a', source: 'tripmap-share', v: 1 },
      '*',
    );
  });

  it('prefers-color-scheme가 다크면 다크 토큰으로 칠한다', () => {
    const { receive, icons } = setupFrame({ dark: true });
    receive(envelope({ kind: 'init', places: PLACES }));
    const plain = icons().find((i) => i.textContent === '정자 빵집')
      ?.firstElementChild as HTMLElement;
    // pastel.dark.bg.surface #1B1B1F
    expect(plain.style.background).toContain('rgb(27, 27, 31)');
  });
});
