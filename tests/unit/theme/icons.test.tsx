import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeIcon, LabelGlyph, TrashIcon } from 'src/components/icons';
import { LABEL_ICONS } from 'src/schema/library';

describe('icons', () => {
  it('renders a distinct svg for each of the 32 label icons', () => {
    expect(LABEL_ICONS).toHaveLength(32);
    const bodies = new Set<string>();
    for (const name of LABEL_ICONS) {
      const { container, unmount } = render(<LabelGlyph name={name} />);
      const svg = container.querySelector('svg');
      expect(svg, name).not.toBeNull();
      expect(svg?.innerHTML, name).not.toBe('');
      bodies.add(svg?.innerHTML ?? '');
      unmount();
    }
    expect(bodies.size).toBe(32);
  });

  it('label glyph follows font size by default and takes a pixel size', () => {
    const { container } = render(
      <>
        <LabelGlyph name="star" />
        <LabelGlyph name="star" size={20} />
      </>,
    );
    const [auto, sized] = Array.from(container.querySelectorAll('svg'));
    expect(auto?.getAttribute('width')).toBe('1em');
    expect(auto).toHaveAttribute('aria-hidden', 'true');
    expect(sized?.getAttribute('width')).toBe('20');
    expect(sized?.getAttribute('height')).toBe('20');
  });

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
