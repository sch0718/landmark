// @vitest-environment node
import { expect, it } from 'vitest';
import { mergeCollabPlan, resolveCollabMerge, type CollabSide } from 'src/domain/trip-collab/merge';
import { checkPlan } from 'src/domain/trip-collab/plan';
import { mkPlan } from './builders';
it('유효한 배치·기간·값 변경 8281쌍은 모든 선택을 새 질문 없이 끝낸다', () => {
  const base = mkPlan({ days: [['a', 'b'], ['c']] });
  const variants = (side: string) => {
    const plans = [];
    for (const count of [1, 2]) {
      const slots = count + 2;
      for (let code = 0; code < slots ** 3; code++) {
        const days: string[][] = Array.from({ length: count }, () => []);
        const candidates: string[] = [];
        let value = code;
        for (const place of ['a', 'b', 'c']) {
          const slot = value % slots;
          value = Math.floor(value / slots);
          if (slot === 1) candidates.push(place);
          else if (slot >= 2) days[slot - 2]!.push(place);
        }
        for (const row of days) {
          if (side === 'mine') row.reverse();
          else if (row.length) row.push(row.shift()!);
        }
        const plan = mkPlan({
          days,
          candidates,
          notes: { a: side, b: side, c: side },
          startTimes: [side === 'mine' ? '10:00' : '08:00', side === 'mine' ? '11:00' : '07:00'],
        });
        expect(checkPlan(plan)).toEqual([]);
        plans.push(plan);
      }
    }
    return plans;
  };
  let combinations = 0;
  for (const mine of variants('mine'))
    for (const theirs of variants('theirs')) {
      const merge = mergeCollabPlan(base, mine, theirs);
      for (let mask = 0; mask < 2 ** merge.conflicts.length; mask++) {
        const choices = Object.fromEntries(
          merge.conflicts.map((c, i) => [
            c.id,
            ((mask >> i) & 1 ? 'mine' : 'theirs') as CollabSide,
          ]),
        );
        const result = resolveCollabMerge(merge, choices);
        combinations++;
        if (!result.ok)
          expect(result, JSON.stringify({ mine, theirs, choices })).toMatchObject({ ok: true });
      }
    }
  expect(combinations).toBeGreaterThan(8281);
}, 30000);
