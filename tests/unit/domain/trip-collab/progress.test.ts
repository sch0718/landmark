// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  queueOp,
  sharedMarkOf,
  sharedNextIndex,
  withLocalOps,
  type SharedProgress,
} from 'src/domain/trip-collab/progress';
const mark = {
  stopId: 'stop0001',
  date: '2026-11-01',
  at: '2026-11-01T01:00:00.000Z',
  by: { device: 'device01', label: '민지 폰' },
};
const progress = (): SharedProgress => ({
  prev: 2,
  marks: [mark],
  next: { stopId: mark.stopId, date: mark.date, at: mark.at, label: mark.by.label },
});
describe('공동 진행 도메인', () => {
  it('기간 밖·없는 Stop·없는 진행 표시는 null이다', () => {
    expect(
      sharedMarkOf(progress(), mark.stopId, { startDate: mark.date, endDate: mark.date }),
    ).toEqual(mark);
    expect(
      sharedMarkOf(progress(), mark.stopId, { startDate: '2026-11-02', endDate: '2026-11-03' }),
    ).toBeNull();
    expect(
      sharedMarkOf(null, mark.stopId, { startDate: mark.date, endDate: mark.date }),
    ).toBeNull();
    expect(
      sharedMarkOf(progress(), 'stop0002', { startDate: mark.date, endDate: mark.date }),
    ).toBeNull();
  });
  it('정한 다음 장소는 날짜가 같고 목록에 있으며 안 다녀왔을 때만 우선한다', () => {
    expect(sharedNextIndex(progress(), mark.date, ['stop0002', mark.stopId], [false, false])).toBe(
      1,
    );
    expect(sharedNextIndex(progress(), mark.date, [mark.stopId], [true])).toBeNull();
    expect(sharedNextIndex(progress(), '2026-11-02', [mark.stopId], [false])).toBeNull();
    expect(sharedNextIndex(progress(), mark.date, [], [])).toBeNull();
    expect(sharedNextIndex(null, mark.date, [mark.stopId], [false])).toBeNull();
  });
  it('같은 Stop은 마지막 동작만 남기고 오래된 것부터 상한만큼 버린다', () => {
    const a = { stopId: 'a', visited: true, date: mark.date, at: mark.at },
      b = { ...a, stopId: 'b' };
    expect(queueOp([a, b], { ...a, visited: false }, 2)).toEqual([b, { ...a, visited: false }]);
    expect(queueOp([a, b], { ...a, stopId: 'c' }, 2).map((p) => p.stopId)).toEqual(['b', 'c']);
    const ops = Array.from({ length: 200 }, (_, i) => ({ ...a, stopId: String(i) }));
    expect(queueOp(ops, a)).toHaveLength(200);
    expect(ops).toHaveLength(200);
  });
  it('내 체크와 풀기를 겹쳐 보이고 더 늦은 공동 표시는 유지한다', () => {
    const me = { device: 'mydevice', label: '내 폰' };
    const op = {
      stopId: mark.stopId,
      date: mark.date,
      at: '2026-11-01T02:00:00.000Z',
      visited: false,
    };
    const original = progress();
    expect(withLocalOps(original, [op], me).marks).toEqual([]);
    expect(withLocalOps(original, [{ ...op, at: '2026-11-01T00:00:00.000Z' }], me).marks).toEqual([
      mark,
    ]);
    expect(withLocalOps(null, [{ ...op, visited: true }], me)).toEqual({
      prev: 0,
      next: null,
      marks: [{ stopId: mark.stopId, date: mark.date, at: op.at, by: me }],
    });
    expect(original).toEqual(progress());
  });
});
