import { expect, it } from 'vitest';
import { buildTripShareDoc } from 'src/domain/share/build-trip-share';
import { applyCollabPlan } from 'src/domain/trip-collab/apply';
import { buildCollabDoc } from 'src/domain/trip-collab/build-doc';
import { planFromDoc } from 'src/domain/trip-collab/plan';
import { buildLiveTripDoc, ESTIMATE_ONLY } from 'src/domain/trip-live/build-live-doc';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { booking, phrase, prepNote } from '../../../fixtures/trip-prep';

const id = 'trip000001';
const at = '2026-11-27T09:00:00.000Z';
const f = <T>(value: T) => ({ value, updatedAt: at });
const prep = { bookings: f([booking]), prepNotes: f([prepNote]), phrases: f([phrase]) };
const options = { includeMemo: true, includeCandidates: true };
const placeMap = { place00001: 'place00001', place00002: 'place00002' };

function expectNoPrep(doc: object | null) {
  expect(doc).not.toBeNull();
  const json = JSON.stringify(doc);
  for (const key of Object.keys(prep)) expect(json).not.toContain(`"${key}"`);
  expect(json).not.toContain('ZZCODE123');
}

function library() {
  const lib = buildLiveLibrary();
  return {
    ...lib,
    trips: { [id]: { ...lib.trips[id]!, origin: f('place00002'), ...prep } },
  };
}

it.each([2, 3])('일정 공유 v%s에는 준비 정보를 싣지 않는다', (version) => {
  const lib = library();
  const key = 'place00002>place00001';
  if (version === 3)
    Object.assign(lib.trips[id]!, {
      legTransit: f([key]),
      legMinutes: f({ [key]: 25 }),
    });
  const doc = buildTripShareDoc(lib, id, ESTIMATE_ONLY, {
    ...options,
    title: '여행 공유',
    now: new Date(at),
  });
  expect(doc?.version).toBe(version);
  expectNoPrep(doc);
});

it('갱신 링크와 함께 편집에는 준비 정보를 싣지 않고, 공동 변경을 적용해도 로컬 값이 남는다', () => {
  const lib = library();
  const live = buildLiveTripDoc(lib, id, ESTIMATE_ONLY, {
    title: '여행 공유',
    options,
    dayIds: ['day00001', 'day00002'],
    createdAt: at,
  });
  expectNoPrep(live);
  const plan = planFromDoc(live!);
  const shared = buildCollabDoc({
    plan,
    previous: live,
    lib,
    placeMap,
    role: 'owner',
    options,
    createdAt: at,
    routeOf: () => ({
      mode: 'car',
      time: {
        durationS: 0,
        distanceM: 0,
        tollFare: null,
        status: 'estimated',
        queriedAt: null,
        path: [],
      },
    }),
  });
  expectNoPrep(shared);
  plan.days[0]!.startTime = '10:00';
  const result = applyCollabPlan(lib, id, plan, placeMap, { now: at, newId: () => 'unused0000' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.lib.trips[id]).toMatchObject({
    ...prep,
    days: [expect.objectContaining({ startTime: f('10:00') }), expect.anything()],
  });
});
