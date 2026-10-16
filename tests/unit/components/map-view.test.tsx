import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FakeMapAdapter, FAKE_BOUNDS } from 'src/components/map/FakeMapAdapter';
import { buildClusterIndex, clusterFeatures } from 'src/components/map/cluster';
import { categoryColor, dayColor } from 'src/components/map/map-colors';
import { createMarkerLabelElement } from 'src/components/map/marker-label';
import type { MapMarker } from 'src/components/map/MapAdapter';
import { fitPoints, focusCamera } from 'src/components/map/camera';
import { MapView } from 'src/components/map/MapView';
import { StrictMode, useState } from 'react';
import { installMapResources } from './helpers/map-resources';

const sdk = vi.hoisted(() => ({
  load: (): Promise<void> => Promise.reject(new Error('blocked')),
  authFailure: null as (() => void) | null,
  authAlreadyFailed: false,
}));
vi.mock('src/components/map/load-naver-sdk', () => ({
  loadNaverSdk: vi.fn(() => sdk.load()),
  onNaverAuthFailure: vi.fn((cb: () => void) => {
    sdk.authFailure = cb;
    if (sdk.authAlreadyFailed) cb();
    return () => {
      if (sdk.authFailure === cb) sdk.authFailure = null;
    };
  }),
}));

let resources: ReturnType<typeof installMapResources>;
beforeEach(() => {
  resources = installMapResources();
});

afterEach(() => {
  cleanup();
  resources.restore();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sdk.load = () => Promise.reject(new Error('blocked'));
  sdk.authFailure = null;
  sdk.authAlreadyFailed = false;
});

const mk = (id: string, over: Partial<MapMarker> = {}): MapMarker => ({
  id,
  lng: 128,
  lat: 37.5,
  label: id,
  color: '#f00',
  clusterable: true,
  ...over,
});

describe('MapView (Fake 어댑터)', () => {
  it('마커를 그리고 클릭 콜백에 id를 넘기며 bounds를 한 번 알린다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    const onMarkerClick = vi.fn();
    const onBoundsChange = vi.fn();
    render(
      <MapView
        markers={[mk('a'), mk('b')]}
        polylines={[{ id: 'l1', path: [[128, 37]], color: '#00f', dashed: true }]}
        onMarkerClick={onMarkerClick}
        onBoundsChange={onBoundsChange}
        onUnavailable={vi.fn()}
      />,
    );
    await screen.findByTestId('fake-map');
    await userEvent.click(await screen.findByTestId('marker-b'));
    expect(onMarkerClick).toHaveBeenCalledWith('b');
    expect(screen.getByTestId('polyline-l1')).toHaveAttribute('data-dashed', 'true');
    await waitFor(() => expect(onBoundsChange).toHaveBeenCalledTimes(1));
    expect(onBoundsChange).toHaveBeenCalledWith(FAKE_BOUNDS);
  });

  it('마커 prop이 바뀌면 다시 그린다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    const props = { polylines: [], onMarkerClick: vi.fn(), onUnavailable: vi.fn() };
    const { rerender } = render(<MapView markers={[mk('a')]} {...props} />);
    await screen.findByTestId('marker-a');
    rerender(<MapView markers={[mk('c')]} {...props} />);
    await screen.findByTestId('marker-c');
    expect(screen.queryByTestId('marker-a')).toBeNull();
  });
});

