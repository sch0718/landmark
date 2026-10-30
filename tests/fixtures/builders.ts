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

/** 약속 시험의 기본값. */
export function buildMeeting(
  overrides: Partial<import('src/schema/meeting').Meeting> = {},
): import('src/schema/meeting').Meeting {
  const f = <T>(value: T) => ({ value, updatedAt: FIXED_NOW });
  return {
    id: 'meeting001',
    title: f('친구 모임'),
    at: f(null),
    mode: f('transit'),
    rank: f('max'),
    participants: f([{ id: 'person01', name: '나', origin: null }]),
    candidates: f([{ id: 'choice01', kind: 'hub', name: '강남역', lng: 127, lat: 37.5 }]),
    replies: f({}),
    decided: f(null),
    createdAt: FIXED_NOW,
    deletedAt: null,
    ...overrides,
  };
}

/** 갱신 공유 시험에 쓰는 이틀 여행 보관함. */
export function buildLiveLibrary(): import('src/schema/library').Library {
  const f = <T>(value: T) => ({ value, updatedAt: FIXED_NOW });
  const place = (n: number): import('src/schema/library').Place => ({
    id: `place0000${n}`,
    name: f(`장소 ${n}`),
    address: `주소 ${n}`,
    lng: 127 + n * 0.1,
    lat: 37.5,
    source: { kind: 'naver', sid: String(n) },
    category: f(null),
    saved: f(true),
    labelIds: f([]),
    memo: f('시험 메모'),
    review: f(''),
    visitedOn: f(null),
    createdAt: FIXED_NOW,
    deletedAt: null,
  });
  const places = [place(1), place(2)];
  return {
    schemaVersion: 2,
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    labels: {},
    folders: {},
    meetings: {},
    trips: {
      trip000001: {
        id: 'trip000001',
        title: f('시험 여행'),
        startDate: f('2026-12-09'),
        endDate: f('2026-12-10'),
        origin: f(null),
        candidates: f([]),
        legModes: f({}),
        createdAt: FIXED_NOW,
        deletedAt: null,
        days: places.map((p, i) => ({
          startTime: f('09:00'),
          lodging: f(null),
          stops: f([
            { id: `stop000${i + 1}`, placeId: p.id, stayMin: 60, fixedTime: null, note: '' },
          ]),
        })),
      },
    },
  };
}
