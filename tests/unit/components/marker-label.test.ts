import { describe, expect, it } from 'vitest';
import { createMarkerLabelElement } from 'src/components/map/marker-label';

describe('지도 마커 모양', () => {
  it('점은 32px 누름 영역 안의 12px 원이고 Day·이름은 설명으로만 둔다', () => {
    const label = 'Day 2 · <바다 카페>';
    const el = createMarkerLabelElement(label, '#123456', { shape: 'dot', dimmed: true });
    expect(el).toHaveAttribute('data-shape', 'dot');
    expect(el).toHaveAttribute('title', label);
    expect(el).toHaveAttribute('aria-label', label);
    expect(el.textContent).toBe('');
    expect(el.style.width).toBe('32px');
    expect(el.style.height).toBe('32px');
    const dot = el.firstElementChild as HTMLElement;
    expect(dot.style.width).toBe('12px');
    expect(dot.style.height).toBe('12px');
    expect(dot.style.borderRadius).toBe('50%');
    expect(dot.style.border).toBe('2px solid rgb(255, 255, 255)');
    expect(dot.style.background).toBe('rgb(18, 52, 86)');
    expect(dot.style.opacity).toBe('0.5');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(el.querySelector('바다')).toBeNull();
  });

  it('이름표는 기존 패딩·글자·방문 설명을 유지한다', () => {
    const el = createMarkerLabelElement('카페', '#123456', { visited: true, dimmed: true });
    expect(el.textContent).toBe('✓ 카페');
    expect(el.title).toBe('카페 · 다녀옴');
    expect(el.style.padding).toBe('2px 8px');
    expect(el.style.borderRadius).toBe('12px');
    expect(el.style.opacity).toBe('0.5');
    expect(el).not.toHaveAttribute('data-shape');
  });
});