describe('MapView 확대·축소 버튼', () => {
  const touchOnly = (on: boolean) =>
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: on && q === '(any-hover: none) and (any-pointer: coarse)',
    }));
  afterEach(() => vi.unstubAllGlobals());

  it('터치 전용 기기면 44px ＋/− 버튼을 그리고 한 단계씩 확대·축소한다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    touchOnly(true);
    render(
      <MapView
        markers={[mk('a')]}
        polylines={[]}
        onMarkerClick={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    const map = await screen.findByTestId('fake-map');
    const zoomIn = await screen.findByRole('button', { name: '지도 확대' });
    const zoomOut = screen.getByRole('button', { name: '지도 축소' });
    expect(screen.getByRole('group', { name: '지도 확대·축소' })).toContainElement(zoomIn);
    // 가짜 지도는 카메라를 바꿀 때만 줌을 적으므로 첫 확대 뒤 값을 기준으로 본다.
    await userEvent.click(zoomIn);
    const zoomed = Number(map.dataset.zoom);
    expect(Number.isFinite(zoomed)).toBe(true);
    await userEvent.click(zoomIn);
    expect(Number(map.dataset.zoom)).toBe(zoomed + 1);
    await userEvent.click(zoomOut);
    await userEvent.click(zoomOut);
    expect(Number(map.dataset.zoom)).toBe(zoomed - 1);
  });

  // 버튼을 그리는 쪽이 SDK 막대도 끈다. 둘이 어긋나면 막대와 버튼이 겹치거나 축소 수단이 없어진다.
  it.each([
    [true, false],
    [false, true],
  ])('터치 전용(%s)이면 네이버 지도를 zoomControl=%s로 만든다', async (touch, zoomControl) => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'cid');
    touchOnly(touch);
    const MapCtor = vi.fn(() => {
      throw new Error('지도 생성자만 본다');
    });
    (window as unknown as { naver: unknown }).naver = {
      maps: { Map: MapCtor, LatLng: vi.fn() },
    };
    sdk.load = () => Promise.resolve();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unavailable = vi.fn();
    try {
      render(
        <MapView markers={[]} polylines={[]} onMarkerClick={vi.fn()} onUnavailable={unavailable} />,
      );
      await waitFor(() => expect(unavailable).toHaveBeenCalled());
      expect(MapCtor).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ zoomControl }),
      );
    } finally {
      delete (window as { naver?: unknown }).naver;
    }
  });

  it('마우스가 있는 기기에서는 버튼을 그리지 않는다(SDK 막대를 쓴다)', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    touchOnly(false);
    render(
      <MapView
        markers={[mk('a')]}
        polylines={[]}
        onMarkerClick={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    await screen.findByTestId('marker-a');
    expect(screen.queryByRole('button', { name: '지도 확대' })).toBeNull();
  });
});

