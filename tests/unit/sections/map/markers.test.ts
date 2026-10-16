import { describe, expect, it } from 'vitest';
import type { Label, Place } from 'src/schema/library';
import { toMarkers } from 'src/sections/map/markers';
import { TOKENS } from 'src/theme/tokens';
import { makeLabel, makePlace } from '../library/fixtures';

const labelsOf = (...labels: Label[]): Record<string, Label> =>
  Object.fromEntries(labels.map((l) => [l.id, l]));

const red = makeLabel('label001', '맛집', 'red', 'utensils', 0);
const blue = makeLabel('label002', '바다뷰', 'blue', 'waves', 1);

const at = (place: Place, lng: number, lat: number): Place => ({ ...place, lng, lat });

describe('toMarkers', () => {
  it('marker colors follow the first label and theme tokens', () => {
    const places = [
      makePlace(1, { labelIds: [blue.id, red.id] }),
      makePlace(2, { labelIds: [red.id] }),
      makePlace(3),
    ];
    const labels = labelsOf(red, blue);

    const colorsOf = (m: { color: string; textColor?: string; borderColor?: string }) => [
      m.color,
      m.textColor,
      m.borderColor,
    ];
    const light = toMarkers(places, labels, TOKENS.pastel.light, null);
    const l = TOKENS.pastel.light;
    expect(light.map(colorsOf)).toEqual([
      [l.label.blue.fill, l.label.blue.text, l.label.blue.marker],
      [l.label.red.fill, l.label.red.text, l.label.red.marker],
      [l.bg.surface, l.text.primary, l.border],
    ]);

    // 같은 장소라도 테마가 바뀌면 색이 따라 바뀐다.
    const night = toMarkers(places, labels, TOKENS.night.dark, null);
    const n = TOKENS.night.dark;
    expect(night.map(colorsOf)).toEqual([
      [n.label.blue.fill, n.label.blue.text, n.label.blue.marker],
      [n.label.red.fill, n.label.red.text, n.label.red.marker],
      [n.bg.surface, n.text.primary, n.border],
    ]);
    expect(night[1]!.color).not.toBe(light[1]!.color);
  });

  it('labels each marker with the place name', () => {
    const places = [makePlace(1, { name: '안목 카페거리' }), makePlace(2, { name: '속초 횟집' })];
    const markers = toMarkers(places, {}, TOKENS.pastel.light, null);
    expect(markers.map((m) => m.label)).toEqual(['안목 카페거리', '속초 횟집']);
  });

  it('draws the selected marker with an accent border', () => {
    const places = [makePlace(1, { labelIds: [red.id] }), makePlace(2)];
    const t = TOKENS.pastel.light;
    const markers = toMarkers(places, labelsOf(red), t, places[0]!.id);
    expect(markers[0]).toMatchObject({ selected: true, borderColor: t.accent.main });
    expect(markers[0]!.color).toBe(t.label.red.fill);
    expect(markers[1]).toMatchObject({ selected: false, borderColor: t.border });
  });

  it('skips deleted and unknown labels when choosing the color', () => {
    const gone = { ...blue, deletedAt: '2026-10-08T02:00:00.000Z' };
    const places = [
      makePlace(1, { labelIds: [gone.id, 'unknown1', red.id] }),
      makePlace(2, { labelIds: [gone.id] }),
    ];
    const markers = toMarkers(places, labelsOf(red, gone), TOKENS.pastel.light, null);
    expect(markers[0]!.color).toBe(TOKENS.pastel.light.label.red.fill);
    expect(markers[1]!.color).toBe(TOKENS.pastel.light.bg.surface);
  });

  it('never clusters the selected marker', () => {
    const places = [makePlace(1), makePlace(2)];
    const markers = toMarkers(places, {}, TOKENS.pastel.light, places[0]!.id);
    expect(markers.map((m) => m.clusterable)).toEqual([false, true]);
  });

  it('carries position, clusterable and the selected flag', () => {
    const places = [at(makePlace(1), 127.1, 37.2), at(makePlace(2), 128.3, 38.4)];
    const markers = toMarkers(places, {}, TOKENS.paper.light, places[1]!.id);
    expect(markers).toEqual([
      expect.objectContaining({ id: places[0]!.id, lng: 127.1, lat: 37.2, clusterable: true }),
      expect.objectContaining({ id: places[1]!.id, lng: 128.3, lat: 38.4, clusterable: false }),
    ]);
    expect(markers.map((m) => m.selected === true)).toEqual([false, true]);
  });
});

describe('toMarkers visited', () => {
  it('visited는 다녀온 곳만 true다', () => {
    const places = [
      makePlace(1, { visitedOn: '2026-10-12' }),
      makePlace(2),
      makePlace(3, { visitedOn: null }),
    ];
    const markers = toMarkers(places, {}, TOKENS.pastel.light, null);
    expect(markers.map((m) => m.visited)).toEqual([true, undefined, undefined]);
  });
});
