import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LabelGlyph } from 'src/components/icons';
import { LabelChips } from 'src/sections/library/LabelChips';
import { LabelBlock } from 'src/sections/library/views/overview';
import { DEFAULT_QUERY } from 'src/domain/library/query';
import { LabelBadge } from 'src/sections/library/LabelBadge';
import { makeLabel, T0 } from '../sections/library/fixtures';

afterEach(cleanup);

describe('라벨 그림 표시', () => {
  it('이모지가 있으면 장식 텍스트로 보인다', () => {
    const { container } = render(<LabelGlyph emoji="☕" size={18} />);
    expect(screen.getByText('☕')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toBeNull();
  });
  it('이모지는 기본 글자 크기와 지정한 크기를 따른다', () => {
    render(
      <>
        <LabelGlyph emoji="☕" />
        <LabelGlyph emoji="🌊" size={18} />
      </>,
    );
    expect(screen.getByText('☕').style.fontSize).toBe('1em');
    expect(screen.getByText('🌊').style.fontSize).toBe('18px');
    expect(screen.getByText('🌊').style.width).toBe('1em');
    expect(screen.getByText('🌊').style.height).toBe('1em');
  });
  it.each([undefined, null, ''])('이모지 %s면 아무것도 그리지 않는다', (emoji) => {
    const { container } = render(<LabelGlyph emoji={emoji} size={18} />);
    expect(container).toBeEmptyDOMElement();
  });
  it.each([undefined, null, ''])('배지는 이모지 %s면 이름만 보인다', (emoji) => {
    const label = {
      ...makeLabel('label001', '서울 카페', 'red', 'coffee', 0),
      ...(emoji === undefined ? {} : { emoji: { value: emoji, updatedAt: T0 } }),
    };
    const { container } = render(<LabelBadge label={label} />);
    const name = screen.getByText('서울 카페');
    expect(name.parentElement?.children).toHaveLength(1);
    expect(container.querySelector('svg')).toBeNull();
  });
  it.each([undefined, null, ''])('칩과 타일은 이모지 %s면 빈 자리 없이 이름을 보인다', (emoji) => {
    const label = {
      ...makeLabel('label001', '서울 카페', 'red', 'coffee', 0),
      ...(emoji === undefined ? {} : { emoji: { value: emoji, updatedAt: T0 } }),
    };
    const { container } = render(
      <>
        <LabelChips
          query={DEFAULT_QUERY}
          onChange={() => {}}
          labels={[label]}
          counts={new Map()}
          manageLink={false}
        />
        <LabelBlock label={label} count={0} selected={false} onClick={() => {}} />
      </>,
    );
    const chip = screen.getByRole('button', { name: '서울 카페 0' });
    expect(chip.firstElementChild?.children).toHaveLength(1);
    const tile = screen.getByRole('button', { name: '서울 카페 0곳' });
    expect(tile.children).toHaveLength(2);
    expect(tile.querySelector('[aria-hidden]')).toBeNull();
    expect(getComputedStyle(tile.firstElementChild!).paddingRight).toBe('0px');
    expect(container.querySelector('svg')).toBeNull();
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