describe('MapView 크기 추적', () => {
  it('SDK가 마운트 요소에 고정 px 크기를 써도, 측정 요소는 별도라서 영역이 다시 넓어지면 따라간다', async () => {
    // 네이버 SDK의 setSize는 마운트 요소에 width/height px를 인라인으로 쓴다.
    // 측정(ResizeObserver) 대상이 그 요소면 부모가 넓어져도 크기가 안 바뀌어 하얀 영역이 남는다.
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    const resize = vi.spyOn(FakeMapAdapter.prototype, 'resize').mockImplementation(function (
      this: FakeMapAdapter,
      w: number,
      h: number,
    ) {
      const target = resources.mount.mock.calls.at(-1)?.[0] as HTMLElement | undefined;
      if (target) Object.assign(target.style, { width: `${w}px`, height: `${h}px` });
      this.resizeCalls.push([w, h]);
    });
    render(
      <MapView
        markers={[mk('a')]}
        polylines={[]}
        onMarkerClick={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    await screen.findByTestId('marker-a');
    const frame = screen.getByTestId('map-host');
    const mounted = resources.mount.mock.calls.at(-1)?.[0] as HTMLElement;
    expect(mounted).not.toBe(frame);
    expect(frame.contains(mounted)).toBe(true);

    act(() => resources.setSize(frame, 1068, 774));
    await waitFor(() => expect(resize).toHaveBeenLastCalledWith(1068, 774));
    act(() => resources.setSize(frame, 748, 774)); // 장소 상세 열림
    await waitFor(() => expect(resize).toHaveBeenLastCalledWith(748, 774));
    act(() => resources.setSize(frame, 1068, 774)); // 상세 닫힘
    await waitFor(() => expect(resize).toHaveBeenLastCalledWith(1068, 774));
    expect(frame.style.width).toBe('');
  });
});

describe('MapView 내 위치·단추 기둥', () => {
  const touchOnly = (on: boolean) =>
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: on && q === '(any-hover: none) and (any-pointer: coarse)',
    }));
  afterEach(() => vi.unstubAllGlobals());
  const base = { polylines: [], onMarkerClick: vi.fn(), onUnavailable: vi.fn() };

  it('myLocation을 넘기면 준비된 뒤 my-location 요소가 생기고 값이 바뀌면 갱신, null이면 사라진다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    const { rerender } = render(
      <MapView markers={[]} myLocation={{ lng: 128.9, lat: 37.75, accuracyM: 30 }} {...base} />,
    );
    const el = await screen.findByTestId('my-location');
    expect(el).toHaveAttribute('data-accuracy', '30');
    rerender(
      <MapView markers={[]} myLocation={{ lng: 128.9, lat: 37.75, accuracyM: 45 }} {...base} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('my-location')).toHaveAttribute('data-accuracy', '45'),
    );
    rerender(<MapView markers={[]} myLocation={null} {...base} />);
    await waitFor(() => expect(screen.queryByTestId('my-location')).toBeNull());
  });

  it('같은 좌표·정확도의 새 객체로는 setMyLocation을 다시 부르지 않는다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    const spy = vi.spyOn(FakeMapAdapter.prototype, 'setMyLocation');
    const { rerender } = render(
      <MapView markers={[]} myLocation={{ lng: 128.9, lat: 37.75, accuracyM: 30 }} {...base} />,
    );
    await screen.findByTestId('my-location');
    const calls = spy.mock.calls.length;
    rerender(
      <MapView markers={[]} myLocation={{ lng: 128.9, lat: 37.75, accuracyM: 30 }} {...base} />,
    );
    expect(spy.mock.calls.length).toBe(calls);
    spy.mockRestore();
  });

  it('controls는 map-controls 안에 있고, 터치 전용이면 지도 축소 다음에 온다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    touchOnly(true);
    render(<MapView markers={[]} controls={<button type="button">x</button>} {...base} />);
    const column = await screen.findByTestId('map-controls');
    const zoomOut = await screen.findByRole('button', { name: '지도 축소' });
    const extra = screen.getByRole('button', { name: 'x' });
    expect(column).toContainElement(zoomOut);
    expect(column).toContainElement(extra);
    expect(zoomOut.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(column).top).toBe('8px');
    expect(getComputedStyle(column).right).toBe('8px');
  });

  it('마우스 기기에서도 controls는 보이고 ＋/−는 없다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    touchOnly(false);
    render(<MapView markers={[]} controls={<button type="button">x</button>} {...base} />);
    expect(await screen.findByTestId('map-controls')).toContainElement(
      await screen.findByRole('button', { name: 'x' }),
    );
    expect(screen.queryByRole('button', { name: '지도 축소' })).toBeNull();
  });

  it('controlsRight만큼 기둥을 왼쪽으로 옮긴다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    render(
      <MapView
        markers={[]}
        controls={<button type="button">x</button>}
        controlsRight={360}
        {...base}
      />,
    );
    const column = await screen.findByTestId('map-controls');
    expect(getComputedStyle(column).right).toBe('368px');
  });

  it('extraFitPoints는 fitBounds에 더해지고, 마커가 없어도 한 번 맞춘다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
    const { rerender } = render(
      <MapView markers={[]} extraFitPoints={[[129, 38]]} fitKey="k1" {...base} />,
    );
    await screen.findByTestId('fake-map');
    await waitFor(() => expect(fit).toHaveBeenCalledTimes(1));
    // 점이 하나뿐이면 그 근처로 넓혀 맞추므로(영역이 0이 되지 않게) 그 점이 영역 안에 든다.
    const points = fit.mock.calls[0]![0];
    expect(Math.min(...points.map((p) => p[0]))).toBeLessThan(129);
    expect(Math.max(...points.map((p) => p[0]))).toBeGreaterThan(129);
    expect(Math.min(...points.map((p) => p[1]))).toBeLessThan(38);
    expect(Math.max(...points.map((p) => p[1]))).toBeGreaterThan(38);
    // 같은 fitKey에서는 다시 맞추지 않는다.
    rerender(<MapView markers={[]} extraFitPoints={[[129, 38]]} fitKey="k1" {...base} />);
    expect(fit).toHaveBeenCalledTimes(1);
    fit.mockRestore();
  });

  it('extraFitPoints가 있으면 마커 좌표와 함께 맞춘다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
    render(
      <MapView
        markers={[mk('a', { lng: 128, lat: 37 }), mk('b', { lng: 127, lat: 36 })]}
        extraFitPoints={[[129, 38]]}
        {...base}
      />,
    );
    await screen.findByTestId('marker-a');
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit.mock.calls[0]![0]).toEqual([
      [128, 37],
      [127, 36],
      [129, 38],
    ]);
    fit.mockRestore();
  });
});

