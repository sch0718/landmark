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
  it('marker color follows first label and theme tokens', () => {
    const places = [
      makePlace(1, { labelIds: [blue.id, red.id] }),
      makePlace(2, { labelIds: [red.id] }),
      makePlace(3),
    ];
    const labels = labelsOf(red, blue);

    const light = toMarkers(places, labels, TOKENS.pastel.light, null);
    expect(light.map((m) => m.color)).toEqual([
      TOKENS.pastel.light.label.blue.marker,
      TOKENS.pastel.light.label.red.marker,
      TOKENS.pastel.light.text.muted,
    ]);

    // 같은 장소라도 테마가 바뀌면 색이 따라 바뀐다.
    const night = toMarkers(places, labels, TOKENS.night.dark, null);
    expect(night.map((m) => m.color)).toEqual([
      TOKENS.night.dark.label.blue.marker,
      TOKENS.night.dark.label.red.marker,
      TOKENS.night.dark.text.muted,
    ]);
    expect(night[1]!.color).not.toBe(light[1]!.color);
  });

  it('skips deleted and unknown labels when choosing the color', () => {
    const gone = { ...blue, deletedAt: '2026-10-08T02:00:00.000Z' };
    const places = [
      makePlace(1, { labelIds: [gone.id, 'unknown1', red.id] }),
      makePlace(2, { labelIds: [gone.id] }),
    ];
    const markers = toMarkers(places, labelsOf(red, gone), TOKENS.pastel.light, null);
    expect(markers[0]!.color).toBe(TOKENS.pastel.light.label.red.marker);
    expect(markers[1]!.color).toBe(TOKENS.pastel.light.text.muted);
  });

  it('carries position, clusterable and the selected flag', () => {
    const places = [at(makePlace(1), 127.1, 37.2), at(makePlace(2), 128.3, 38.4)];
    const markers = toMarkers(places, {}, TOKENS.paper.light, places[1]!.id);
    expect(markers).toEqual([
      expect.objectContaining({ id: places[0]!.id, lng: 127.1, lat: 37.2, clusterable: true }),
      expect.objectContaining({ id: places[1]!.id, lng: 128.3, lat: 38.4, clusterable: true }),
    ]);
    expect(markers.map((m) => m.selected === true)).toEqual([false, true]);
  });
});
