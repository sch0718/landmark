import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from 'src/lib/calendar';

describe('daysBetween', () => {
  it('양 끝을 포함해 센다', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(3);
  });

  it('같은 날이면 1', () => {
    expect(daysBetween('2026-10-24', '2026-10-24')).toBe(1);
  });

  it('거꾸로면 0 이하', () => {
    expect(daysBetween('2026-10-26', '2026-10-24')).toBeLessThanOrEqual(0);
  });

  it('서머타임을 걸친 날짜도 흔들리지 않는다', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(3);
  });
});

describe('addDays', () => {
  it('월·해 경계를 넘긴다', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('음수와 0도 된다', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-24', 0)).toBe('2026-10-24');
  });

  it('서머타임을 걸쳐도 날짜가 어긋나지 않는다', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });
});

describe('trip-dates.ts', () => {
  it('src/schema/ 를 import·re-export 하지 않는다(보기 화면이 Effect를 끌고 오지 않도록)', () => {
    const source = readFileSync('src/sections/trips/trip-dates.ts', 'utf8');
    expect(source).not.toMatch(/\b(?:import|export)\b[^;]*?\bfrom\s*['"]src\/schema\//);
  });
});