describe('MapView fitKey', () => {
  it('마운트 직후 한 번, fitKey가 바뀔 때만 그때의 마커로 fitBounds한다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
    const props = { polylines: [], onMarkerClick: vi.fn(), onUnavailable: vi.fn() };
    const a = [mk('a', { lng: 128, lat: 37 }), mk('b', { lng: 129, lat: 38 })];
    const { rerender } = render(<MapView markers={a} fitKey="itinerary:d1" {...props} />);
    await screen.findByTestId('marker-a');
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit).toHaveBeenLastCalledWith([
      [128, 37],
      [129, 38],
    ]);

    // 같은 fitKey에서 마커만 바뀜(편집·선택) → 맞추지 않는다.
    rerender(
      <MapView markers={[...a, mk('c', { lng: 127, lat: 36 })]} fitKey="itinerary:d1" {...props} />,
    );
    await screen.findByTestId('marker-c');
    expect(fit).toHaveBeenCalledTimes(1);

    const d2 = [
      mk('x', { lng: 126, lat: 35 }),
      mk('y', { lng: 126.5, lat: 35.5, dimmed: true }),
      mk('z', { lng: 127, lat: 36 }),
    ];
    rerender(<MapView markers={d2} fitKey="itinerary:d2" {...props} />);
    await screen.findByTestId('marker-x');
    expect(fit).toHaveBeenCalledTimes(2);
    // 흐린 후보 마커는 맞추기 대상에서 뺀다.
    expect(fit).toHaveBeenLastCalledWith([
      [126, 35],
      [127, 36],
    ]);
    fit.mockRestore();
  });

  it('fitPoints: 점이 하나면 그 근처로 넓히고, 마커가 없으면 빈 배열', () => {
    expect(fitPoints([])).toEqual([]);
    expect(fitPoints([mk('a', { lng: 128, lat: 37 })])).toEqual([
      [127.995, 36.995],
      [128.005, 37.005],
    ]);
  });

  it('fitPoints: `fit: false` 마커는 빼고, 그것뿐이면 그 마커들로 맞춘다', () => {
    const day = mk('a', { lng: 128, lat: 37 });
    const other = { ...mk('b', { lng: 126, lat: 35 }), fit: false as const };
    const dim = { ...mk('c', { lng: 129, lat: 38 }), fit: false as const, dimmed: true };
    expect(fitPoints([day, mk('d', { lng: 128.5, lat: 37.5 }), other, dim])).toEqual([
      [128, 37],
      [128.5, 37.5],
    ]);
    // 맞출 마커가 없으면 `fit: false` 중 흐리지 않은 것으로.
    expect(fitPoints([other, { ...other, id: 'e', lng: 127 }, dim])).toEqual([
      [126, 35],
      [127, 35],
    ]);
  });
});

describe('지도 사용 불가', () => {
  it('SDK 로드가 실패하면 사유를 알리고, 호출자는 지도 없이 패널과 사유를 보여 준다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'cid');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reasons: string[] = [];

    function Connected() {
      const [unavailable, setUnavailable] = useState<string | null>(null);
      return (
        <>
          <div data-testid="trip-map-area">
            {!unavailable && (
              <MapView
                markers={[]}
                polylines={[]}
                onMarkerClick={vi.fn()}
                onUnavailable={(r) => {
                  reasons.push(r);
                  setUnavailable(r);
                }}
              />
            )}
          </div>
          {unavailable && <p>{unavailable}</p>}
          <div>panel-content</div>
        </>
      );
    }
    render(<Connected />);
    const msg = '지도를 불러오지 못했어요. 도메인 등록을 확인하세요';
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(reasons).toEqual([msg]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(screen.getByText('panel-content')).toBeInTheDocument();
    expect(screen.getByTestId('trip-map-area')).toBeEmptyDOMElement();
  });

  it('스크립트는 로드됐지만 인증 실패(navermap_authFailure)면 같은 사유로 알린다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'cid');
    sdk.load = () => new Promise<void>(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onUnavailable = vi.fn();
    const { unmount } = render(
      <MapView markers={[]} polylines={[]} onMarkerClick={vi.fn()} onUnavailable={onUnavailable} />,
    );
    await waitFor(() => expect(sdk.authFailure).not.toBeNull());
    sdk.authFailure!();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith(
      '지도를 불러오지 못했어요. 도메인 등록을 확인하세요',
    );
    unmount();
    expect(sdk.authFailure).toBeNull();
    warn.mockRestore();
  });

  it('기존 인증 실패가 등록 즉시 통지되면 SDK 요청 없이 callback을 해제한다', () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'cid');
    sdk.authAlreadyFailed = true;
    const load = vi.fn(() => new Promise<void>(() => {}));
    sdk.load = load;
    const unavailable = vi.fn();
    const order: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <MapView
        markers={[]}
        polylines={[]}
        onMarkerClick={vi.fn()}
        onReadyChange={(ready) => {
          if (!ready) order.push('not-ready');
        }}
        onUnavailable={(reason) => {
          order.push('unavailable');
          unavailable(reason);
        }}
      />,
    );
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(order.slice(0, 2)).toEqual(['not-ready', 'unavailable']);
    expect(sdk.authFailure).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('클라이언트 ID가 없으면 환경변수 안내와 함께 알린다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', '');
    const onUnavailable = vi.fn();
    render(
      <MapView markers={[]} polylines={[]} onMarkerClick={vi.fn()} onUnavailable={onUnavailable} />,
    );
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
    expect(onUnavailable.mock.calls[0]![0]).toContain('VITE_NAVER_MAP_CLIENT_ID');
  });
});

