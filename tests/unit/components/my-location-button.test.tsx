import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyLocationButton } from 'src/components/map/MyLocationButton';

afterEach(cleanup);

describe('MyLocationButton', () => {
  it('이름이 `내 위치 보기`이고 44px이며 누르면 onClick을 부른다', async () => {
    const onClick = vi.fn();
    render(<MyLocationButton locating={false} onClick={onClick} />);
    const button = screen.getByRole('button', { name: '내 위치 보기' });
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(getComputedStyle(button).width).toBe('44px');
    expect(getComputedStyle(button).height).toBe('44px');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('찾는 중에는 이름이 바뀌고 aria-busy·aria-disabled이며 포커스는 받되 눌러도 onClick을 부르지 않는다', async () => {
    const onClick = vi.fn();
    render(<MyLocationButton locating onClick={onClick} />);
    const button = screen.getByRole('button', { name: '내 위치를 찾는 중' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('progressbar', { hidden: true })).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
