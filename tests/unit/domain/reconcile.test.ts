import { describe, expect, it } from 'vitest';
import { hashDayStops } from 'src/domain/day-hash';
import { findDuplicateStopIds, overlay } from 'src/domain/overlay';
import { keepMine, reconcile } from 'src/domain/reconcile';
import { EDIT_LAYER_PARSE, EditLayerSchema } from 'src/schema/legacy/edit-layer';
import { safeParse } from 'src/schema/parse';
import { makeEdit, makeTrip, sid } from '../../fixtures/builders';

const OLD = '2026-10-03T00:30:00.000Z';
const NOW = '2026-10-03T01:00:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';

describe('reconcile', () => {
  it('v2에 v1 편집: 사라진 장소의 stop을 제거하고 미해결로 남긴다', () => {
    const v1 = makeTrip({ days: { [D1]: ['A', 'P'] } });
    const v2 = makeTrip({ days: { [D1]: ['A', 'B'] } });
    const stopP = { id: sid('P'), placeKey: 'n:99' };
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [v1.days[0]!.stops[0]!, stopP],
          baseDayHash: hashDayStops(v1.days[0]!.stops),
          updatedAt: OLD,
        },
      },
    });
    const frozen = JSON.stringify(edit);
    const { edit: out, report } = reconcile(v2, edit);
    expect(JSON.stringify(edit)).toBe(frozen);
    expect(report.removedStops).toEqual([{ date: D1, stopId: sid('P'), placeKey: 'n:99' }]);
    expect(report.unresolvedGroups).toEqual([[D1]]);
    const day = out.days[D1]!;
    expect(day.mode === 'override' && day.stops.map((s) => s.id)).toEqual([sid('A')]);
    expect(day.updatedAt).toBe(OLD);
    expect(out.baseDataVersion).toBe(v2.dataVersion);
    expect(reconcile(v2, out).report.unresolvedGroups).toEqual([[D1]]);
  });

  it('override가 원본과 같으면 reset하고 updatedAt을 유지한다', () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: trip.days[0]!.stops,
          baseDayHash: 'stale',
          updatedAt: OLD,
        },
      },
    });
    const { edit: out, report } = reconcile(trip, edit);
    expect(out.days[D1]).toEqual({ mode: 'reset', updatedAt: OLD });
    expect(report.autoResetDates).toEqual([D1]);
    expect(report.unresolvedGroups).toEqual([]);
  });

  it('고아 PlaceEdit은 남기고 보고한다', () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const edit = makeEdit({
      places: { 'n:77': { tags: ['x'], memos: {} } as never },
      days: { '2026-12-25': { mode: 'reset', updatedAt: OLD } },
    });
    const { edit: out, report } = reconcile(trip, edit);
    expect(out.places['n:77']).toBeDefined();
    expect(report.orphanPlaceKeys).toEqual(['n:77']);
    expect(report.hiddenEditDates).toEqual(['2026-12-25']);
  });

  it('원본이 방문 날짜를 바꾸면 묶음이 되고 keepMine으로 해결된다', () => {
    const v1 = makeTrip({ days: { [D1]: ['X'], [D2]: [] } });
    const v2 = makeTrip({ days: { [D1]: [], [D2]: ['X'] } });
    const stopX = { ...v1.days[0]!.stops[0]!, note: '내 메모' };
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [stopX],
          baseDayHash: hashDayStops(v1.days[0]!.stops),
          updatedAt: OLD,
        },
      },
    });
    const { edit: rec, report } = reconcile(v2, edit);
    expect(report.unresolvedGroups).toEqual([[D1, D2]]);

    const kept = keepMine(v2, rec, [D1, D2], NOW);
    expect(kept).not.toBeNull();
    expect(kept!.days[D2]).toEqual({
      mode: 'override',
      stops: [],
      baseDayHash: hashDayStops(v2.days[1]!.stops),
      updatedAt: NOW,
    });
    const d1 = kept!.days[D1]!;
    expect(d1.mode === 'override' && d1.baseDayHash).toBe(hashDayStops(v2.days[0]!.stops));
    expect(d1.updatedAt).toBe(NOW);
    expect(reconcile(v2, kept!).report.unresolvedGroups).toEqual([]);
    const ids = overlay(v2, kept!).days.flatMap((d) => d.stops.map((s) => s.id));
    expect(ids).toEqual([sid('X')]);
  });

  it('keepMine은 중복이 생기면 null을 돌려준다', () => {
    const trip = makeTrip({ days: { [D1]: ['X'], [D2]: [] } });
    const sx = trip.days[0]!.stops[0]!;
    const edit = makeEdit({
      days: {
        [D1]: { mode: 'override', stops: [sx], baseDayHash: 'old', updatedAt: OLD },
        [D2]: { mode: 'override', stops: [sx], baseDayHash: 'old', updatedAt: OLD },
      },
    });
    expect(findDuplicateStopIds(overlay(trip, edit).days)).toEqual([sid('X')]);
    expect(keepMine(trip, edit, [D1, D2], NOW)).toBeNull();
    expect(safeParse(EditLayerSchema, edit, EDIT_LAYER_PARSE).success).toBe(true);
  });
});

describe('reconcile 자동 reset은 내용 비교로 판정한다', () => {
  // 32비트 FNV-1a에서 같은 해시(a6dc8dac)를 내던 쌍. 해시 비교로 reset하면 로컬 메모가 사라졌다.
  const ORIGINAL_NOTE = '219449961';
  const LOCAL_NOTE = '3478588219';

  it('해시가 충돌하던 쌍도 내용이 다르면 override를 유지하고 메모를 지킨다', () => {
    const base = makeTrip({ days: { [D1]: ['X'] } });
    const trip = {
      ...base,
      days: [{ ...base.days[0]!, stops: [{ id: sid('X'), placeKey: 'n:1', note: ORIGINAL_NOTE }] }],
    };
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [{ id: sid('X'), placeKey: 'n:1', note: LOCAL_NOTE }],
          baseDayHash: hashDayStops(trip.days[0]!.stops),
          updatedAt: OLD,
        },
      },
    });
    const { edit: out, report } = reconcile(trip, edit);
    expect(report.autoResetDates).toEqual([]);
    const day = out.days[D1]!;
    expect(day.mode).toBe('override');
    expect(day.mode === 'override' && day.stops[0]!.note).toBe(LOCAL_NOTE);
  });

  it('time·note가 모두 같으면 여전히 reset한다(undefined와 생략은 같다)', () => {
    const base = makeTrip({ days: { [D1]: ['X'] } });
    const trip = {
      ...base,
      days: [{ ...base.days[0]!, stops: [{ id: sid('X'), placeKey: 'n:1', time: '10:00' }] }],
    };
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [{ id: sid('X'), placeKey: 'n:1', time: '10:00', note: undefined }],
          baseDayHash: 'stale',
          updatedAt: OLD,
        },
      },
    });
    expect(reconcile(trip, edit).report.autoResetDates).toEqual([D1]);
  });
});
