import { describe, expect, it } from 'vitest';
import { fieldSx, SEARCH_BOX_SX } from 'src/components/field-style';

/** `SystemStyleObject`는 null·함수일 수도 있어 키를 읽기 쉽게 평평한 객체로 본다. */
const plain = (options?: Parameters<typeof fieldSx>[0]) =>
  fieldSx(options) as Record<string, unknown>;

const BORDER = '1px solid var(--tm-border-strong, var(--tm-border))';

describe('fieldSx', () => {
  it('기본: 한 줄 44px·글자 16px·강한 테두리(대체값 포함)·raised 배경·둥근 모서리', () => {
    const sx = plain();
    expect(sx.minHeight).toBe(44);
    expect(sx.fontSize).toBe(16);
    expect(sx.px).toBe(1.25);
    expect(sx.border).toBe(BORDER);
    expect(sx.borderColor).toBeUndefined();
    expect(sx.bgcolor).toBe('var(--tm-bg-raised)');
    expect(sx.borderRadius).toBe('var(--tm-radius-md)');
    expect(sx['&:disabled']).toEqual({ opacity: 0.5 });
  });

  it('포커스 바깥선은 자리에서 다시 정하지 않는다(테마의 전역 규칙)', () => {
    for (const options of [undefined, { multiline: true }, { invalid: true }]) {
      expect(Object.keys(plain(options)).filter((key) => key.includes('focus'))).toEqual([]);
    }
  });

  it('invalid: 테두리 색만 error로 바뀐다', () => {
    const sx = plain({ invalid: true });
    expect(sx.border).toBe(BORDER);
    expect(sx.borderColor).toBe('error.main');
  });

  it('multiline: 최소 높이 96px·세로로만 늘림', () => {
    const sx = plain({ multiline: true });
    expect(sx.minHeight).toBe(96);
    expect(sx.resize).toBe('vertical');
    expect(sx.fontSize).toBe(16);
  });

  it('minHeight로 덮어쓴다(메모 132px)', () => {
    expect(plain({ multiline: true, minHeight: 132 }).minHeight).toBe(132);
    expect(plain({ minHeight: 48 }).minHeight).toBe(48);
  });

  it('한 줄 입력칸에는 resize가 없다', () => {
    expect(plain().resize).toBeUndefined();
  });
});

describe('SEARCH_BOX_SX', () => {
  it('포커스하면 상자 바깥선 하나만 그린다(테두리 색은 바꾸지 않는다)', () => {
    const focus = SEARCH_BOX_SX['&:focus-within'] as Record<string, unknown>;
    expect(focus).toEqual({
      outline: '2px solid var(--tm-accent-text)',
      outlineOffset: 2,
    });
    expect(focus.borderColor).toBeUndefined();
  });

  it('안쪽 입력칸의 전역 바깥선은 끈다', () => {
    expect(SEARCH_BOX_SX['& input:focus-visible']).toEqual({ outline: 'none' });
  });
});
