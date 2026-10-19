import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOLTIP_TOUCH_DELAY_MS, TruncatedText } from 'src/components/TruncatedText';
import { ColorBadge } from 'src/sections/library/LabelBadge';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const NAME = '신세계 정용진이 모은 맛집-강원 강릉 순두부';

/** jsdom은 배치를 하지 않아 넘침 크기가 0이다. 잘린 것처럼 보이게 크기를 심는다. */
function fakeOverflow(el: HTMLElement, overflow: boolean) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: overflow ? 240 : 100 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 40 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: overflow ? 80 : 40 });
}

function renderInButton(props: { lines?: number } = {}) {
  render(
    <button type="button">
      <TruncatedText {...props}>{NAME}</TruncatedText>
    </button>,
  );
  return screen.getByText(NAME);
}

describe('TruncatedText', () => {
  it('잘리지 않았으면 마우스를 올려도 툴팁이 없다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, false);
    await user.hover(text);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('잘렸으면 마우스를 올릴 때 전체 이름 툴팁이 뜬다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, true);
    await user.hover(text);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(NAME);
    await user.unhover(text);
  });

  it('잘린 글자를 감싼 단추에 키보드 포커스가 오면 툴팁이 뜬다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, true);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(NAME);
    await user.tab();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('마우스·터치로 눌러 생긴 포커스에는 툴팁을 띄우지 않는다', async () => {
    const text = renderInButton();
    fakeOverflow(text, true);
    // 포인터를 누른 뒤의 포커스(글자 위에 마우스는 없음).
    fireEvent.pointerDown(document.body);
    screen.getByRole('button').focus();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('여러 줄이면 세로 넘침으로 잰다', async () => {
    const user = userEvent.setup();
    const text = renderInButton({ lines: 2 });
    fakeOverflow(text, true);
    Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 100 });
    await user.hover(text);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(NAME);
    await user.unhover(text);
  });

  describe('한 단추 안에 여럿', () => {
    const FIRST = '신세계 정용진이 모은 맛집-강원';
    const SECOND = '강원도 강릉시 초당동 순두부길';
    function renderTwo() {
      render(
        <>
          <button type="button">
            <TruncatedText>{FIRST}</TruncatedText>
            <TruncatedText>{SECOND}</TruncatedText>
          </button>
          <button type="button">다음</button>
        </>,
      );
      return [screen.getByText(FIRST), screen.getByText(SECOND)] as const;
    }

    it('둘 다 잘렸으면 키보드 포커스로 첫 번째 글자 툴팁 하나만 뜬다', async () => {
      const user = userEvent.setup();
      const [first, second] = renderTwo();
      fakeOverflow(first, true);
      fakeOverflow(second, true);
      await user.tab();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(FIRST);
      await new Promise((r) => setTimeout(r, 300));
      expect(screen.getAllByRole('tooltip')).toHaveLength(1);
      await user.tab();
    });

    it('첫째가 안 잘리고 둘째만 잘렸으면 둘째 툴팁이 뜬다', async () => {
      const user = userEvent.setup();
      const [first, second] = renderTwo();
      fakeOverflow(first, false);
      fakeOverflow(second, true);
      await user.tab();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(SECOND);
      await new Promise((r) => setTimeout(r, 300));
      expect(screen.getAllByRole('tooltip')).toHaveLength(1);
      await user.tab();
    });

    it('키보드 포커스로 첫째 툴팁을 연 뒤 둘째에 마우스를 올리면 툴팁은 둘째 하나만 남고, Esc 한 번에 모두 닫힌다', async () => {
      const user = userEvent.setup();
      const [first, second] = renderTwo();
      fakeOverflow(first, true);
      fakeOverflow(second, true);
      await user.tab();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(FIRST);
      await user.hover(second);
      await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(SECOND));
      expect(screen.getAllByRole('tooltip')).toHaveLength(1);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
      await user.unhover(second);
      await user.tab();
    });

    it('마우스 오버는 각자 뜬다(둘째 위에 올리면 둘째)', async () => {
      const user = userEvent.setup();
      const [first, second] = renderTwo();
      fakeOverflow(first, true);
      fakeOverflow(second, true);
      await user.hover(second);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(SECOND);
      await user.unhover(second);
    });
  });

  it('단추의 접근 이름은 그대로다', () => {
    renderInButton();
    expect(screen.getByRole('button', { name: NAME })).toBeInTheDocument();
  });
});

