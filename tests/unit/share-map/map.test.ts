import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import type { MapMarker, MapPadding } from 'src/components/map/MapAdapter';
import type { FromMap, MapPlace } from 'src/share-protocol';
import { FOCUS_ZOOM, createShareMap } from 'src/share-map/map';
import { pastel } from 'src/theme/tokens/pastel';

const A: MapPlace = { id: 'a', name: '서혜커피', lng: 127.11, lat: 37.37, color: 'orange' };
const B: MapPlace = { id: 'b', name: '<b>굵게</b>', lng: 127.13, lat: 37.36, color: null };
const C: MapPlace = { id: 'c', name: '정자 빵집', lng: 127.12, lat: 37.38, color: 'blue' };

/**
 * 카메라가 움직이는 가짜 어댑터. `fitBounds`는 점들의 가운데로 옮기고 `fitZoom` 줌으로 간다
 * (실제 지도에서 아주 가까운 곳들을 맞추면 줌 18~19까지 들어가는 경우를 흉내 낸다).
 */
class CameraFake extends FakeMapAdapter {
  fitZoom = 12;

  override fitBounds(points: [number, number][], padding?: MapPadding): void {
    super.fitBounds(points, padding);
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    this.setCamera({
      center: [
        (Math.min(...lngs) + Math.max(...lngs)) / 2,
        (Math.min(...lats) + Math.max(...lats)) / 2,
      ],
      zoom: this.fitZoom,
    });
  }
}

/** mount를 테스트가 끝내는 가짜 어댑터(SDK를 받는 동안 메시지가 먼저 오는 경우). */
class DeferredFake extends CameraFake {
  finish: () => void = () => {};
  fail: (e: Error) => void = () => {};

  override mount(el: HTMLElement): Promise<void> {
    return new Promise((resolve, reject) => {
      this.finish = () => {
        void super.mount(el).then(resolve);
      };
      this.fail = reject;
    });
  }
}

/** jsdom은 레이아웃이 없으니 컨테이너 크기를 직접 정한다. */
function sizedContainer(size = { w: 800, h: 600 }) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => size.w });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => size.h });
  document.body.append(el);
  return { el, size };
}

/** mount(Promise)가 끝나도록 기다린다. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function setup(
  opts: {
    dark?: boolean;
    size?: { w: number; h: number };
    adapter?: CameraFake;
    onAuthFailure?: (cb: () => void) => () => void;
  } = {},
) {
  const { el, size } = sizedContainer(opts.size);
  const post = vi.fn<(msg: FromMap) => void>();
  const adapter = opts.adapter ?? new CameraFake();
  const setMarkers = vi.spyOn(adapter, 'setMarkers');
  const handle = createShareMap(el, post, {
    adapter,
    ...(opts.dark === undefined ? {} : { dark: opts.dark }),
    ...(opts.onAuthFailure === undefined ? {} : { onAuthFailure: opts.onAuthFailure }),
  });
  await settle();
  const markerButtons = () => [...el.querySelectorAll<HTMLElement>('[data-testid^="marker-"]')];
  const markerOf = (id: string) => {
    const button = el.querySelector<HTMLElement>(`[data-testid="marker-${id}"]`);
    if (button === null) throw new Error(`마커 없음: ${id}`);
    return button;
  };
  const labelOf = (id: string) => markerOf(id).firstElementChild as HTMLElement;
  /** 마지막으로 어댑터에 넘긴 마커들. */
  const lastMarkers = (): MapMarker[] => setMarkers.mock.calls.at(-1)?.[0] ?? [];
  const markerData = (id: string) => {
    const marker = lastMarkers().find((m) => m.id === id);
    if (marker === undefined) throw new Error(`마커 없음: ${id}`);
    return marker;
  };
  const camera = () => adapter.getCamera();
  return {
    el,
    size,
    post,
    handle,
    adapter,
    markerButtons,
    markerOf,
    labelOf,
    lastMarkers,
    markerData,
    camera,
  };
}