describe('createMarkerLabelElement', () => {
  const XSS = '<img src=x onerror=alert(1)>';

  it('라벨을 텍스트로만 넣고 img 요소를 만들지 않는다', () => {
    const el = createMarkerLabelElement(XSS, '#123456');
    expect(el.textContent).toBe(XSS);
    expect(el.querySelector('img')).toBeNull();
    expect(el.children).toHaveLength(0);
  });

  it('textColor·borderColor를 적용한다', () => {
    const el = createMarkerLabelElement('이름', '#112233', {
      textColor: '#445566',
      borderColor: '#778899',
    });
    expect(el.style.color).toBe('rgb(68, 85, 102)');
    expect(el.style.border).toContain('rgb(119, 136, 153)');
  });

  it('라벨의 가운데가 장소 좌표에 오도록 자기 크기의 절반만큼 끌어 올린다', () => {
    // 어댑터는 라벨 왼쪽 위 모서리를 좌표에 둔다. 가운데를 맞추지 않으면 이름이 좌표의 오른쪽 아래로 뻗어
    // 상세 패널처럼 지도 오른쪽을 덮는 요소에 가려진다.
    const el = createMarkerLabelElement('이름', '#123456');
    expect(el.style.transform).toBe('translate(-50%, -50%)');
  });

  it('기본값은 흰 글자·흰 테두리를 유지한다', () => {
    const el = createMarkerLabelElement('이름', '#112233');
    expect(el.style.color).toBe('rgb(255, 255, 255)');
    expect(el.style.border).toContain('rgb(255, 255, 255)');
  });

  it('긴 이름은 160px에서 말줄임하고 전체 이름을 title에 둔다', () => {
    const name = '아주 아주 긴 이름의 장소'.repeat(8);
    const el = createMarkerLabelElement(name, '#123456');
    expect(el.style.maxWidth).toBe('160px');
    expect(el.style.overflow).toBe('hidden');
    expect(el.style.textOverflow).toBe('ellipsis');
    expect(el.title).toBe(name);
  });

  it('선택된 마커는 13px 글자와 굵은 테두리를 쓴다', () => {
    const el = createMarkerLabelElement('이름', '#123456', {
      selected: true,
      borderColor: '#abcdef',
    });
    expect(el.style.fontSize).toBe('13px');
    expect(el.style.border).toContain('3px');
    expect(el.style.border).toContain('rgb(171, 205, 239)');
  });

  it('다녀온 마커는 ✓ 글자와 · 다녀옴 title을 쓴다', () => {
    const el = createMarkerLabelElement('경포대', '#123456', { visited: true });
    expect(el.textContent).toBe('✓ 경포대');
    expect(el.title).toBe('경포대 · 다녀옴');
    const plain = createMarkerLabelElement('경포대', '#123456', { visited: false });
    expect(plain.textContent).toBe('경포대');
    expect(plain.title).toBe('경포대');
    // 빈 라벨이면 title을 달지 않는다.
    expect(createMarkerLabelElement('', '#123456', { visited: true }).title).toBe('');
  });

  it('Fake 어댑터: 다녀옴 마커 버튼 글자와 title, 다녀옴으로 바뀌면 다시 그린다', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = new FakeMapAdapter();
    await fake.mount(host);
    const button = () => host.querySelector('[data-testid="marker-k"]')!;
    fake.setMarkers([mk('k', { label: '경포대' })]);
    expect(button().textContent).toBe('경포대');
    fake.setMarkers([mk('k', { label: '경포대', visited: true })]);
    expect(button().textContent).toBe('✓ 경포대');
    expect(button().querySelector('span')!.title).toBe('경포대 · 다녀옴');
    fake.setMarkers([mk('k', { label: '경포대' })]);
    expect(button().textContent).toBe('경포대');
    fake.destroy();
    host.remove();
  });

  it('Fake 어댑터도 같은 라벨을 쓴다', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = new FakeMapAdapter();
    await fake.mount(host);
    fake.setMarkers([mk('x', { label: XSS })]);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[data-testid="marker-x"]')!.textContent).toBe(XSS);
    fake.destroy();
    host.remove();
  });
});

