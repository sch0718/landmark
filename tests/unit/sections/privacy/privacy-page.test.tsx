import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PRIVACY_SECTIONS } from 'src/sections/privacy/privacy-content';
import { PrivacyPage } from 'src/sections/privacy/PrivacyPage';

describe('개인정보 처리방침', () => {
  it('항목마다 제목을 보이고 백틱은 강조로 바꾼다', () => {
    const { container } = render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: '개인정보 처리방침', level: 1 }),
    ).toBeInTheDocument();
    for (const section of PRIVACY_SECTIONS) {
      expect(screen.getByRole('heading', { name: section.title, level: 2 })).toBeInTheDocument();
    }
    expect(container.textContent).not.toContain('`');
    expect(screen.getByRole('link', { name: '← 도움말' })).toHaveAttribute('href', '/help');
  });
});
