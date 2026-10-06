import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider, useAtomValue, useSetAtom } from 'jotai';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FakeMapAdapter, FAKE_BOUNDS } from 'src/components/map/FakeMapAdapter';
import { buildClusterIndex, clusterFeatures } from 'src/components/map/cluster';
import { categoryColor, dayColor } from 'src/components/map/map-colors';
import { createMarkerLabelElement } from 'src/components/map/marker-label';
import type { MapMarker } from 'src/components/map/MapAdapter';
import { fitPoints, MapView } from 'src/components/map/MapView';
import { StrictMode } from 'react';
import { installMapResources } from './helpers/map-resources';
import { TripLayout } from 'src/layouts/TripLayout';
import { createTripStore, TripStoreContext } from 'src/stores/trip-store';

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
});

describe('지도 사용 불가', () => {
  it('SDK 로드가 실패하면 사유를 알리고, TripLayout은 지도 없이 패널과 사유를 보여 준다', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'cid');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ts = createTripStore('t1', { storage: window.localStorage });
    const store = createStore();
    const reasons: string[] = [];

    function Connected() {
      const setUnavailable = useSetAtom(ts.mapUnavailableAtom);
      const unavailable = useAtomValue(ts.mapUnavailableAtom);
      return (
        <TripLayout
          topBar={<div>top</div>}
          view="map"
          layout="compact"
          detail={{ open: false, content: null, onClose: vi.fn() }}
          unavailable={unavailable}
          routeMapVisible={false}
          onMapPaddingChange={vi.fn()}
          map={
            <MapView
              markers={[]}
              polylines={[]}
              onMarkerClick={vi.fn()}
              onUnavailable={(r) => {
                reasons.push(r);
                setUnavailable(r);
              }}
            />
          }
          panel={<div>panel-content</div>}
        />
      );
    }
    render(
      <TripStoreContext value={ts}>
        <Provider store={store}>
          <Connected />
        </Provider>
      </TripStoreContext>,
    );
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

  it('mapUnavailableAtom은 여행(store)마다 따로이고 초기값이 null이다', () => {
    const a = createTripStore('a', { storage: window.localStorage });
    const b = createTripStore('b', { storage: window.localStorage });
    expect(a.mapUnavailableAtom).not.toBe(b.mapUnavailableAtom);
    const s = createStore();
    expect(s.get(a.mapUnavailableAtom)).toBeNull();
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
    rerender(<MapView {...changed} visible padding={padding} />);
    await screen.findByTestId('marker-b');
    await waitFor(() => expect(fit).toHaveBeenCalledTimes(1));
    expect(fit).toHaveBeenLastCalledWith(
      [
        [128.995, 37.995],
        [129.005, 38.005],
      ],
      padding,
    );
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

  it('padding만 바뀌면 fit과 카메라 복원을 반복하지 않고 다음 새 focus에 최신 padding을 쓴다', async () => {
    const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
    const camera = vi.spyOn(FakeMapAdapter.prototype, 'setCamera');
    const padding = { top: 24, right: 24, bottom: 164, left: 24 };
    const { rerender } = render(
      <MapView {...props} padding={padding} focus={{ point: [128, 37], seq: 1 }} />,
    );
    await waitFor(() => expect(fit).toHaveBeenCalledTimes(2));
    const before = camera.mock.calls.length;
    const next = { ...padding, bottom: 360 };
    rerender(<MapView {...props} padding={next} focus={{ point: [128, 37], seq: 1 }} />);
    expect(fit).toHaveBeenCalledTimes(2);
    expect(camera).toHaveBeenCalledTimes(before);
    rerender(<MapView {...props} padding={next} focus={{ point: [129, 38], seq: 2 }} />);
    expect(fit).toHaveBeenCalledTimes(3);
    expect(fit.mock.calls[2]![1]).toEqual(next);
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
