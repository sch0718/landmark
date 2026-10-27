import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LICENSE_URL, NOTICES_PATH } from 'src/config/about';
import { AboutSection } from 'src/sections/settings/AboutSection';

afterEach(cleanup);

describe('AboutSection', () => {
  it('저작권·라이선스·오픈소스 고지를 새 창 링크로 보인다', () => {
    render(<AboutSection kofiUrl="" />);
    expect(screen.getByText(/© 2026 신춘호/)).toBeInTheDocument();
    const license = screen.getByRole('link', { name: '라이선스' });
    expect(license).toHaveAttribute('href', LICENSE_URL);
    expect(license).toHaveAttribute('target', '_blank');
    expect(license).toHaveAttribute('rel', 'noopener');
    expect(screen.getByRole('link', { name: '오픈소스 고지' })).toHaveAttribute(
      'href',
      NOTICES_PATH,
    );
  });

  it('후원 주소가 비어 있으면 후원 링크를 숨긴다', () => {
    render(<AboutSection kofiUrl="  " />);
    expect(screen.queryByRole('link', { name: /후원/ })).toBeNull();
  });

  it('후원 주소가 있으면 일반 링크로만 연다', () => {
    render(<AboutSection kofiUrl="https://ko-fi.com/example" />);
    const kofi = screen.getByRole('link', { name: 'Ko-fi로 후원하기' });
    expect(kofi).toHaveAttribute('href', 'https://ko-fi.com/example');
    expect(kofi).toHaveAttribute('target', '_blank');
    expect(kofi).toHaveAttribute('rel', 'noopener');
    expect(document.querySelector('script')).toBeNull();
  });
});
