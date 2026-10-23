import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BedIcon, CarIcon, FootprintsIcon, HomeIcon, TrashIcon } from 'src/components/icons';

describe('icons', () => {
  it('숙소·차·도보 아이콘은 서로 다른 SVG이다', () => {
    const bodies = new Set<string>();
    for (const Icon of [BedIcon, CarIcon, FootprintsIcon]) {
      const { container, unmount } = render(<Icon aria-hidden="true" />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.innerHTML).not.toBe('');
      bodies.add(svg?.innerHTML ?? '');
      unmount();
    }
    expect(bodies.size).toBe(3);
  });

  it.each([BedIcon, CarIcon, FootprintsIcon])(
    '플래너 아이콘은 글자 크기와 지정한 크기를 따른다',
    (Icon) => {
      const { container, unmount } = render(
        <>
          <Icon aria-hidden="true" />
          <Icon aria-hidden="true" width={16} height={16} />
          <Icon aria-hidden="true" width={18} height={18} />
        </>,
      );
      const [auto, small, large] = Array.from(container.querySelectorAll('svg'));
      expect(auto).toHaveAttribute('width', '1em');
      expect(auto).toHaveAttribute('aria-hidden', 'true');
      expect(small).toHaveAttribute('width', '16');
      expect(small).toHaveAttribute('height', '16');
      expect(large).toHaveAttribute('width', '18');
      expect(large).toHaveAttribute('height', '18');
      expect(small).toHaveAttribute('aria-hidden', 'true');
      expect(large).toHaveAttribute('aria-hidden', 'true');
      unmount();
    },
  );

  it('exports named UI icons', () => {
    const { container } = render(
      <>
        <HomeIcon />
        <TrashIcon />
      </>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });
});