describe('색상', () => {
  it('categoryColor는 결정적이고 null은 회색, 8색 안에서 고른다', () => {
    expect(categoryColor(null)).toBe('#9e9e9e');
    expect(categoryColor('카페')).toBe(categoryColor('카페'));
    const set = new Set(
      ['카페', '식당', '명소', '숙소', '바다', '산', '시장', '빵집', '술집', '공원'].map(
        categoryColor,
      ),
    );
    expect(set.size).toBeGreaterThan(1);
    expect(set.size).toBeLessThanOrEqual(8);
  });

  it('dayColor는 순번별로 다르고 팔레트를 순환한다', () => {
    expect(dayColor(0)).not.toBe(dayColor(1));
    expect(dayColor(8)).toBe(dayColor(0));
    expect(dayColor(-1)).toBe(dayColor(7));
  });
});

describe('클러스터 계산', () => {
  const near = [0, 1, 2, 3].map((i) => mk(`n${i}`, { lng: 128 + i * 0.0001, lat: 37.5 }));
  const far = mk('far', { lng: 126.5, lat: 35 });
  const fixed = mk('fix', { lng: 128, lat: 37.5, clusterable: false });
  const bounds = { west: 124, south: 33, east: 132, north: 39 };

  it('낮은 줌에서는 가까운 점을 클러스터로 묶고 먼 점은 개별로 둔다', () => {
    const ci = buildClusterIndex([...near, far, fixed]);
    const f = clusterFeatures(ci, bounds, 8);
    const clusters = f.filter((x) => x.kind === 'cluster');
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ count: 4 });
    expect(f.filter((x) => x.kind === 'point')).toEqual([
      expect.objectContaining({ markerId: 'far' }),
    ]);
    expect(ci.fixed.map((m) => m.id)).toEqual(['fix']);
  });

  it('높은 줌에서는 전부 개별 점이 되고 bbox 밖은 제외한다', () => {
    const ci = buildClusterIndex([...near, far]);
    expect(clusterFeatures(ci, bounds, 18).every((x) => x.kind === 'point')).toBe(true);
    const only = clusterFeatures(ci, { west: 126, south: 34, east: 127, north: 36 }, 18);
    expect(only).toHaveLength(1);
  });
});

describe('클러스터 해제 줌', () => {
  const bounds = { west: 124, south: 33, east: 132, north: 39 };
  // 약 400m 떨어진 두 장소(제주).
  const pair = [mk('p1', { lng: 126.53, lat: 33.5 }), mk('p2', { lng: 126.53, lat: 33.5036 })];

  it('줌 15부터는 400m 떨어진 두 장소가 개별 점이고, 줌 13에서는 하나로 묶인다', () => {
    const ci = buildClusterIndex(pair);
    const z15 = clusterFeatures(ci, bounds, 15);
    expect(z15.map((f) => f.kind)).toEqual(['point', 'point']);
    const z13 = clusterFeatures(ci, bounds, 13);
    expect(z13).toHaveLength(1);
    expect(z13[0]).toMatchObject({ kind: 'cluster', count: 2 });
  });

  it('줌 15부터는 50m 떨어진 장소도 묶지 않는다', () => {
    const ci = buildClusterIndex([
      mk('q1', { lng: 126.53, lat: 33.5 }),
      mk('q2', { lng: 126.53, lat: 33.50045 }),
    ]);
    expect(clusterFeatures(ci, bounds, 15).map((f) => f.kind)).toEqual(['point', 'point']);
    expect(clusterFeatures(ci, bounds, 14).map((f) => f.kind)).toEqual(['cluster']);
  });
});

