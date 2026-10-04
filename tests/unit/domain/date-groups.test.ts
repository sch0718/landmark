import { describe, expect, it } from 'vitest';
import { groupDates, placementOfTrip } from 'src/domain/date-groups';
import { makeTrip, sid } from '../../fixtures/builders';

const D1 = '2026-11-14';
const D2 = '2026-11-15';
const D3 = '2026-11-16';

describe('groupDates', () => {
  it('같은 stop id가 다른 날짜에 있으면 그 날짜들을 묶는다', () => {
    const groups = groupDates([{ [D1]: [sid('X')] }, { [D1]: [], [D2]: [sid('X')] }], [D1, D2, D3]);
    expect(groups).toEqual([[D1, D2], [D3]]);
  });

  it('연결이 없으면 모두 단독이고 날짜 오름차순이다', () => {
    expect(groupDates([{ [D2]: [sid('X')], [D1]: [sid('Y')] }], [D3, D2, D1])).toEqual([
      [D1],
      [D2],
      [D3],
    ]);
  });

  it('연쇄 연결은 한 묶음이 된다', () => {
    const groups = groupDates(
      [
        { [D1]: [sid('X')], [D2]: [sid('Y')] },
        { [D2]: [sid('X')], [D3]: [sid('Y')] },
      ],
      [D1, D2, D3],
    );
    expect(groups).toEqual([[D1, D2, D3]]);
  });

  it('allDates에 없는 placement 날짜도 포함한다', () => {
    expect(groupDates([{ [D2]: [sid('X')] }], [D1])).toEqual([[D1], [D2]]);
  });
});

describe('placementOfTrip', () => {
  it('날짜별 stop id 목록을 낸다', () => {
    expect(placementOfTrip(makeTrip({ days: { [D1]: ['X', 'Y'], [D2]: [] } }))).toEqual({
      [D1]: [sid('X'), sid('Y')],
      [D2]: [],
    });
  });
});
