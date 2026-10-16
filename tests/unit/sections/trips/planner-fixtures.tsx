import { screen, within } from '@testing-library/react';
import { Effect, Layer } from 'effect';
import type { Library, Place } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import type { RouteResult } from 'src/server/route';
import { RouteLookupError, type RouteLookupErrorCode } from 'src/services/errors';
import { RouteLookup } from 'src/services/route-lookup';
import { makePlace, renderLibrary, sampleLibrary, T0, withPlaces } from '../library/fixtures';

// 계획 화면 테스트(시간표·지도)가 함께 쓰는 장소·여행·가짜 경로 조회.

export const f = <V,>(value: V) => ({ value, updatedAt: T0 });

// ---------- 장소 ----------
// fixtures의 장소는 모두 같은 좌표라서, 구간이 생기도록 좌표를 따로 준다.

export const at = (place: Place, lng: number, lat: number): Place => ({ ...place, lng, lat });

export const P1 = 'place00001'; // 중앙시장 닭강정
export const P2 = 'place00002'; // 안목 카페거리 — P1에서 약 4.8km(자동 자동차)
export const P3 = 'place00003'; // 속초 횟집 — P2에서 50km 넘게(도보 불가)
export const P5 = 'place00005'; // 창가 자리 — P1에서 약 440m(자동 도보)
export const HOUSE = 'place00006'; // 바다 숙소
export const GONE = 'place00009'; // 보관함에서 지운 곳

const NAMES: Record<string, string> = {
  '128.9,37.75': '중앙시장 닭강정',
  '128.947,37.772': '안목 카페거리',
  '128.59,38.2': '속초 횟집',
  '128.905,37.75': '창가 자리',
  '128.93,37.76': '바다 숙소',
};

export function plannerLibrary(): Library {
  const base = sampleLibrary();
  return withPlaces(base, [
    at(base.places[P1]!, 128.9, 37.75),
    at(base.places[P2]!, 128.947, 37.772),
    at(base.places[P3]!, 128.59, 38.2),
    at(base.places[P5]!, 128.905, 37.75),
    at(makePlace(6, { name: '바다 숙소' }), 128.93, 37.76),
    at(makePlace(9, { name: '지운 가게', deletedAt: T0 }), 128.91, 37.75),
  ]);
}

// ---------- 여행 ----------

export const TRIP = 'trip000001';

export function makeTrip(
  options: {
    start?: string;
    days?: number;
    stops?: string[][];
    candidates?: string[];
    origin?: string | null;
    lodging?: (string | null)[];
    legModes?: Record<string, 'car' | 'walk'>;
  } = {},
): Trip {
  const start = options.start ?? '2026-10-23';
  const count = options.days ?? 2;
  const endDate = new Date(Date.parse(`${start}T00:00:00Z`) + (count - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  let stopSeq = 0;
  return {
    id: TRIP,
    title: f('강릉 여행'),
    startDate: f(start),
    endDate: f(endDate),
    origin: f<string | null>(options.origin ?? null),
    candidates: f(options.candidates ?? []),
    days: Array.from({ length: count }, (_, i) => ({
      stops: f(
        (options.stops?.[i] ?? []).map((placeId) => ({
          id: `stop${String(stopSeq++).padStart(4, '0')}`,
          placeId,
          stayMin: null,
          fixedTime: null,
          note: '',
        })),
      ),
      lodging: f<string | null>(options.lodging?.[i] ?? null),
      startTime: f('09:00'),
    })),
    legModes: f(options.legModes ?? {}),
    createdAt: T0,
    deletedAt: null,
  };
}

export const withTrip = (lib: Library, trip: Trip): Library => ({
  ...lib,
  trips: { [trip.id]: trip },
});

// ---------- 가짜 경로 조회 ----------

export type Call = { mode: 'car' | 'walk'; from: string; to: string; refresh: boolean };
export type Answer = RouteResult | RouteLookupErrorCode;

export const nameAt = ([lng, lat]: [number, number]) => NAMES[`${lng},${lat}`] ?? `${lng},${lat}`;

export function route(
  minutes: number,
  meters: number,
  options: { toll?: number | null; queriedAt?: string; mode?: 'car' | 'walk' } = {},
): RouteResult {
  return {
    mode: options.mode ?? 'car',
    distanceM: meters,
    durationS: minutes * 60,
    tollFare: options.toll === undefined ? 0 : options.toll,
    path: [
      [128.9, 37.75],
      [128.947, 37.772],
    ],
    queriedAt: options.queriedAt ?? '2026-10-12T03:00:00.000Z',
  };
}

/**
 * 구간을 출발·도착 이름으로 받아 답하는 가짜. 부른 기록을 남긴다. 부를 때마다 서버 요청 하나로 보고
 * 순서 번호(`seq`)를 1부터 매긴다(가짜는 바로 답하니 부른 순서 = 시작한 순서).
 */
export function fakeRoutes(answer: (call: Call, nth: number) => Answer) {
  const calls: Call[] = [];
  let seq = 0;
  const layer = Layer.succeed(
    RouteLookup,
    RouteLookup.of({
      leg: (mode, from, to, options) =>
        Effect.suspend(() => {
          const call = {
            mode,
            from: nameAt(from),
            to: nameAt(to),
            refresh: options?.refresh === true,
          };
          calls.push(call);
          const nth = calls.filter((c) => c.from === call.from && c.to === call.to).length;
          const out = answer(call, nth);
          seq += 1;
          return typeof out === 'string'
            ? Effect.fail(new RouteLookupError({ code: out, seq, fresh: call.refresh }))
            : Effect.succeed({ ...out, seq, fresh: call.refresh });
        }),
    }),
  );
  return { layer, calls };
}

export const legRow = (from: string, to: string) =>
  screen.getByRole('listitem', { name: `${from} → ${to}` });
export const timeline = () => screen.getByRole('region', { name: 'Day 시간표' });
export const stopRow = (name: string) => within(timeline()).getByText(name).closest('li')!;

export async function open(
  lib: Library,
  options: {
    routes?: ReturnType<typeof fakeRoutes>;
    width?: number;
    ids?: string[];
    path?: string;
    libraryLocks?: LockManager;
  } = {},
) {
  return renderLibrary(lib, {
    path: options.path ?? `/trips/${TRIP}`,
    width: options.width,
    ids: options.ids,
    routeLookup: options.routes?.layer,
    libraryLocks: options.libraryLocks,
  });
}
