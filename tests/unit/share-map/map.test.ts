import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FromMap, MapPlace } from 'src/share-protocol';
import { FOCUS_ZOOM, createShareMap } from 'src/share-map/map';

const A: MapPlace = { id: 'a', name: '서혜커피', lng: 127.11, lat: 37.37, color: 'orange' };
const B: MapPlace = { id: 'b', name: '<b>굵게</b>', lng: 127.13, lat: 37.36, color: null };
const C: MapPlace = { id: 'c', name: '정자 빵집', lng: 127.12, lat: 37.38, color: 'blue' };

/** jsdom은 레이아웃이 없으니 Leaflet이 읽는 컨테이너 크기를 직접 정한다. */
function sizedContainer(size = { w: 800, h: 600 }) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => size.w });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => size.h });
  document.body.append(el);
  return { el, size };
}

function setup(opts?: { dark?: boolean; size?: { w: number; h: number } }) {
  const { el, size } = sizedContainer(opts?.size);
  const post = vi.fn<(msg: FromMap) => void>();
  const handle = createShareMap(el, post, opts?.dark === undefined ? {} : { dark: opts.dark });
  const icons = () => [...el.querySelectorAll<HTMLElement>('.leaflet-marker-icon')];
  const iconOf = (name: string) => {
    const icon = icons().find((i) => i.textContent === name);
    if (icon === undefined) throw new Error(`마커 없음: ${name}`);
    return icon;
  };
  const labelOf = (name: string) => iconOf(name).firstElementChild as HTMLElement;
  return { el, size, post, handle, map: handle.map, icons, iconOf, labelOf };
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

  it('init: 장소마다 마커 하나, 이름은 글자 그대로(태그로 해석하지 않는다)', () => {
    const { handle, icons, iconOf } = setup();
    handle.init([A, B, C]);
    expect(icons()).toHaveLength(3);
    expect(iconOf('<b>굵게</b>').querySelector('b')).toBeNull();
    expect(iconOf('서혜커피').textContent).toBe('서혜커피');
  });

  it('init: 여러 곳이면 모두 보이게 맞춘다', () => {
    const { handle, map } = setup();
    handle.init([A, B, C]);
    const bounds = map.getBounds();
    for (const p of [A, B, C]) expect(bounds.contains([p.lat, p.lng])).toBe(true);
    expect(map.getZoom()).toBeLessThanOrEqual(FOCUS_ZOOM);
  });

  it('init: 1곳이면 그 지점에 줌 16', () => {
    const { handle, map } = setup();
    handle.init([A]);
    expect(map.getZoom()).toBe(16);
    expect(map.getCenter().lat).toBeCloseTo(A.lat, 5);
    expect(map.getCenter().lng).toBeCloseTo(A.lng, 5);
  });

  it('init: 모두 같은 좌표면 줌이 터지지 않고 16', () => {
    const { handle, map } = setup();
    handle.init([A, { ...C, lng: A.lng, lat: A.lat }]);
    expect(map.getZoom()).toBe(16);
    expect(map.getCenter().lat).toBeCloseTo(A.lat, 5);
  });

  it('라벨 색이 있으면 라벨 토큰, 없으면 표면색으로 칠한다(다크 토큰 포함)', () => {
    const light = setup();
    light.handle.init([A, B]);
    // pastel.light.label.orange.fill #FFE3C4, bg.surface #FFFFFF
    expect(light.labelOf('서혜커피').style.background).toContain('rgb(255, 227, 196)');
    expect(light.labelOf('<b>굵게</b>').style.background).toContain('rgb(255, 255, 255)');

    document.body.replaceChildren();
    const dark = setup({ dark: true });
    dark.handle.init([A, B]);
    // pastel.dark.label.orange.fill #4A3018, bg.surface #1B1B1F
    expect(dark.labelOf('서혜커피').style.background).toContain('rgb(74, 48, 24)');
    expect(dark.labelOf('<b>굵게</b>').style.background).toContain('rgb(27, 27, 31)');
  });

  it('마커를 누르면 select를 보낸다', () => {
    const { handle, post, iconOf } = setup();
    handle.init([A, B, C]);
    iconOf('정자 빵집').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(post).toHaveBeenCalledWith({ kind: 'select', placeId: 'c' });
  });

  it('focus(id): 줌 16으로 그 장소에 가고 테두리를 3px로 강조해 맨 위로 올린다. null은 강조 해제', () => {
    const { handle, map, labelOf, iconOf } = setup();
    handle.init([A, B, C]);
    expect(labelOf('정자 빵집').style.borderWidth).toBe('2px');

    handle.focus('c');
    expect(map.getZoom()).toBe(16);
    expect(map.getCenter().lat).toBeCloseTo(C.lat, 4);
    expect(map.getCenter().lng).toBeCloseTo(C.lng, 4);
    expect(labelOf('정자 빵집').style.borderWidth).toBe('3px');
    expect(labelOf('서혜커피').style.borderWidth).toBe('2px');
    // Leaflet z-index = 화면 y + 오프셋. 강조한 마커만 1000을 더한다.
    const baseZ = (p: MapPlace) => Math.round(map.latLngToLayerPoint([p.lat, p.lng]).y);
    expect(Number(iconOf('정자 빵집').style.zIndex)).toBe(baseZ(C) + 1000);
    expect(Number(iconOf('서혜커피').style.zIndex)).toBe(baseZ(A));

    handle.focus('a');
    expect(labelOf('정자 빵집').style.borderWidth).toBe('2px');
    expect(labelOf('서혜커피').style.borderWidth).toBe('3px');

    handle.focus(null);
    expect(labelOf('서혜커피').style.borderWidth).toBe('2px');
    expect(Number(iconOf('서혜커피').style.zIndex)).toBe(baseZ(A));
    expect(map.getZoom()).toBe(16);
  });

  it('마커를 누르면 그 마커를 강조하고(화면은 그대로) 앞서 강조한 마커는 푼다', () => {
    const { handle, map, post, labelOf, iconOf } = setup();
    handle.init([A, B, C]);
    handle.focus('a');
    const zoom = map.getZoom();
    const center = map.getCenter();

    iconOf('정자 빵집').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(labelOf('정자 빵집').style.borderWidth).toBe('3px');
    expect(labelOf('서혜커피').style.borderWidth).toBe('2px');
    const baseZ = (p: MapPlace) => Math.round(map.latLngToLayerPoint([p.lat, p.lng]).y);
    expect(Number(iconOf('정자 빵집').style.zIndex)).toBe(baseZ(C) + 1000);
    expect(Number(iconOf('서혜커피').style.zIndex)).toBe(baseZ(A));
    expect(map.getZoom()).toBe(zoom);
    expect(map.getCenter().equals(center)).toBe(true);
    expect(post).toHaveBeenCalledWith({ kind: 'select', placeId: 'c' });
  });

  it('init: 몇 미터 떨어진 여러 곳도 줌 16을 넘지 않는다', () => {
    const { handle, map } = setup();
    // 위도 0.00005도 ≈ 5.5m
    handle.init([A, { ...C, lng: A.lng, lat: A.lat + 0.00005 }]);
    expect(map.getZoom()).toBeLessThanOrEqual(FOCUS_ZOOM);
  });

  it('init: 크기가 0일 때 받은 몇 미터 떨어진 곳도, 크기가 생긴 뒤 다시 맞출 때 줌 16을 넘지 않는다', () => {
    const { handle, map, size } = setup({ size: { w: 0, h: 0 } });
    handle.init([A, { ...C, lng: A.lng, lat: A.lat + 0.00005 }]);
    size.w = 800;
    size.h = 600;
    window.dispatchEvent(new Event('resize'));
    expect(map.getZoom()).toBeLessThanOrEqual(FOCUS_ZOOM);
  });

  it('focus: 모르는 id는 지도를 움직이지 않는다', () => {
    const { handle, map } = setup();
    handle.init([A, B, C]);
    const zoom = map.getZoom();
    handle.focus('없음');
    expect(map.getZoom()).toBe(zoom);
  });

  it('filter(ids): 그 장소만 남기고 다시 맞추지 않는다. 다시 넓히면 돌아온다', () => {
    const { handle, map, icons } = setup();
    handle.init([A, B, C]);
    const zoom = map.getZoom();
    const center = map.getCenter();
    handle.filter(['a']);
    expect(icons().map((i) => i.textContent)).toEqual(['서혜커피']);
    expect(map.getZoom()).toBe(zoom);
    expect(map.getCenter().equals(center)).toBe(true);

    handle.filter(['a', 'b', 'c']);
    expect(icons()).toHaveLength(3);
  });

  it('처음 맞출 때 컨테이너 크기가 0이면(숨긴 iframe) 크기가 생긴 뒤 resize에서 한 번 다시 맞춘다', () => {
    const { handle, map, size } = setup({ size: { w: 0, h: 0 } });
    handle.init([A, B, C]);

    size.w = 800;
    size.h = 600;
    window.dispatchEvent(new Event('resize'));
    const bounds = map.getBounds();
    for (const p of [A, B, C]) expect(bounds.contains([p.lat, p.lng])).toBe(true);
    // 크기가 있을 때 맞춘 것과 같은 줌
    const ref = setup();
    ref.handle.init([A, B, C]);
    expect(map.getZoom()).toBe(ref.map.getZoom());

    // 한 번만: 그 뒤 사용자가 옮긴 화면은 resize로 되돌리지 않는다
    map.setZoom(5);
    window.dispatchEvent(new Event('resize'));
    expect(map.getZoom()).toBe(5);
  });

  it('크기가 0인 동안 resize가 와도 기다렸다가, 1곳이면 크기가 생긴 뒤 그 지점 줌 16', () => {
    const { handle, map, size } = setup({ size: { w: 0, h: 0 } });
    handle.init([A]);
    window.dispatchEvent(new Event('resize'));
    size.w = 400;
    size.h = 300;
    window.dispatchEvent(new Event('resize'));
    expect(map.getZoom()).toBe(16);
    // 픽셀 단위로 맞추므로 1px(줌 16에서 약 0.00001도) 안쪽
    expect(map.getCenter().lat).toBeCloseTo(A.lat, 4);
    expect(map.getCenter().lng).toBeCloseTo(A.lng, 4);
  });

  it('크기가 0인 동안 focus가 오면, 크기가 생겨도 처음 맞추기로 되돌리지 않고 그 장소에 남는다', () => {
    const { handle, map, size } = setup({ size: { w: 0, h: 0 } });
    handle.init([A, B, C]);
    handle.focus('c');
    size.w = 800;
    size.h = 600;
    window.dispatchEvent(new Event('resize'));
    expect(map.getZoom()).toBe(16);
    expect(map.getCenter().lat).toBeCloseTo(C.lat, 4);
    expect(map.getCenter().lng).toBeCloseTo(C.lng, 4);
  });

  it('처음부터 크기가 있으면 resize가 화면을 되돌리지 않는다', () => {
    const { handle, map } = setup();
    handle.init([A, B, C]);
    map.setZoom(5);
    window.dispatchEvent(new Event('resize'));
    expect(map.getZoom()).toBe(5);
  });

  describe('타일 실패', () => {
    it('tileload 없이 tileerror만 나고 load가 오면 tiles-failed를 한 번 보낸다', () => {
      const { handle, post } = setup();
      handle.init([A, B]);
      handle.tileLayer.fire('tileerror');
      handle.tileLayer.fire('tileerror');
      handle.tileLayer.fire('load');
      expect(post.mock.calls).toEqual([[{ kind: 'tiles-failed' }]]);
    });

    it('tileload가 하나라도 있으면 보내지 않는다', () => {
      const { handle, post } = setup();
      handle.init([A, B]);
      handle.tileLayer.fire('tileload');
      handle.tileLayer.fire('tileerror');
      handle.tileLayer.fire('load');
      expect(post).not.toHaveBeenCalled();
    });

    it('load가 두 번 와도 한 번만 보낸다', () => {
      const { handle, post } = setup();
      handle.init([A, B]);
      handle.tileLayer.fire('tileerror');
      handle.tileLayer.fire('load');
      handle.tileLayer.fire('tileerror');
      handle.tileLayer.fire('load');
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('오류 없이 load만 오면 보내지 않는다', () => {
      const { handle, post } = setup();
      handle.init([A, B]);
      handle.tileLayer.fire('load');
      expect(post).not.toHaveBeenCalled();
    });
  });

  it('출처: 접두어 없이 OSM 저작권 링크만 보인다', () => {
    const { el, handle } = setup();
    handle.init([A]);
    const attribution = el.querySelector('.leaflet-control-attribution');
    expect(attribution?.textContent).toBe('© OpenStreetMap contributors');
    const link = attribution?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://www.openstreetmap.org/copyright');
    expect(attribution?.querySelectorAll('a')).toHaveLength(1);
  });

  it('타일 주소는 OSM 표준 타일이다', () => {
    const { handle } = setup();
    expect(handle.tileLayer.getTileUrl).toBeTypeOf('function');
    expect((handle.tileLayer as unknown as { _url: string })._url).toBe(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    );
  });
});
