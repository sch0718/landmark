import { describe, expect, it } from 'vitest';
import { resolveSnap, sheetHalfPx } from 'src/sections/shell/sheet-snap';

const base = { halfPx: 320, fullPx: 760 };

describe('sheetHalfPx', () => {
  it('창 높이의 45%를 쓰되 320px을 넘지 않는다', () => {
    expect(sheetHalfPx(812)).toBe(320);
    expect(sheetHalfPx(600)).toBe(270);
  });
});

describe('resolveSnap', () => {
  it('빠르게 위로 튕기면 다 펼친다', () => {
    expect(resolveSnap({ ...base, from: 'half', offsetPx: -20, velocity: -0.8 })).toBe('full');
  });

  it('빠르게 아래로 튕기면 다 펼침은 반쯤, 반쯤은 닫힘', () => {
    expect(resolveSnap({ ...base, from: 'full', offsetPx: 30, velocity: 0.9 })).toBe('half');
    expect(resolveSnap({ ...base, from: 'half', offsetPx: 30, velocity: 0.9 })).toBe('closed');
  });

  it('천천히 놓으면 가장 가까운 단계로 간다', () => {
    expect(resolveSnap({ ...base, from: 'half', offsetPx: -300, velocity: 0 })).toBe('full');
    expect(resolveSnap({ ...base, from: 'half', offsetPx: -50, velocity: 0 })).toBe('half');
    expect(resolveSnap({ ...base, from: 'half', offsetPx: 200, velocity: 0 })).toBe('closed');
    expect(resolveSnap({ ...base, from: 'full', offsetPx: 300, velocity: 0 })).toBe('half');
  });

  it('다 펼침에서 한 번에 끝까지 끌어도 반쯤에서 멈춘다', () => {
    expect(resolveSnap({ ...base, from: 'full', offsetPx: 740, velocity: 0 })).toBe('half');
  });
});
