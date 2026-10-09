import { Schema } from 'effect';
import { is, parseOrThrow, safeParse } from 'src/schema/parse';
import { describe, expect, it } from 'vitest';

const S = Schema.Struct({ a: Schema.Struct({ b: Schema.Number }) });
const Hhmm = Schema.String.check(
  Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'HH:mm 형식이어야 합니다' }),
);

describe('safeParse / parseOrThrow / is', () => {
  it('returns data on success', () => {
    expect(safeParse(S, { a: { b: 1 } })).toEqual({ success: true, data: { a: { b: 1 } } });
  });
  it('flattens nested issue path', () => {
    const r = safeParse(S, { a: { b: 'x' } });
    expect(r.success).toBe(false);
    expect(!r.success && r.issues[0]!.path).toBe('a.b');
  });
  it('keeps custom filter message', () => {
    expect(safeParse(Hhmm, '24:00')).toEqual({
      success: false,
      issues: [{ path: '', message: 'HH:mm 형식이어야 합니다' }],
    });
  });
  it('rejects excess keys only with onExcessProperty error', () => {
    expect(safeParse(S, { a: { b: 1 }, x: 1 }).success).toBe(true);
    expect(safeParse(S, { a: { b: 1 }, x: 1 }, { onExcessProperty: 'error' }).success).toBe(false);
  });
  it('parseOrThrow throws with path', () => {
    expect(() => parseOrThrow(S, {})).toThrow(/^a:/);
  });
  it('is reports validity', () => {
    expect(is(S, { a: { b: 1 } })).toBe(true);
    expect(is(S, {})).toBe(false);
  });
});