describe('TruncatedText 터치', () => {
  function renderTouch(touch?: boolean) {
    render(
      <button type="button">
        <TruncatedText touch={touch}>{NAME}</TruncatedText>
      </button>,
    );
    const text = screen.getByText(NAME);
    fakeOverflow(text, true);
    return text;
  }

  it('길게 누르면(touch 참) 툴팁이 뜨고, 손을 떼면 1.5초 뒤 닫힌다', () => {
    vi.useFakeTimers();
    const text = renderTouch();
    fireEvent.touchStart(text);
    act(() => vi.advanceTimersByTime(TOOLTIP_TOUCH_DELAY_MS - 1));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip')).toHaveTextContent(NAME);
    fireEvent.touchEnd(text);
    act(() => vi.advanceTimersByTime(1499));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('누르다 움직이거나 일찍 떼면 열지 않는다', () => {
    vi.useFakeTimers();
    const text = renderTouch();
    fireEvent.touchStart(text);
    fireEvent.touchMove(text);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.touchStart(text);
    fireEvent.touchEnd(text);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('길게 눌러 연 뒤 터치가 취소되면(브라우저가 스크롤로 넘겨받음) 바로 닫힌다', () => {
    vi.useFakeTimers();
    const text = renderTouch();
    fireEvent.touchStart(text);
    act(() => vi.advanceTimersByTime(TOOLTIP_TOUCH_DELAY_MS));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.touchCancel(text);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('touch={false}면 길게 눌러도 열지 않는다', () => {
    vi.useFakeTimers();
    const text = renderTouch(false);
    fireEvent.touchStart(text);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('TruncatedText 툴팁 위치', () => {
  /** 글자와 툴팁의 화면 위치를 심는다(jsdom은 배치가 없다). */
  function plantRects(
    text: HTMLElement,
    textRect: { left: number; top: number; width: number; height: number },
  ) {
    const rect = (r: { left: number; top: number; width: number; height: number }) =>
      ({
        ...r,
        x: r.left,
        y: r.top,
        right: r.left + r.width,
        bottom: r.top + r.height,
        toJSON: () => ({}),
      }) as DOMRect;
    const current = { ...textRect };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this === text) return rect(current);
      if (this.getAttribute('role') === 'tooltip')
        return rect({ left: 0, top: 0, width: 200, height: 30 });
      return rect({ left: 0, top: 0, width: 0, height: 0 });
    });
    return current;
  }

  it('글자 아래 8px에 두고, 화면 오른쪽 끝 글자면 왼쪽으로 당겨 화면 안(8px 여백)에 둔다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, true);
    plantRects(text, { left: window.innerWidth - 60, top: 100, width: 100, height: 20 });
    await user.hover(text);
    const tip = await screen.findByRole('tooltip');
    expect(tip.style.top).toBe('128px');
    expect(tip.style.left).toBe(`${window.innerWidth - 8 - 200}px`);
    await user.unhover(text);
  });

  it('화면 아래쪽에 자리가 없으면 글자 위에 둔다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, true);
    plantRects(text, { left: 40, top: window.innerHeight - 30, width: 100, height: 20 });
    await user.hover(text);
    const tip = await screen.findByRole('tooltip');
    expect(tip.style.top).toBe(`${window.innerHeight - 30 - 8 - 30}px`);
    expect(tip.style.left).toBe('40px');
    await user.unhover(text);
  });

  it('열린 채 스크롤로 글자가 움직이면 닫힌다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, true);
    const rect = plantRects(text, { left: 40, top: 100, width: 100, height: 20 });
    await user.hover(text);
    await screen.findByRole('tooltip');
    rect.top = 60;
    fireEvent.scroll(document.body);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('스크롤이 와도 글자가 그 자리면(포커스로 끌어온 스크롤 등) 그대로 둔다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, true);
    plantRects(text, { left: 40, top: 100, width: 100, height: 20 });
    await user.tab();
    await screen.findByRole('tooltip');
    fireEvent.scroll(document.body);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.tab();
  });

  it('열린 채 창 크기가 바뀌면 닫힌다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, true);
    await user.hover(text);
    await screen.findByRole('tooltip');
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('ColorBadge', () => {
  it('잘린 라벨 이름의 전체를 툴팁으로 보인다', async () => {
    const user = userEvent.setup();
    render(<ColorBadge color="red" name="신세계 정용진이 모은 맛집-강원" />);
    const text = screen.getByText('신세계 정용진이 모은 맛집-강원');
    fakeOverflow(text, true);
    await user.hover(text);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('신세계 정용진이 모은 맛집-강원');
  });
});