describe('MapView 크기와 생명주기', () => {
  const props = {
    markers: [mk('a')],
    polylines: [],
    onMarkerClick: vi.fn(),
    onUnavailable: vi.fn(),
  };
  beforeEach(() => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  });

  it('숨김 최초 진입에는 mount하지 않고 첫 표시 후 같은 인스턴스를 유지한다', async () => {
    const destroy = vi.spyOn(FakeMapAdapter.prototype, 'destroy');
    const { rerender, unmount } = render(<MapView {...props} visible={false} />);
    expect(resources.mount).not.toHaveBeenCalled();
    rerender(<MapView {...props} visible />);
    await screen.findByTestId('marker-a');
    const id = screen.getByTestId('fake-map').dataset.instanceId;
    expect(id).toBeTruthy();
    rerender(<MapView {...props} visible={false} />);
    rerender(<MapView {...props} visible />);
    await waitFor(() => expect(resources.snapshot().observers).toBe(1));
    expect(screen.getByTestId('fake-map').dataset.instanceId).toBe(id);
    expect(resources.mount).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(resources.snapshot()).toEqual({
      activeAdapters: 0,
      callbackSlots: 0,
      observers: 0,
      observedHosts: 0,
      bodyTargets: 0,
      pendingFrames: 0,
      sdkListeners: 0,
      overlays: 0,
    });
  });

  it('초기 숨김 상태는 Naver SDK를 요청하지 않는다', () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'cid');
    const load = vi.fn(() => new Promise<void>(() => {}));
    sdk.load = load;
    render(<MapView {...props} visible={false} />);
    expect(load).not.toHaveBeenCalled();
    expect(sdk.authFailure).toBeNull();
  });

  it('숨김 중 그리기와 focus를 연기하고 재표시 때 최신 데이터와 padding을 적용한다', async () => {
    const markers = vi.spyOn(FakeMapAdapter.prototype, 'setMarkers');
    const lines = vi.spyOn(FakeMapAdapter.prototype, 'setPolylines');
    const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
    const { rerender } = render(<MapView {...props} />);
    await screen.findByTestId('marker-a');
    markers.mockClear();
    lines.mockClear();
    fit.mockClear();
    const changed = {
      ...props,
      markers: [mk('b')],
      polylines: [
        { id: 'l', path: [[128, 37]] as [number, number][], color: '#000', dashed: false },
      ],
      focus: { point: [129, 38] as [number, number], seq: 1 },
    };
    const padding = { top: 24, right: 24, bottom: 360, left: 24 };
    rerender(<MapView {...changed} visible={false} padding={padding} />);
    expect(markers).not.toHaveBeenCalled();
    expect(lines).not.toHaveBeenCalled();
    expect(fit).not.toHaveBeenCalled();
    const camera = vi.spyOn(FakeMapAdapter.prototype, 'setCamera');
    rerender(<MapView {...changed} visible padding={padding} />);
    await screen.findByTestId('marker-b');
    await waitFor(() => expect(camera).toHaveBeenLastCalledWith(focusCamera([129, 38], padding)));
  });

  describe('focusCamera', () => {
    it('padding이 고르면 장소가 지도 중심이고 줌은 16이다', () => {
      const even = { top: 40, right: 40, bottom: 40, left: 40 };
      expect(focusCamera([128, 37], even)).toEqual({ center: [128, 37], zoom: 16 });
    });

    it('오른쪽 padding이 크면 중심을 오른쪽(동쪽)으로 옮겨 장소가 보이는 영역 가운데에 온다', () => {
      // 오른쪽 400px·왼쪽 40px → 보이는 영역 가운데는 지도 중심보다 180px 왼쪽.
      const cam = focusCamera([128, 37], { top: 40, right: 400, bottom: 40, left: 40 });
      const degPerPx = 360 / (256 * 2 ** 16);
      expect(cam.zoom).toBe(16);
      expect(cam.center[0]).toBeCloseTo(128 + 180 * degPerPx, 9);
      expect(cam.center[1]).toBeCloseTo(37, 9);
    });

    it('아래 padding이 크면 중심을 아래(남쪽)로 옮긴다', () => {
      const cam = focusCamera([128, 37], { top: 24, right: 24, bottom: 360, left: 24 });
      expect(cam.center[0]).toBeCloseTo(128, 9);
      expect(cam.center[1]).toBeLessThan(37);
    });
  });

  it('빈 key는 첫 데이터에 fit하고 key 재방문에는 사용자의 카메라를 복원한다', async () => {
    const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
    const { rerender } = render(<MapView {...props} markers={[]} fitKey="a" />);
    await waitFor(() => expect(resources.snapshot().observers).toBe(1));
    expect(fit).not.toHaveBeenCalled();
    rerender(<MapView {...props} fitKey="a" />);
    await screen.findByTestId('marker-a');
    const adapter = [...resources.instances][0]!;
    adapter.setCamera({ center: [127, 36], zoom: 13 });
    rerender(<MapView {...props} fitKey="b" />);
    expect(fit).toHaveBeenCalledTimes(2);
    adapter.setCamera({ center: [130, 38], zoom: 10 });
    rerender(<MapView {...props} fitKey="a" />);
    expect(adapter.getCamera()).toEqual({ center: [127, 36], zoom: 13 });
    expect(fit).toHaveBeenCalledTimes(2);
  });

  it('focus는 화면 폭과 상관없이 줌 16으로, 장소를 padding을 뺀 영역의 가운데에 둔다', async () => {
    const padding = { top: 40, right: 400, bottom: 40, left: 40 };
    const { rerender } = render(
      <MapView {...props} padding={padding} focus={{ point: [128, 37], seq: 1 }} />,
    );
    await screen.findByTestId('marker-a');
    const adapter = [...resources.instances][0]!;
    await waitFor(() => expect(adapter.getCamera()).toEqual(focusCamera([128, 37], padding)));
    rerender(<MapView {...props} padding={padding} focus={{ point: [129, 38], seq: 2 }} />);
    await waitFor(() => expect(adapter.getCamera()).toEqual(focusCamera([129, 38], padding)));
    expect(adapter.getCamera()!.zoom).toBe(16);
  });

  it('padding만 바뀌면 fit과 카메라 이동을 반복하지 않고 다음 새 focus에 최신 padding을 쓴다', async () => {
    const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
    const camera = vi.spyOn(FakeMapAdapter.prototype, 'setCamera');
    const padding = { top: 24, right: 24, bottom: 164, left: 24 };
    const { rerender } = render(
      <MapView {...props} padding={padding} focus={{ point: [128, 37], seq: 1 }} />,
    );
    await waitFor(() => expect(camera).toHaveBeenLastCalledWith(focusCamera([128, 37], padding)));
    const fits = fit.mock.calls.length;
    const before = camera.mock.calls.length;
    const next = { ...padding, bottom: 360 };
    rerender(<MapView {...props} padding={next} focus={{ point: [128, 37], seq: 1 }} />);
    expect(fit).toHaveBeenCalledTimes(fits);
    expect(camera).toHaveBeenCalledTimes(before);
    rerender(<MapView {...props} padding={next} focus={{ point: [129, 38], seq: 2 }} />);
    expect(camera).toHaveBeenLastCalledWith(focusCamera([129, 38], next));
  });

  it('크기 변경은 zoom을 보존하고 같은 key를 다시 fit하지 않는다', async () => {
    const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
    const { unmount } = render(<MapView {...props} />);
    await screen.findByTestId('marker-a');
    const adapter = [...resources.instances][0]!;
    adapter.setCamera({ center: [127, 36], zoom: 14 });
    act(() => resources.setSize(screen.getByTestId('map-host'), 600, 700));
    await waitFor(() => expect(adapter.resizeCalls).toContainEqual([600, 700]));
    expect(adapter.getCamera()).toEqual({ center: [127, 36], zoom: 14 });
    expect(fit).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('StrictMode 정리 후 새 어댑터를 fit하며 자원을 남기지 않는다', async () => {
    const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
    const { unmount } = render(
      <StrictMode>
        <MapView {...props} />
      </StrictMode>,
    );
    await screen.findByTestId('marker-a');
    expect(resources.snapshot().activeAdapters).toBe(1);
    expect(resources.snapshot().callbackSlots).toBe(2);
    expect(fit).toHaveBeenCalledTimes(1);
    unmount();
    expect(Object.values(resources.snapshot()).every((count) => count === 0)).toBe(true);
  });

  it('SDK 로딩 중 unmount하면 늦은 완료와 실패 알림을 무시한다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'cid');
    let reject!: (error: Error) => void;
    sdk.load = () =>
      new Promise<void>((_, r) => {
        reject = r;
      });
    const unavailable = vi.fn();
    const ready = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { unmount } = render(
      <MapView {...props} onUnavailable={unavailable} onReadyChange={ready} />,
    );
    unmount();
    await act(async () => {
      reject(new Error('late'));
    });
    expect(unavailable).not.toHaveBeenCalled();
    expect(sdk.authFailure).toBeNull();
    expect(ready).not.toHaveBeenCalledWith(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('MapView 목록 전용 모드', () => {
  it('목록 전용으로 종료하면 지도 mount와 observer를 생성하지 않는다', () => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    const { unmount } = render(
      <MapView
        visible={false}
        markers={[]}
        polylines={[]}
        onMarkerClick={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    expect(resources.mount).not.toHaveBeenCalled();
    expect(resources.activeTargets()).toBe(0);
    unmount();
    expect(resources.snapshot()).toMatchObject({
      activeAdapters: 0,
      callbackSlots: 0,
      observedHosts: 0,
      pendingFrames: 0,
    });
  });
});
