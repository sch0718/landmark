import { describe, expect, it } from 'vitest';
import { hashDayStops } from 'src/domain/day-hash';
import { overlay } from 'src/domain/overlay';
import { applyRevert, planRevert } from 'src/domain/revert';
import { makeEdit, makeTrip, sid } from '../../fixtures/builders';

const NOW = '2026-10-03T01:00:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';
const D3 = '2026-11-16';

const trip = makeTrip({ days: { [D1]: ['X'], [D2]: ['Y'], [D3]: ['Z'] } });
const stopX = trip.days[0]!.stops[0]!;
const stopY = trip.days[1]!.stops[0]!;
// X를 D1에서 D2로 옮긴 편집
const moved = makeEdit({
  days: {
    [D1]: {
      mode: 'override',
      stops: [],
      baseDayHash: hashDayStops(trip.days[0]!.stops),
      updatedAt: NOW,
    },
    [D2]: {
      mode: 'override',
      stops: [stopY, stopX],
      baseDayHash: hashDayStops(trip.days[1]!.stops),
      updatedAt: NOW,
    },
  },
});

describe('planRevert', () => {
  it('이동 후 출발일을 되돌리면 도착일이 함께 묶인다', () => {
    expect(planRevert(trip, moved, D1).dates).toEqual([D1, D2]);
    expect(planRevert(trip, moved, D2).dates).toEqual([D1, D2]);
  });

  it('이동과 무관한 날은 그날 하나다', () => {
    expect(planRevert(trip, moved, D3).dates).toEqual([D3]);
  });
});

describe('applyRevert', () => {
  it('묶음을 되돌리면 X가 D1에만 한 번 나온다', () => {
    const { dates } = planRevert(trip, moved, D1);
    const reverted = applyRevert(moved, dates, NOW);
    expect(reverted.days[D1]).toEqual({ mode: 'reset', updatedAt: NOW });
    expect(reverted.days[D2]).toEqual({ mode: 'reset', updatedAt: NOW });
    const eff = overlay(trip, reverted).days;
    expect(eff.map((d) => d.stops.map((s) => s.id))).toEqual([[sid('X')], [sid('Y')], [sid('Z')]]);
  });

  it('입력을 변경하지 않는다', () => {
    const snapshot = structuredClone(moved);
    applyRevert(moved, [D1, D2], NOW);
    expect(moved).toEqual(snapshot);
  });
});
