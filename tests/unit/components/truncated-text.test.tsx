import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { TruncatedText } from 'src/components/TruncatedText';
import { ColorBadge } from 'src/sections/library/LabelBadge';

afterEach(cleanup);

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
