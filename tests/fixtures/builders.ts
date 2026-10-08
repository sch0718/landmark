import type { EditLayer } from 'src/schema/legacy/edit-layer';
import type { Day, Leg, Place, TripData } from 'src/schema/legacy/trip-data';

const FIXED_NOW = '2026-10-03T00:00:00.000Z';

/** 테스트 표기용 기호를 유효한 StopId로 바꾼다. `'X'` → `'x000'`, `'H2'` → `'h200'`. */
export function sid(symbol: string): string {
  return symbol.toLowerCase().padEnd(4, '0');
}

/** 기호 끝의 숫자를 뗀 문자열이 같으면 같은 장소다(`H`, `H2`). */
const placeSymbol = (symbol: string): string => symbol.replace(/\d+$/, '') || symbol;

export function makeTrip(spec: { days: Record<string, string[]>; places?: string[] }): TripData {
  const placeKeys = new Map<string, string>();
  const places: Record<string, Place> = {};
  const ensurePlace = (symbol: string): string => {
    const base = placeSymbol(symbol);
    const known = placeKeys.get(base);
    if (known) return known;
    const index = placeKeys.size + 1;
    const key = `n:${index}`;
    placeKeys.set(base, key);
    places[key] = {
      name: base,
      address: `주소 ${base}`,
      lng: 127 + index * 0.01,
      lat: 37 + index * 0.01,
      category: '음식점',
      folderIds: ['f1'],
      savedAt: FIXED_NOW,
      sid: String(index),
    };
    return key;
  };

  const dates = Object.keys(spec.days).sort();
  const days: Day[] = dates.map((date) => {
    const stops = (spec.days[date] ?? []).map((symbol) => ({
      id: sid(symbol),
      placeKey: ensurePlace(symbol),
    }));
    const legs: Leg[] = stops.slice(1).map((to, i) => {
      const from = stops[i]!;
      const a = places[from.placeKey]!;
      const b = places[to.placeKey]!;
      return {
        fromStopId: from.id,
        toStopId: to.id,
        fromPlaceKey: from.placeKey,
        toPlaceKey: to.placeKey,
        status: 'routed',
        distanceM: 1000,
        distanceKind: 'road',
        durationMs: 600000,
        staticDurationMs: 540000,
        tollFare: 0,
        path: [
          [a.lng, a.lat],
          [b.lng, b.lat],
        ],
        queriedAt: FIXED_NOW,
      };
    });
    return { date, stops, legs };
  });
  for (const symbol of spec.places ?? []) ensurePlace(symbol);

  return {
    schemaVersion: 1,
    publicId: 'testtrip0001',
    title: '테스트 여행',
    startDate: dates[0] ?? '2026-11-14',
    endDate: dates[dates.length - 1] ?? '2026-11-14',
    dataVersion: FIXED_NOW,
    folders: [{ id: 'f1', name: '테스트 폴더', count: Object.keys(places).length }],
    places,
    days,
  };
}

/**
 * 크기 제한 테스트용: `n:<first>`부터 `count`곳에 작성자 본인의 최대 길이 메모(한글 2000자, 6000바이트)를 단다.
 * 90곳이면 약 0.55MB라 단독으로는 1MB 아래, 겹치지 않는 두 레이어를 합치면 1MB를 넘는다.
 */
export function withBulkyMemos(edit: EditLayer, first: number, count: number): EditLayer {
  const places: EditLayer['places'] = { ...edit.places };
  const text = '가'.repeat(2000);
  for (let i = 0; i < count; i += 1) {
    places[`n:${first + i}`] = { memos: { [edit.authorId]: { text, updatedAt: FIXED_NOW } } };
  }
  return { ...edit, places };
}

export function makeEdit(overrides: Partial<EditLayer> = {}): EditLayer {
  const authorId = overrides.authorId ?? 'a-local';
  return {
    schemaVersion: 1,
    publicId: 'testtrip0001',
    baseDataVersion: FIXED_NOW,
    authorId,
    authors: { [authorId]: { nickname: '나', updatedAt: FIXED_NOW } },
    places: {},
    days: {},
    ...overrides,
  };
}
