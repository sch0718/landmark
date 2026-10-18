import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import type { MapMarker, MapPadding } from 'src/components/map/MapAdapter';
import { dayColor, NO_CATEGORY_COLOR } from 'src/components/map/map-colors';
import type { FromMap, MapLine, MapPin, MapPlace } from 'src/share-protocol';
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

    // 실제 네이버 지도(2026-10-11): 넓은 배치(지도 439x793)에서 줌 16으로 맞춘 뒤 좁은 배치(375x323)로
    // 바뀌면, 어댑터 resize가 가운데·줌을 그대로 두어 장소가 화면 밖으로 나갔다. 크기가 바뀐 뒤 다시 맞춘다.
    it('처음 맞춘 뒤 크기가 바뀌면(사용자가 화면을 옮기지 않았으면) 지도 크기를 먼저 바꾸고 다시 맞춘다', async () => {
      const adapter = new CameraFake();
      const order: string[] = [];
      const resize = adapter.resize.bind(adapter);
      const fit = adapter.fitBounds.bind(adapter);
      adapter.resize = (w, h) => {
        order.push(`resize ${w}x${h}`);
        resize(w, h);
      };
      adapter.fitBounds = (points, padding) => {
        // 맞추기 줌은 지도 크기를 따른다(넓으면 16, 좁으면 15).
        adapter.fitZoom = (adapter.resizeCalls.at(-1)?.[1] ?? 0) > 500 ? 16 : 15;
        order.push(`fit ${adapter.fitZoom}`);
        fit(points, padding);
      };
      const { handle, size, camera } = await setup({ adapter, size: { w: 439, h: 793 } });
      handle.init([A, B, C]);
      expect(camera()?.zoom).toBe(16);

      size.w = 375;
      size.h = 323;
      window.dispatchEvent(new Event('resize'));
      expect(order).toEqual(['resize 439x793', 'fit 16', 'resize 375x323', 'fit 15']);
      expect(camera()?.zoom).toBe(15);

      // 다시 넓어져도 맞춘다. 크기가 그대로인 resize는 다시 맞추지 않는다.
      size.w = 800;
      size.h = 600;
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      expect(adapter.fitCalls).toHaveLength(3);
      expect(camera()?.zoom).toBe(16);
    });

    it('처음 맞춘 뒤 사용자가 지도를 만졌으면(끌기·휠·키·터치) 크기가 바뀌어도 다시 맞추지 않는다', async () => {
      for (const input of ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const) {
        const { el, handle, adapter, size, camera } = await setup();
        handle.init([A, B, C]);
        const map = el.querySelector<HTMLElement>('[data-testid="fake-map"]');
        // 실제로는 지도 SDK가 입력을 받아 화면을 옮긴다. 가짜 지도에서는 입력 뒤 카메라를 직접 옮긴다.
        map?.dispatchEvent(new Event(input, { bubbles: true }));
        adapter.setCamera({ center: [127, 37], zoom: 5 });
        size.w = 375;
        size.h = 323;
        window.dispatchEvent(new Event('resize'));
        expect(adapter.resizeCalls.at(-1), input).toEqual([375, 323]);
        expect(adapter.fitCalls, input).toHaveLength(1);
        expect(camera(), input).toEqual({ center: [127, 37], zoom: 5 });
        document.body.replaceChildren();
      }
    });

    // 카메라가 맞춘 값과 같은지로 "사용자가 옮겼는지"를 가리면, 지도 SDK가 맞춘 뒤 스스로 가운데를 조금 고치는 경우
    // (실제 네이버 getCenter는 크기·줌에 따라 1e-6도 안팎으로 반올림이 달라진다, 2026-10-11 확인) 사용자가 손대지
    // 않았는데도 다시 맞추지 않는다. 사용자 입력이 없었으면 카메라가 달라져 있어도 다시 맞춘다.
    it('사용자 입력 없이 지도가 맞춘 화면을 스스로 조금 고쳤어도, 크기가 바뀌면 다시 맞춘다', async () => {
      const { handle, adapter, size, camera } = await setup({ size: { w: 439, h: 793 } });
      handle.init([A, B, C]);
      const fitted = camera();
      if (fitted === null) throw new Error('카메라 없음');
      adapter.setCamera({ center: [fitted.center[0], fitted.center[1] + 1e-6], zoom: fitted.zoom });
      size.w = 375;
      size.h = 323;
      window.dispatchEvent(new Event('resize'));
      expect(adapter.fitCalls).toHaveLength(2);
    });

    it('init을 다시 받으면 앞서 만진 기록을 지우고, 그 뒤 크기가 바뀌면 다시 맞춘다', async () => {
      const { el, handle, adapter, size } = await setup();
      handle.init([A, B, C]);
      el.querySelector('[data-testid="fake-map"]')?.dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
      handle.init([A, B]);
      size.w = 375;
      size.h = 323;
      window.dispatchEvent(new Event('resize'));
      expect(adapter.fitCalls).toHaveLength(3);
    });

    it('focus로 장소에 간 뒤에는 크기가 바뀌어도 다시 맞추지 않는다', async () => {
      const { handle, adapter, size, camera } = await setup();
      handle.init([A, B, C]);
      handle.focus('c');
      size.w = 375;
      size.h = 323;
      window.dispatchEvent(new Event('resize'));
      expect(adapter.fitCalls).toHaveLength(1);
      expect(camera()).toEqual({ center: [C.lng, C.lat], zoom: 16 });
    });

    it('1곳이면 크기가 바뀐 뒤에도 그 지점 줌 16으로 다시 맞춘다', async () => {
      const { handle, adapter, size, camera } = await setup();
      handle.init([A]);
      // 어댑터 resize는 가운데·줌을 그대로 두므로 화면만으로는 다시 맞췄는지 알 수 없다. 카메라 호출 수로 본다.
      const setCamera = vi.spyOn(adapter, 'setCamera');
      size.w = 375;
      size.h = 323;
      window.dispatchEvent(new Event('resize'));
      expect(adapter.fitCalls).toHaveLength(0);
      expect(setCamera).toHaveBeenCalledTimes(1);
      expect(setCamera).toHaveBeenLastCalledWith({ center: [A.lng, A.lat], zoom: 16 });
      expect(camera()).toEqual({ center: [A.lng, A.lat], zoom: 16 });

      // 크기가 그대로면 다시 맞추지 않는다.
      window.dispatchEvent(new Event('resize'));
      expect(setCamera).toHaveBeenCalledTimes(1);
    });

    it('resize로 다시 맞출 때도 카메라를 먼저 옮기고 마커를 다시 그린다(크기 변경·크기 0에서 생김 둘 다)', async () => {
      for (const from of [
        { w: 439, h: 793 },
        { w: 0, h: 0 },
      ]) {
        for (const places of [[A, B, C], [A]]) {
          const label = `${from.w}x${from.h} ${places.length}곳`;
          const adapter = new CameraFake();
          const order: string[] = [];
          const fit = adapter.fitBounds.bind(adapter);
          const setCamera = adapter.setCamera.bind(adapter);
          const setMarkers = adapter.setMarkers.bind(adapter);
          adapter.fitBounds = (points, padding) => {
            order.push('camera');
            fit(points, padding);
          };
          adapter.setCamera = (next) => {
            order.push('camera');
            setCamera(next);
          };
          adapter.setMarkers = (markers) => {
            order.push('markers');
            setMarkers(markers);
          };
          const { handle, size } = await setup({ adapter, size: { ...from } });
          handle.init(places);
          order.length = 0;

          size.w = 375;
          size.h = 323;
          window.dispatchEvent(new Event('resize'));
          expect(order, label).toContain('camera');
          expect(order, label).toContain('markers');
          expect(order.lastIndexOf('camera'), label).toBeLessThan(order.lastIndexOf('markers'));
          document.body.replaceChildren();
        }
      }
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

describe('createShareMap draw(일정 지도)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  const pin = (over: Partial<MapPin> & { id: string }): MapPin => ({
    label: over.id,
    lng: 127.1,
    lat: 37.36,
    day: 0,
    role: 'stop',
    ...over,
  });
  const S1 = pin({ id: 's1', label: '1 서혜커피', lng: 127.11, lat: 37.37 });
  const S2 = pin({ id: 's2', label: '2 정자 빵집', lng: 127.13, lat: 37.36 });
  const START = pin({
    id: 'start:h',
    label: '🏠 집',
    lng: 127.1,
    lat: 37.35,
    role: 'endpoint',
  });
  const DIM = pin({ id: 'd1', label: '', lng: 128.5, lat: 35.1, day: 1, role: 'dim' });
  const CAND = pin({ id: 'c1', label: '후보', lng: 129.1, lat: 35.2, day: null });
  const LINE1: MapLine = {
    id: 'leg1',
    day: 0,
    walk: false,
    path: [
      [127.11, 37.37],
      [127.12, 37.365],
      [127.13, 37.36],
    ],
  };
  const LINE2: MapLine = { id: 'leg2', day: 0, walk: true, path: [[127.1, 37.35]] };

  const polylineIds = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('[data-testid^="polyline-"]')].map((n) =>
      n.getAttribute('data-testid'),
    );

  it('draw: 핀마다 마커 하나, 선마다 경로선 하나(Day 색, 도보는 점선)', async () => {
    const { el, handle, markerButtons, markerData } = await setup();
    handle.draw([S1, S2, START], [LINE1, LINE2]);
    expect(markerButtons().map((b) => b.dataset.testid)).toEqual([
      'marker-s1',
      'marker-s2',
      'marker-start:h',
    ]);
    expect(polylineIds(el)).toEqual(['polyline-leg1', 'polyline-leg2']);
    expect(el.querySelector<HTMLElement>('[data-testid="polyline-leg1"]')?.dataset).toMatchObject({
      dashed: 'false',
      color: dayColor(0),
      points: '3',
    });
    expect(el.querySelector<HTMLElement>('[data-testid="polyline-leg2"]')?.dataset.dashed).toBe(
      'true',
    );
    expect(markerData('start:h').borderColor).toBe('#000000');
    expect(markerData('s1')).toMatchObject({ color: dayColor(0), clusterable: false });
  });

  it('draw: 이름은 글자 그대로(태그로 해석하지 않는다)', async () => {
    const { handle, markerOf } = await setup();
    handle.draw([pin({ id: 'x', label: '<b>굵게</b>' })], []);
    expect(markerOf('x').textContent).toBe('<b>굵게</b>');
    expect(markerOf('x').querySelector('b')).toBeNull();
  });

  it('draw: 흐린 점과 Day 없는 핀은 빼고 맞춘다(여백 40)', async () => {
    const { handle, adapter, camera } = await setup();
    handle.draw([S1, S2, START, DIM, CAND], []);
    expect(adapter.fitCalls).toEqual([
      [
        [S1.lng, S1.lat],
        [S2.lng, S2.lat],
        [START.lng, START.lat],
      ],
    ]);
    expect(camera()?.zoom).toBe(12);
  });

  it('draw: 맞출 핀이 없으면 흐리지 않은 핀 전부에 맞춘다(후보뿐인 날)', async () => {
    const { handle, adapter } = await setup();
    const other = pin({ id: 'c2', label: '후보2', lng: 129.2, lat: 35.3, day: null });
    handle.draw([CAND, other, DIM], []);
    expect(adapter.fitCalls).toEqual([
      [
        [CAND.lng, CAND.lat],
        [other.lng, other.lat],
      ],
    ]);
  });

  it('draw: 맞출 곳이 1곳이면 그 지점에 줌 16(맞추기 없음)', async () => {
    const { handle, adapter, camera } = await setup();
    handle.draw([S1, DIM], []);
    expect(camera()).toEqual({ center: [S1.lng, S1.lat], zoom: 16 });
    expect(adapter.fitCalls).toHaveLength(0);
  });

  it('draw: 맞출 곳이 몇 미터 떨어져 있어 줌이 16을 넘으면 16으로 내린다', async () => {
    const adapter = new CameraFake();
    adapter.fitZoom = 19;
    const { handle, camera } = await setup({ adapter });
    handle.draw([S1, pin({ id: 'near', lng: S1.lng + 0.00005, lat: S1.lat })], []);
    expect(camera()?.zoom).toBe(16);
  });

  it('draw: 핀이 하나도 없으면 마커·선만 비우고 카메라는 그대로', async () => {
    const { handle, adapter, camera, markerButtons } = await setup();
    handle.draw([S1], [LINE1]);
    const before = camera();
    handle.draw([], []);
    expect(markerButtons()).toHaveLength(0);
    expect(camera()).toEqual(before);
    expect(adapter.fitCalls).toHaveLength(0);
  });

  it('draw를 다시 받으면 마커·선을 바꾸고 강조를 풀고 새로 맞춘다', async () => {
    const { el, handle, markerButtons, markerData, adapter } = await setup();
    handle.draw([S1, S2], [LINE1]);
    handle.focus('s1');
    expect(markerData('s1').selected).toBe(true);
    handle.draw([S2, START], []);
    expect(markerButtons().map((b) => b.dataset.testid)).toEqual(['marker-s2', 'marker-start:h']);
    expect(markerData('s2').selected).toBe(false);
    expect(polylineIds(el)).toEqual([]);
    expect(adapter.fitCalls).toHaveLength(2);
  });

  it('init으로 돌아오면 선이 사라지고 장소 마커가 된다', async () => {
    const { el, handle, markerButtons, markerData } = await setup();
    handle.draw([S1, S2], [LINE1]);
    handle.init([A, B]);
    expect(polylineIds(el)).toEqual([]);
    expect(markerButtons().map((b) => b.dataset.testid)).toEqual(['marker-a', 'marker-b']);
    expect(markerData('a').clusterable).toBe(true);
  });

  it('focus: 핀 id로 줌 16으로 가서 강조한다(출발점 핀 id도)', async () => {
    const { handle, camera, markerData } = await setup();
    handle.draw([S1, S2, START], []);
    handle.focus('start:h');
    expect(camera()).toEqual({ center: [START.lng, START.lat], zoom: 16 });
    expect(markerData('start:h').selected).toBe(true);
    expect(markerData('s1').selected).toBe(false);
    handle.focus(null);
    expect(markerData('start:h').selected).toBe(false);
  });

  it('focus: 모르는 id는 지도를 움직이지 않는다', async () => {
    const { handle, camera } = await setup();
    handle.draw([S1, S2], []);
    const before = camera();
    handle.focus('nope');
    expect(camera()).toEqual(before);
  });

  it('focus는 선을 지우지 않는다', async () => {
    const { el, handle } = await setup();
    handle.draw([S1, S2], [LINE1]);
    handle.focus('s2');
    expect(polylineIds(el)).toEqual(['polyline-leg1']);
  });

  it('마커를 누르면 핀 id(start:… 그대로)로 select를 보내고 강조한다', async () => {
    const { handle, markerOf, post, markerData } = await setup();
    handle.draw([S1, START], []);
    markerOf('start:h').click();
    expect(post).toHaveBeenLastCalledWith({ kind: 'select', placeId: 'start:h' });
    expect(markerData('start:h').selected).toBe(true);
    markerOf('s1').click();
    expect(post).toHaveBeenLastCalledWith({ kind: 'select', placeId: 's1' });
    expect(markerData('start:h').selected).toBe(false);
  });

  it('흐린 점을 눌러도 select를 보낸다(파일이 그 Day 탭으로 바꾼다)', async () => {
    const { handle, markerOf, post } = await setup();
    handle.draw([S1, DIM], []);
    markerOf('d1').click();
    expect(post).toHaveBeenLastCalledWith({ kind: 'select', placeId: 'd1' });
  });

  it('init 뒤 draw를 받으면 장소 마커는 사라지고 핀만 남는다', async () => {
    const { handle, post, markerButtons } = await setup();
    handle.init([A]);
    handle.draw([S1], []);
    expect(markerButtons().map((b) => b.dataset.testid)).toEqual(['marker-s1']);
    expect(post).not.toHaveBeenCalled();
  });

  it('후보 핀은 회색, 흐린 점은 이름이 없고 흐리다', async () => {
    const { handle, markerData } = await setup();
    handle.draw([CAND, DIM], []);
    expect(markerData('c1').color).toBe(NO_CATEGORY_COLOR);
    expect(markerData('d1')).toMatchObject({ label: '', dimmed: true, color: dayColor(1) });
  });

  it('흐린 핀뿐이면 흐린 점 전부에 맞춘다', async () => {
    const { handle, adapter } = await setup();
    const dim2 = pin({ id: 'd2', label: '', lng: 128.6, lat: 35.2, day: 1, role: 'dim' });
    handle.draw([DIM, dim2], []);
    expect(adapter.fitCalls).toEqual([
      [
        [DIM.lng, DIM.lat],
        [dim2.lng, dim2.lat],
      ],
    ]);
  });

  it('filter는 일정 모드에서 마커를 거르지 않는다', async () => {
    const { handle, markerButtons } = await setup();
    handle.draw([S1, S2], []);
    handle.filter(['s1']);
    expect(markerButtons()).toHaveLength(2);
  });

  it('지도가 붙기 전에 받은 draw는 붙은 뒤 마커·선·맞추기를 반영한다', async () => {
    const adapter = new DeferredFake();
    const { el, handle, markerButtons } = await setup({ adapter });
    handle.draw([S1, S2, DIM], [LINE1]);
    expect(el.querySelector('[data-testid="fake-map"]')).toBeNull();
    adapter.finish();
    await settle();
    expect(markerButtons().map((b) => b.dataset.testid)).toEqual([
      'marker-s1',
      'marker-s2',
      'marker-d1',
    ]);
    expect(polylineIds(el)).toEqual(['polyline-leg1']);
    expect(adapter.fitCalls).toEqual([
      [
        [S1.lng, S1.lat],
        [S2.lng, S2.lat],
      ],
    ]);
  });

  it('붙기 전에 draw 뒤 focus를 받으면 고른 핀이 우선이다', async () => {
    const adapter = new DeferredFake();
    const { handle, camera, markerData } = await setup({ adapter });
    handle.draw([S1, S2], []);
    handle.focus('s2');
    adapter.finish();
    await settle();
    expect(camera()).toEqual({ center: [S2.lng, S2.lat], zoom: 16 });
    expect(markerData('s2').selected).toBe(true);
  });

  it('카메라를 먼저 옮기고 마커를 그린다(붙은 뒤 draw)', async () => {
    const adapter = new CameraFake();
    const { handle } = await setup({ adapter });
    const order: string[] = [];
    const fit = adapter.fitBounds.bind(adapter);
    const setMarkers = adapter.setMarkers.bind(adapter);
    adapter.fitBounds = (points, padding) => {
      order.push('camera');
      fit(points, padding);
    };
    adapter.setMarkers = (markers) => {
      order.push('markers');
      setMarkers(markers);
    };
    handle.draw([S1, S2], []);
    expect(order.indexOf('camera')).toBeGreaterThanOrEqual(0);
    expect(order.lastIndexOf('camera')).toBeLessThan(order.lastIndexOf('markers'));
  });

  it('크기가 0일 때 받은 draw는 크기가 생긴 뒤 한 번 다시 맞춘다(핀 기준)', async () => {
    const { handle, adapter, size } = await setup({ size: { w: 0, h: 0 } });
    handle.draw([S1, S2, DIM], []);
    expect(adapter.fitCalls).toHaveLength(1);
    size.w = 800;
    size.h = 600;
    window.dispatchEvent(new Event('resize'));
    expect(adapter.fitCalls).toHaveLength(2);
    expect(adapter.fitCalls[1]).toEqual([
      [S1.lng, S1.lat],
      [S2.lng, S2.lat],
    ]);
  });
});