describe('createShareMap', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('FOCUS_ZOOM은 16이다', () => {
    expect(FOCUS_ZOOM).toBe(16);
  });

  it('지도는 컨테이너 안 별도 요소에 붙인다(SDK가 붙인 요소의 크기를 바꿔도 컨테이너 측정은 그대로)', async () => {
    const { el } = await setup();
    const map = el.querySelector('[data-testid="fake-map"]');
    expect(map).not.toBeNull();
    expect(map?.parentElement).not.toBe(el);
    expect(el.contains(map ?? null)).toBe(true);
  });

  it('init: 장소마다 마커 하나, 이름은 글자 그대로(태그로 해석하지 않는다)', async () => {
    const { handle, markerButtons, markerOf } = await setup();
    handle.init([A, B, C]);
    expect(markerButtons()).toHaveLength(3);
    expect(markerOf('b').textContent).toBe('<b>굵게</b>');
    expect(markerOf('b').querySelector('b')).toBeNull();
    expect(markerOf('a').textContent).toBe('서혜커피');
  });

  it('마커 색: 라벨이 있으면 라벨 팔레트(fill·text·marker), 없으면 표면·기본 글자·테두리', async () => {
    const { handle, markerData } = await setup();
    handle.init([A, B]);
    const orange = pastel.light.label.orange;
    expect(markerData('a')).toMatchObject({
      label: '서혜커피',
      color: orange.fill,
      textColor: orange.text,
      borderColor: orange.marker,
      selected: false,
      clusterable: true,
    });
    expect(markerData('b')).toMatchObject({
      color: pastel.light.bg.surface,
      textColor: pastel.light.text.primary,
      borderColor: pastel.light.border,
    });
  });

  it('다크면 다크 토큰으로 칠하고, 클러스터는 강조색이다', async () => {
    const { handle, markerData, adapter } = await setup({ dark: true });
    handle.init([A, B]);
    expect(markerData('a').color).toBe(pastel.dark.label.orange.fill);
    expect(markerData('b').color).toBe(pastel.dark.bg.surface);
    expect(adapter.clusterStyle).toEqual({
      color: pastel.dark.accent.main,
      textColor: pastel.dark.accent.contrast,
    });
  });

  it('클러스터 색은 라이트 강조색', async () => {
    const { adapter } = await setup();
    expect(adapter.clusterStyle).toEqual({
      color: pastel.light.accent.main,
      textColor: pastel.light.accent.contrast,
    });
  });

  it('init: 여러 곳이면 모두 보이게 맞춘다(여백 40)', async () => {
    const { handle, adapter, camera } = await setup();
    handle.init([A, B, C]);
    expect(adapter.fitCalls).toEqual([
      [
        [A.lng, A.lat],
        [B.lng, B.lat],
        [C.lng, C.lat],
      ],
    ]);
    expect(camera()?.zoom).toBe(12);
    const fakeMap = document.querySelector<HTMLElement>('[data-testid="fake-map"]');
    expect(JSON.parse(fakeMap?.dataset.padding ?? 'null')).toEqual({
      top: 40,
      right: 40,
      bottom: 40,
      left: 40,
    });
  });

  it('init: 1곳이면 그 지점에 줌 16(맞추기 없음)', async () => {
    const { handle, adapter, camera } = await setup();
    handle.init([A]);
    expect(camera()).toEqual({ center: [A.lng, A.lat], zoom: 16 });
    expect(adapter.fitCalls).toHaveLength(0);
  });

  it('init: 모두 같은 좌표면 줌이 터지지 않고 16', async () => {
    const { handle, camera } = await setup();
    handle.init([A, { ...C, lng: A.lng, lat: A.lat }]);
    expect(camera()).toEqual({ center: [A.lng, A.lat], zoom: 16 });
  });

  it('init: 몇 미터 떨어진 여러 곳을 맞춰 줌이 16을 넘으면 16으로 내린다(가운데는 그대로)', async () => {
    const adapter = new CameraFake();
    adapter.fitZoom = 19;
    const { handle, camera } = await setup({ adapter });
    // 위도 0.00005도 ≈ 5.5m
    handle.init([A, { ...C, lng: A.lng, lat: A.lat + 0.00005 }]);
    expect(camera()?.zoom).toBe(16);
    expect(camera()?.center[0]).toBeCloseTo(A.lng, 6);
    expect(camera()?.center[1]).toBeCloseTo(A.lat + 0.000025, 6);
  });

  it('focus(id): 줌 16으로 그 장소에 가고 강조(selected, 강조색 테두리, 묶지 않음). null은 강조 해제', async () => {
    const { handle, camera, markerData, markerOf, labelOf } = await setup();
    handle.init([A, B, C]);
    expect(labelOf('c').style.borderWidth).toBe('2px');

    handle.focus('c');
    expect(camera()).toEqual({ center: [C.lng, C.lat], zoom: 16 });
    expect(markerData('c')).toMatchObject({
      selected: true,
      clusterable: false,
      borderColor: pastel.light.accent.main,
    });
    expect(markerData('a')).toMatchObject({ selected: false, clusterable: true });
    expect(markerOf('c').getAttribute('aria-pressed')).toBe('true');
    expect(labelOf('c').style.borderWidth).toBe('3px');
    expect(labelOf('a').style.borderWidth).toBe('2px');

    handle.focus('a');
    expect(markerData('c')).toMatchObject({ selected: false, clusterable: true });
    expect(markerData('a')).toMatchObject({ selected: true, clusterable: false });

    handle.focus(null);
    expect(markerData('a')).toMatchObject({ selected: false, clusterable: true });
    expect(markerOf('a').hasAttribute('aria-pressed')).toBe(false);
    // 강조만 풀고 화면은 그대로
    expect(camera()).toEqual({ center: [A.lng, A.lat], zoom: 16 });
  });

  it('focus: 모르는 id는 지도를 움직이지 않는다', async () => {
    const { handle, camera } = await setup();
    handle.init([A, B, C]);
    const before = camera();
    handle.focus('없음');
    expect(camera()).toEqual(before);
  });

  it('마커를 누르면 그 마커를 강조하고(화면은 그대로) 앞서 강조한 마커는 풀고 select를 보낸다', async () => {
    const { handle, post, camera, markerData, markerOf } = await setup();
    handle.init([A, B, C]);
    handle.focus('a');
    const before = camera();

    markerOf('c').click();
    expect(markerData('c')).toMatchObject({ selected: true, clusterable: false });
    expect(markerData('a')).toMatchObject({ selected: false, clusterable: true });
    expect(camera()).toEqual(before);
    expect(post).toHaveBeenCalledWith({ kind: 'select', placeId: 'c' });
  });

  it('filter(ids): 그 장소만 남기고 다시 맞추지 않는다. 다시 넓히면 돌아온다', async () => {
    const { handle, adapter, camera, markerButtons } = await setup();
    handle.init([A, B, C]);
    const before = camera();
    handle.filter(['a']);
    expect(markerButtons().map((b) => b.textContent)).toEqual(['서혜커피']);
    expect(adapter.fitCalls).toHaveLength(1);
    expect(camera()).toEqual(before);

    handle.filter(['a', 'b', 'c']);
    expect(markerButtons()).toHaveLength(3);
  });

  it('init을 다시 받으면 마커를 새로 그리고 강조·거르기를 푼다', async () => {
    const { handle, markerButtons, markerData } = await setup();
    handle.init([A, B, C]);
    handle.focus('a');
    handle.filter(['a']);
    handle.init([A, B]);
    expect(markerButtons().map((b) => b.dataset.testid)).toEqual(['marker-a', 'marker-b']);
    expect(markerData('a').selected).toBe(false);
  });

  it('지도가 붙기 전에 받은 init·focus·filter는 붙은 뒤에 반영한다', async () => {
    const adapter = new DeferredFake();
    const { el, handle, camera, markerData, markerButtons } = await setup({ adapter });
    handle.init([A, B, C]);
    handle.filter(['a', 'c']);
    handle.focus('c');
    expect(el.querySelector('[data-testid="fake-map"]')).toBeNull();

    adapter.finish();
    await settle();
    expect(markerButtons().map((b) => b.dataset.testid)).toEqual(['marker-a', 'marker-c']);
    expect(markerData('c').selected).toBe(true);
    // 고른 장소가 우선이다: 처음 맞추기로 덮지 않는다
    expect(camera()).toEqual({ center: [C.lng, C.lat], zoom: 16 });
  });

  it('지도가 붙기 전에 init만 받았으면 붙은 뒤 모두 보이게 맞춘다', async () => {
    const adapter = new DeferredFake();
    const { handle } = await setup({ adapter });
    handle.init([A, B, C]);
    adapter.finish();
    await settle();
    expect(adapter.fitCalls).toHaveLength(1);
  });

  it('카메라를 먼저 옮기고 마커를 그린다: 붙기 전에 받은 init도, 붙은 뒤에 받은 init도(네이버는 첫 맞추기 뒤 idle이 오지 않아 그린 순간의 범위만 보인다)', async () => {
    for (const timing of ['붙기 전', '붙은 뒤'] as const) {
      for (const places of [[A, B, C], [A]]) {
        const adapter = new DeferredFake();
        const order: string[] = [];
        const fit = adapter.fitBounds.bind(adapter);
        const setCamera = adapter.setCamera.bind(adapter);
        const setMarkers = adapter.setMarkers.bind(adapter);
        adapter.fitBounds = (points, padding) => {
          order.push('camera');
          fit(points, padding);
        };
        adapter.setCamera = (camera) => {
          order.push('camera');
          setCamera(camera);
        };
        adapter.setMarkers = (markers) => {
          order.push('markers');
          setMarkers(markers);
        };
        const { handle } = await setup({ adapter });
        if (timing === '붙은 뒤') {
          adapter.finish();
          await settle();
          order.length = 0;
          handle.init(places);
        } else {
          handle.init(places);
          adapter.finish();
          await settle();
        }
        expect(order, `${timing} ${places.length}곳`).toContain('camera');
        expect(order, `${timing} ${places.length}곳`).toContain('markers');
        expect(order.lastIndexOf('camera'), `${timing} ${places.length}곳`).toBeLessThan(
          order.lastIndexOf('markers'),
        );
        document.body.replaceChildren();
      }
    }
  });

  describe('크기', () => {
    it('붙을 때 컨테이너 크기를 어댑터에 알리고, resize 때마다 다시 알린다', async () => {
      const { adapter, size } = await setup();
      expect(adapter.resizeCalls).toEqual([[800, 600]]);
      size.w = 400;
      window.dispatchEvent(new Event('resize'));
      expect(adapter.resizeCalls.at(-1)).toEqual([400, 600]);
    });

    it('처음 맞출 때 컨테이너 크기가 0이면(숨긴 iframe) 크기가 생긴 뒤 resize에서 한 번 다시 맞춘다', async () => {
      const { handle, adapter, size, camera } = await setup({ size: { w: 0, h: 0 } });
      handle.init([A, B, C]);
      expect(adapter.fitCalls).toHaveLength(1);

      size.w = 800;
      size.h = 600;
      window.dispatchEvent(new Event('resize'));
      expect(adapter.fitCalls).toHaveLength(2);
      expect(adapter.resizeCalls.at(-1)).toEqual([800, 600]);

      // 한 번만: 그 뒤 사용자가 옮긴 화면은 resize로 되돌리지 않는다
      adapter.setCamera({ center: [127, 37], zoom: 5 });
      window.dispatchEvent(new Event('resize'));
      expect(adapter.fitCalls).toHaveLength(2);
      expect(camera()?.zoom).toBe(5);
    });

    it('크기가 0일 때 받은 몇 미터 떨어진 곳도, 다시 맞출 때 줌 16을 넘지 않는다', async () => {
      const adapter = new CameraFake();
      adapter.fitZoom = 19;
      const { handle, size, camera } = await setup({ adapter, size: { w: 0, h: 0 } });
      handle.init([A, { ...C, lng: A.lng, lat: A.lat + 0.00005 }]);
      size.w = 800;
      size.h = 600;
      window.dispatchEvent(new Event('resize'));
      expect(camera()?.zoom).toBe(16);
    });

    it('크기가 0인 동안 resize가 와도 기다렸다가, 1곳이면 크기가 생긴 뒤 그 지점 줌 16', async () => {
      const { handle, size, camera, adapter } = await setup({ size: { w: 0, h: 0 } });
      handle.init([A]);
      adapter.setCamera({ center: [127, 37], zoom: 5 });
      window.dispatchEvent(new Event('resize'));
      expect(camera()?.zoom).toBe(5);
      size.w = 400;
      size.h = 300;
      window.dispatchEvent(new Event('resize'));
      expect(camera()).toEqual({ center: [A.lng, A.lat], zoom: 16 });
    });

    it('크기가 0인 동안 focus가 오면, 크기가 생겨도 처음 맞추기로 되돌리지 않고 그 장소에 남는다', async () => {
      const { handle, size, camera, adapter } = await setup({ size: { w: 0, h: 0 } });
      handle.init([A, B, C]);
      handle.focus('c');
      size.w = 800;
      size.h = 600;
      window.dispatchEvent(new Event('resize'));
      expect(adapter.fitCalls).toHaveLength(1);
      expect(camera()).toEqual({ center: [C.lng, C.lat], zoom: 16 });
    });

    it('처음부터 크기가 있으면 resize가 화면을 되돌리지 않는다', async () => {
      const { handle, adapter, camera } = await setup();
      handle.init([A, B, C]);
      adapter.setCamera({ center: [127, 37], zoom: 5 });
      window.dispatchEvent(new Event('resize'));
      expect(adapter.fitCalls).toHaveLength(1);
      expect(camera()?.zoom).toBe(5);
    });
  });

  describe('지도를 쓸 수 없음', () => {
    it('mount가 거부되면(SDK 로드 실패·시한) tiles-failed를 한 번 보내고, 그 뒤 메시지는 조용히 무시한다', async () => {
      const adapter = new DeferredFake();
      const { handle, post } = await setup({ adapter });
      handle.init([A, B]);
      adapter.fail(new Error('네이버 지도 SDK 로드 실패'));
      await settle();
      expect(post.mock.calls).toEqual([[{ kind: 'tiles-failed' }]]);
      expect(() => {
        handle.init([A]);
        handle.focus('a');
        handle.filter(['a']);
      }).not.toThrow();
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('인증 실패 콜백이 오면 tiles-failed를 한 번만 보내고 지도를 걷는다', async () => {
      let fireAuthFailure = () => {};
      const unsubscribe = vi.fn();
      const onAuthFailure = vi.fn((cb: () => void) => {
        fireAuthFailure = cb;
        return unsubscribe;
      });
      const { el, handle, post } = await setup({ onAuthFailure });
      handle.init([A, B]);
      expect(onAuthFailure).toHaveBeenCalledTimes(1);

      fireAuthFailure();
      fireAuthFailure();
      expect(post.mock.calls).toEqual([[{ kind: 'tiles-failed' }]]);
      expect(unsubscribe).toHaveBeenCalled();
      expect(el.querySelector('[data-testid="fake-map"]')).toBeNull();
    });

    it('mount 거부 뒤 인증 실패가 와도 한 번만 보낸다', async () => {
      let fireAuthFailure = () => {};
      const adapter = new DeferredFake();
      const { post } = await setup({
        adapter,
        onAuthFailure: (cb) => {
          fireAuthFailure = cb;
          return () => {};
        },
      });
      fireAuthFailure();
      adapter.fail(new Error('네이버 지도 인증 실패'));
      await settle();
      expect(post).toHaveBeenCalledTimes(1);
    });
  });
});
