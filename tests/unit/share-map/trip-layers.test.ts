import { describe, expect, it } from 'vitest';
import { dayColor, NO_CATEGORY_COLOR } from 'src/components/map/map-colors';
import { drawLayers } from 'src/share-map/trip-layers';
import type { MapLine, MapPin } from 'src/share-protocol';

const stop = (over: Partial<MapPin> = {}): MapPin => ({
  id: 'a',
  label: '1 서혜커피',
  lng: 127.1,
  lat: 37.36,
  day: 0,
  role: 'stop',
  ...over,
});

const only = (pin: MapPin, selectedId: string | null = null) =>
  drawLayers([pin], [], selectedId).markers[0]!;

describe('drawLayers 마커', () => {
  it('Stop: Day 색 바탕, 흰 글자, 이름 그대로, 묶지 않음', () => {
    expect(only(stop({ day: 2 }))).toEqual({
      id: 'a',
      lng: 127.1,
      lat: 37.36,
      label: '1 서혜커피',
      color: dayColor(2),
      textColor: '#ffffff',
      selected: false,
      clusterable: false,
    });
  });

  it('day마다 앱과 같은 Day 색(팔레트가 돌아도 같다)', () => {
    expect(only(stop({ day: 0 })).color).toBe(dayColor(0));
    expect(only(stop({ day: 9 })).color).toBe(dayColor(9));
  });

  it('endpoint: Day 색에 검정 테두리', () => {
    const m = only(stop({ id: 'start:a', label: '🏠 집', role: 'endpoint', day: 1 }));
    expect(m).toMatchObject({
      id: 'start:a',
      label: '🏠 집',
      color: dayColor(1),
      textColor: '#ffffff',
      borderColor: '#000000',
      clusterable: false,
    });
    expect(m.fit).toBeUndefined();
    expect(m.dimmed).toBeUndefined();
  });

  it('Stop에는 테두리색을 정하지 않는다', () => {
    expect(only(stop())).not.toHaveProperty('borderColor');
  });

  it('dim: 이름 없음, 흐림, 맞추기 제외', () => {
    const m = only(stop({ id: 'z', label: '무시될 이름', role: 'dim', day: 3 }));
    expect(m).toMatchObject({
      label: '',
      dimmed: true,
      fit: false,
      color: dayColor(3),
      clusterable: false,
    });
  });

  it('day가 null이면 회색이고 맞추기에서 뺀다(Day 없는 후보)', () => {
    const m = only(stop({ id: 'c', label: '후보', day: null }));
    expect(m).toMatchObject({ color: NO_CATEGORY_COLOR, label: '후보', fit: false });
    expect(m.dimmed).toBeUndefined();
  });

  it('Day가 있는 Stop·endpoint는 fit을 정하지 않는다', () => {
    expect(only(stop())).not.toHaveProperty('fit');
    expect(only(stop({ role: 'endpoint' }))).not.toHaveProperty('fit');
  });

  it('selected는 id가 같을 때만 true(출발점 핀 id는 그대로 비교)', () => {
    const pins = [stop({ id: 'a' }), stop({ id: 'start:a', role: 'endpoint' })];
    const { markers } = drawLayers(pins, [], 'start:a');
    expect(markers.map((m) => m.selected)).toEqual([false, true]);
    expect(drawLayers(pins, [], null).markers.map((m) => m.selected)).toEqual([false, false]);
  });

  it('핀 순서를 지키고 입력을 바꾸지 않는다', () => {
    const pins = [stop({ id: 'b' }), stop({ id: 'a' })];
    const copy = structuredClone(pins);
    expect(drawLayers(pins, [], null).markers.map((m) => m.id)).toEqual(['b', 'a']);
    expect(pins).toEqual(copy);
  });
});

describe('drawLayers 경로선', () => {
  const path: [number, number][] = [
    [127.1, 37.36],
    [127.2, 37.4],
  ];

  it('Day 색, 자동차는 실선', () => {
    const line: MapLine = { id: 'l1', day: 4, walk: false, path };
    expect(drawLayers([], [line], null).polylines).toEqual([
      { id: 'l1', path, color: dayColor(4), dashed: false },
    ]);
  });

  it('도보는 점선', () => {
    const line: MapLine = { id: 'l2', day: 0, walk: true, path };
    expect(drawLayers([], [line], null).polylines[0]).toMatchObject({
      color: dayColor(0),
      dashed: true,
    });
  });

  it('선이 없으면 빈 배열', () => {
    expect(drawLayers([stop()], [], null).polylines).toEqual([]);
  });
});
