import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { helpText } from 'src/sections/help/help-text';

describe('도움말 강조', () => {
  it('백틱 속 단추만 강조하고 나머지는 텍스트로 보인다', () => {
    const { container } = render(<p>{helpText('먼저 `추가`를 누르고 `저장`해요.')}</p>);
    expect(container.textContent).toBe('먼저 추가를 누르고 저장해요.');
    expect(screen.getByText('추가').tagName).toBe('SPAN');
    expect(screen.getByText('저장').tagName).toBe('SPAN');
  });
  it('태그 문자는 실행하지 않고 짝 없는 백틱은 보존한다', () => {
    const { container } = render(<p>{helpText('`<img src=x onerror=alert(1)>`와 `남은 글')}</p>);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror=alert(1)>와 `남은 글');
  });
  it('강조 없는 글과 빈 글도 그대로 보인다', () => {
    expect(helpText('그대로')).toEqual(['그대로']);
    expect(helpText('')).toEqual(['']);
  });
});
