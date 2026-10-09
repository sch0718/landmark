import { describe, expect, it } from 'vitest';
import { pickField, setField, type Field } from 'src/domain/library/lww';

const f = <T>(value: T, updatedAt: string): Field<T> => ({ value, updatedAt });

describe('pickField', () => {
  it('picks the later updatedAt', () => {
    const older = f('a', '2026-10-08T01:00:00.000Z');
    const newer = f('b', '2026-10-08T02:00:00.000Z');
    expect(pickField(older, newer)).toBe(newer);
    expect(pickField(newer, older)).toBe(newer);
  });

  it('pickField is commutative on ties', () => {
    const t = '2026-10-08T01:00:00.000Z';
    const a = f('가', t);
    const b = f('나', t);
    expect(pickField(a, b)).toEqual(pickField(b, a));
    expect(pickField(a, b).value).toBe('나');
    const x = f(['b'], t);
    const y = f(['a', 'z'], t);
    expect(pickField(x, y)).toEqual(pickField(y, x));
  });

  it('returns the first argument when value and time are identical', () => {
    const t = '2026-10-08T01:00:00.000Z';
    const a = f('same', t);
    expect(pickField(a, f('same', t))).toBe(a);
  });
});

describe('setField', () => {
  it('setField keeps identity when value unchanged', () => {
    const field = f('메모', '2026-10-08T01:00:00.000Z');
    expect(setField(field, '메모', '2026-10-08T02:00:00.000Z')).toBe(field);
    const list = f(['a', 'b'], '2026-10-08T01:00:00.000Z');
    expect(setField(list, ['a', 'b'], '2026-10-08T02:00:00.000Z')).toBe(list);
  });

  it('stamps now when value changes and does not mutate the input', () => {
    const field = f('메모', '2026-10-08T01:00:00.000Z');
    const next = setField(field, '새 메모', '2026-10-08T02:00:00.000Z');
    expect(next).toEqual({ value: '새 메모', updatedAt: '2026-10-08T02:00:00.000Z' });
    expect(field).toEqual({ value: '메모', updatedAt: '2026-10-08T01:00:00.000Z' });
  });
});
