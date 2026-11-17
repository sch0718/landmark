import { Schema } from 'effect';
import { mergeItem } from 'src/domain/library-sync/merge';
import { describe, expect, it } from 'vitest';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { diffTrip, renameTrip, revertTrip, setLegMinutes, setLegMode } from 'src/domain/trips/ops';
import { legBetween } from 'src/domain/trips/query';
import { estimateLeg } from 'src/domain/trips/geo';
import { LibrarySchema, type Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { TripSchema } from 'src/schema/trip';
import type { OpResult } from 'src/domain/library/ops';

const ID = 'trip000001';
const FROM = 'place00001';
const TO = 'place00002';
const KEY = `${FROM}>${TO}`;
const ctx = { now: '2026-11-17T01:00:00.000Z', newId: () => 'unused0000' };
const later = { ...ctx, now: '2026-11-17T02:00:00.000Z' };
const f = <T>(value: T) => ({ value, updatedAt: ctx.now });
const tripOf = (lib: Library) => lib.trips[ID]!;
function ok(result: OpResult): Library {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(safeParse(LibrarySchema, result.lib).success).toBe(true);
  return result.lib;
}

// 옛 모양은 선택 필드를 빼서 시험 안에서 고정한다.
const OldTripSchema = Schema.Struct({
  id: TripSchema.fields.id,
  title: TripSchema.fields.title,
  startDate: TripSchema.fields.startDate,
  endDate: TripSchema.fields.endDate,
  origin: TripSchema.fields.origin,
  candidates: TripSchema.fields.candidates,
  days: TripSchema.fields.days,
  legModes: TripSchema.fields.legModes,
  createdAt: TripSchema.fields.createdAt,
  deletedAt: TripSchema.fields.deletedAt,
});

describe('구간 대중교통·직접 입력 보관함', () => {
  it('옛 문서를 다시 저장해도 선택 키를 만들지 않는다', () => {
    const lib = ok(renameTrip(buildLiveLibrary(), ID, '수정', ctx));
    expect(tripOf(lib)).not.toHaveProperty('legTransit');
    expect(tripOf(lib)).not.toHaveProperty('legMinutes');
    expect(safeParse(TripSchema, tripOf(lib)).success).toBe(true);
  });

  it('새 문서는 옛 Trip 스키마로 읽을 수 있고 legModes 리터럴은 그대로다', () => {
    const lib = ok(
      setLegMinutes(
        ok(setLegMode(buildLiveLibrary(), ID, FROM, TO, 'transit', ctx)),
        ID,
        FROM,
        TO,
        30,
        ctx,
      ),
    );
    expect(safeParse(OldTripSchema, tripOf(lib)).success).toBe(true);
    expect(tripOf(lib).legModes.value).toEqual({});
    expect(
      safeParse(TripSchema, { ...tripOf(lib), legModes: f({ [KEY]: 'transit' }) }).success,
    ).toBe(false);
  });

  it('대중교통 선택은 정렬·중복 없이 저장하며 먼 구간에도 허용한다', () => {
    const initial = buildLiveLibrary();
    const lib = {
      ...initial,
      places: { ...initial.places, [TO]: { ...initial.places[TO]!, lng: 130 } },
    };
    const a = ok(setLegMode(lib, ID, TO, FROM, 'transit', ctx));
    const b = ok(setLegMode(a, ID, FROM, TO, 'transit', ctx));
    expect(tripOf(b).legTransit).toEqual(f([KEY, `${TO}>${FROM}`]));
    expect(ok(setLegMode(b, ID, FROM, TO, 'transit', later))).toBe(b);
    expect(legBetween(tripOf(b), b.places[FROM]!, b.places[TO]!)).toMatchObject({
      mode: 'transit',
      modeSource: 'user',
      minutes: null,
    });
  });

  it('수단을 바꾸면 분을 지우며 기존 legModes 값을 대중교통 중에도 보존한다', () => {
    const walk = ok(setLegMode(buildLiveLibrary(), ID, FROM, TO, 'walk', ctx));
    const transit = ok(setLegMode(walk, ID, FROM, TO, 'transit', ctx));
    expect(tripOf(transit).legModes.value).toEqual({ [KEY]: 'walk' });
    const manual = ok(setLegMinutes(transit, ID, FROM, TO, 30, ctx));
    const car = ok(setLegMode(manual, ID, FROM, TO, 'car', later));
    expect(tripOf(car).legTransit?.value).toEqual([]);
    expect(tripOf(car).legMinutes?.value).toEqual({});
    expect(tripOf(car).legModes.value).toEqual({});
  });

  it('같은 수단을 다시 골라도 직접 입력한 분은 보존한다', () => {
    const transit = ok(setLegMode(buildLiveLibrary(), ID, FROM, TO, 'transit', ctx));
    const lib = ok(setLegMinutes(transit, ID, FROM, TO, 30, ctx));
    expect(ok(setLegMode(lib, ID, FROM, TO, 'transit', later))).toBe(lib);
  });

  it('분은 처음 쓸 때 만들며 null 지우기는 옛 문서를 바꾸지 않는다', () => {
    const lib = buildLiveLibrary();
    expect(ok(setLegMinutes(lib, ID, FROM, TO, null, ctx))).toBe(lib);
    const manual = ok(setLegMinutes(lib, ID, FROM, TO, 1440, ctx));
    expect(tripOf(manual).legMinutes).toEqual(f({ [KEY]: 1440 }));
    expect(legBetween(tripOf(manual), manual.places[FROM]!, manual.places[TO]!).minutes).toBe(1440);
    expect(tripOf(ok(setLegMinutes(manual, ID, FROM, TO, null, later))).legMinutes?.value).toEqual(
      {},
    );
  });

  it.each([0, -1, 1441, 1.5, NaN, Infinity])(
    '범위 밖 분 %s는 오류이며 스키마도 거절한다',
    (minutes) => {
      expect(setLegMinutes(buildLiveLibrary(), ID, FROM, TO, minutes, ctx).ok).toBe(false);
      expect(
        safeParse(TripSchema, { ...tripOf(buildLiveLibrary()), legMinutes: f({ [KEY]: minutes }) })
          .success,
      ).toBe(false);
    },
  );

  it('없는 장소로 분을 설정할 수 없다', () => {
    expect(setLegMinutes(buildLiveLibrary(), ID, FROM, 'missing000', 30, ctx).ok).toBe(false);
  });

  it.each(['legTransit', 'legMinutes'] as const)(
    '%s 구간 키가 틀리면 보관함 검사가 거절한다',
    (field) => {
      const lib = buildLiveLibrary();
      const invalid = {
        ...lib,
        trips: {
          ...lib.trips,
          [ID]: { ...tripOf(lib), [field]: f(field === 'legTransit' ? ['bad'] : { bad: 30 }) },
        },
      };
      expect(safeParse(LibrarySchema, invalid).success).toBe(false);
    },
  );

  it('선택 필드 생성도 되돌리며 이후 다른 편집은 보존한다', () => {
    const before = buildLiveLibrary();
    const after = ok(setLegMode(before, ID, FROM, TO, 'transit', ctx));
    const change = diffTrip(tripOf(before), tripOf(after));
    expect(change.fields.map((f) => f.path)).toEqual(['legTransit']);
    expect(tripOf(ok(revertTrip(after, change, later))).legTransit).toEqual({
      value: [],
      updatedAt: later.now,
    });
    const edited = ok(setLegMode(after, ID, FROM, TO, 'car', later));
    expect(ok(revertTrip(edited, change, { ...ctx, now: '2026-11-17T03:00:00.000Z' }))).toBe(
      edited,
    );
    const manual = ok(setLegMinutes(before, ID, FROM, TO, 1, ctx));
    expect(
      tripOf(ok(revertTrip(manual, diffTrip(tripOf(before), tripOf(manual)), later))).legMinutes,
    ).toEqual({ value: {}, updatedAt: later.now });
  });

  it('되돌린 수단·분은 이전 문서와 동기화해도 되살아나지 않는다', () => {
    const before = buildLiveLibrary();
    const transit = ok(setLegMode(before, ID, FROM, TO, 'transit', ctx));
    const after = ok(setLegMinutes(transit, ID, FROM, TO, 30, ctx));
    const undone = tripOf(ok(revertTrip(after, diffTrip(tripOf(before), tripOf(after)), later)));
    for (const [a, b] of [
      [undone, tripOf(after)],
      [tripOf(after), undone],
    ]) {
      const merged = mergeItem('trip', a!, b!).doc;
      expect(merged.legTransit).toEqual({ value: [], updatedAt: later.now });
      expect(merged.legMinutes).toEqual({ value: {}, updatedAt: later.now });
      expect(legBetween(merged, after.places[FROM]!, after.places[TO]!)).toMatchObject({
        mode: 'car',
        minutes: null,
      });
    }
  });

  it('선택 필드가 없어진 변경도 값과 새 시각으로 복구한다', () => {
    const base = buildLiveLibrary();
    const before = ok(setLegMinutes(base, ID, FROM, TO, 30, ctx));
    const afterTrip = { ...tripOf(before) };
    delete afterTrip.legMinutes;
    const after = { ...before, trips: { ...before.trips, [ID]: afterTrip } };
    const restored = ok(revertTrip(after, diffTrip(tripOf(before), afterTrip), later));
    expect(tripOf(restored).legMinutes).toEqual({ value: { [KEY]: 30 }, updatedAt: later.now });
  });

  it('대중교통 직선 10km는 13km·49분 어림이다', () => {
    expect(estimateLeg('transit', 10_000)).toEqual({ distanceM: 13_000, durationS: 49 * 60 });
  });
});
