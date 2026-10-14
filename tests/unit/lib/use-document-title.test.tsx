import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDocumentTitle } from 'src/lib/use-document-title';

afterEach(() => {
  cleanup();
  document.title = '';
});

function Title({ title }: { title: string | null }) {
  useDocumentTitle(title);
  return null;
}

describe('useDocumentTitle', () => {
  it('제목이 있으면 "<제목> · 랜드마크"로 쓴다', () => {
    render(<Title title="보관함" />);
    expect(document.title).toBe('보관함 · 랜드마크');
  });

  it('null이면 "랜드마크"만 쓴다', () => {
    render(<Title title={null} />);
    expect(document.title).toBe('랜드마크');
  });

  it('제목이 바뀌면 따라 바뀐다', () => {
    const { rerender } = render(<Title title="설정" />);
    rerender(<Title title="여행" />);
    expect(document.title).toBe('여행 · 랜드마크');
    rerender(<Title title={null} />);
    expect(document.title).toBe('랜드마크');
  });

  it('언마운트해도 되돌리지 않는다(다음 화면이 정한다)', () => {
    const { unmount } = render(<Title title="설정" />);
    unmount();
    expect(document.title).toBe('설정 · 랜드마크');
  });
});
