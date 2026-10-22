import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LabelGlyph } from 'src/components/icons';
import { LabelBadge } from 'src/sections/library/LabelBadge';
import { makeLabel, T0 } from '../sections/library/fixtures';

afterEach(cleanup);

describe('라벨 그림 표시', () => {
  it('이모지가 있으면 아이콘보다 먼저 장식 텍스트로 보인다', () => {
    const { container } = render(<LabelGlyph name="coffee" emoji="☕" size={18} />);
    expect(screen.getByText('☕')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toBeNull();
  });
  it.each([undefined, null])('이모지 %s면 기존 아이콘이다', (emoji) => {
    const { container } = render(<LabelGlyph name="coffee" emoji={emoji} size={18} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
  it('배지는 이름과 이모지를 보이며 이모지는 읽지 않는다', () => {
    const label = {
      ...makeLabel('label001', '서울 카페', 'red', 'star', 0),
      emoji: { value: '☕', updatedAt: T0 },
    };
    const { container } = render(<LabelBadge label={label} />);
    expect(screen.getByText('서울 카페')).toBeInTheDocument();
    expect(screen.getByText('☕')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toBeNull();
  });
});
