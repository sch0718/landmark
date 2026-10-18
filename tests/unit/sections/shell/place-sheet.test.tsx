import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaceSheet } from 'src/sections/shell/PlaceSheet';
import type { SheetSnap } from 'src/sections/shell/sheet-snap';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Harness({
  initial = 'half',
  onSnapChange = vi.fn(),
  onClose = vi.fn(),
  onInner = vi.fn(),
  hideOnClose = false,
}: {
  initial?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  onClose?: () => void;
  onInner?: () => void;
  /** 참이면 닫기가 시트를 실제로 치운다(포커스 복귀 시험용). */
  hideOnClose?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [snap, setSnap] = useState<SheetSnap>(initial);
  return (
    <div>
      <button type="button" onClick={() => setShown(true)}>
        연 요소
      </button>
      <button type="button" onClick={() => setShown(false)}>
        치우기
      </button>
      <main id="main" tabIndex={-1} />
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        {shown && (
          <PlaceSheet
            snap={snap}
            onSnapChange={(next) => {
              onSnapChange(next);
              setSnap(next);
            }}
            onClose={() => {
              onClose();
              if (hideOnClose) setShown(false);
            }}
          >
            <button type="button" onClick={onInner}>
              안쪽 단추
            </button>
            <input aria-label="편집칸" onKeyDown={(event) => event.preventDefault()} />
          </PlaceSheet>
        )}
      </div>
    </div>
  );
}

async function open(props: Parameters<typeof Harness>[0] = {}) {
  render(<Harness {...props} />);
  await userEvent.click(screen.getByRole('button', { name: '연 요소' }));
  return screen.getByRole('region', { name: '장소 상세' });
}

/** 끌기 흉내. 움직임 사이에 `ms`만큼 시간을 흘려 빠르기를 정한다(성능 시계만 가짜). */
function dragOn(el: HTMLElement, from: number, moves: { y: number; ms: number }[], upAfterMs = 0) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientY: from, isPrimary: true });
  let y = from;
  for (const move of moves) {
    vi.advanceTimersByTime(move.ms);
    y = move.y;
    fireEvent.pointerMove(el, { pointerId: 1, clientY: y, buttons: 1 });
  }
  vi.advanceTimersByTime(upAfterMs);
  fireEvent.pointerUp(el, { pointerId: 1, clientY: y });
}

describe('PlaceSheet', () => {
  it('열리면 시트로 포커스를 옮기고, 시트 안에서 닫으면 연 요소로 돌린다', async () => {
    const sheet = await open({ hideOnClose: true });
    expect(sheet).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.getByRole('button', { name: '연 요소' })).toHaveFocus();
  });

  it('시트 밖을 눌러 치워지면 그 요소의 포커스를 빼앗지 않는다', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: '치우기' }));
    expect(screen.getByRole('button', { name: '치우기' })).toHaveFocus();
  });

  it('펼치기·접기 버튼과 aria-expanded', async () => {
    const onSnapChange = vi.fn();
    await open({ onSnapChange });
    const toggle = screen.getByRole('button', { name: '펼치기' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
    const collapse = screen.getByRole('button', { name: '접기' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(collapse);
    expect(onSnapChange).toHaveBeenLastCalledWith('half');
  });

  it('닫기 버튼과 Esc는 닫는다. 이미 처리된 Esc는 무시한다', async () => {
    const onClose = vi.fn();
    const sheet = await open({ onClose });
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '편집칸' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('반쯤에서 천천히 끌어 내리면 닫는다', async () => {
    const onClose = vi.fn();
    const sheet = await open({ onClose });
    vi.useFakeTimers({ toFake: ['performance'] });
    dragOn(
      sheet,
      500,
      [
        { y: 520, ms: 16 },
        { y: 700, ms: 1000 },
      ],
      200,
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('반쯤에서 끌어 올리면 다 펼치고, 끌기 뒤의 클릭은 삼킨다', async () => {
    const onSnapChange = vi.fn();
    const onInner = vi.fn();
    await open({ onSnapChange, onInner });
    const inner = screen.getByRole('button', { name: '안쪽 단추' });
    vi.useFakeTimers({ toFake: ['performance'] });
    dragOn(
      inner,
      500,
      [
        { y: 480, ms: 16 },
        { y: 200, ms: 1000 },
      ],
      200,
    );
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
    fireEvent.click(inner);
    expect(onInner).not.toHaveBeenCalled();
    vi.useRealTimers();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.click(inner);
    expect(onInner).toHaveBeenCalledTimes(1);
  });

  it('8px보다 적게 움직이면 끌기가 아니다', async () => {
    const onSnapChange = vi.fn();
    const onClose = vi.fn();
    const sheet = await open({ onSnapChange, onClose });
    vi.useFakeTimers({ toFake: ['performance'] });
    dragOn(sheet, 500, [{ y: 505, ms: 16 }]);
    expect(onSnapChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('다 펼침에서는 안쪽을 끌어도 단계가 바뀌지 않는다(안쪽은 스크롤)', async () => {
    const onSnapChange = vi.fn();
    await open({ initial: 'full', onSnapChange });
    vi.useFakeTimers({ toFake: ['performance'] });
    dragOn(
      screen.getByRole('button', { name: '안쪽 단추' }),
      200,
      [
        { y: 220, ms: 16 },
        { y: 700, ms: 1000 },
      ],
      200,
    );
    expect(onSnapChange).not.toHaveBeenCalled();
  });

  it('반쯤일 때 가려진 요소에 포커스가 가면 다 펼친다', async () => {
    const onSnapChange = vi.fn();
    const sheet = await open({ onSnapChange });
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({ top: 400 } as DOMRect);
    const input = screen.getByRole('textbox', { name: '편집칸' });
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ bottom: 900 } as DOMRect);
    const inner = screen.getByRole('button', { name: '안쪽 단추' });
    vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue({ bottom: 600 } as DOMRect);
    act(() => inner.focus());
    expect(onSnapChange).not.toHaveBeenCalled();
    act(() => input.focus());
    expect(onSnapChange).toHaveBeenCalledWith('full');
  });

  it('시트 밖에서 단추를 뗀 뒤 지나가기만 해도 끌기가 되지 않는다', async () => {
    const onSnapChange = vi.fn();
    const onClose = vi.fn();
    const sheet = await open({ onSnapChange, onClose });
    vi.useFakeTimers({ toFake: ['performance'] });
    fireEvent.pointerDown(sheet, { pointerId: 1, button: 0, clientY: 500, isPrimary: true });
    vi.advanceTimersByTime(16);
    fireEvent.pointerMove(sheet, { pointerId: 1, clientY: 700, buttons: 0 });
    expect(sheet.style.transform).not.toContain('700');
    expect(sheet.style.userSelect).not.toBe('none');
    fireEvent.pointerMove(sheet, { pointerId: 1, clientY: 800, buttons: 0 });
    fireEvent.pointerUp(sheet, { pointerId: 1, clientY: 800 });
    expect(onSnapChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('두 번째 손가락은 끌기를 가로채지 못하고, 첫 손가락이 놓으면 단계가 정해진다', async () => {
    const onClose = vi.fn();
    const sheet = await open({ onClose });
    vi.useFakeTimers({ toFake: ['performance'] });
    fireEvent.pointerDown(sheet, { pointerId: 1, button: 0, clientY: 500, isPrimary: true });
    vi.advanceTimersByTime(16);
    fireEvent.pointerMove(sheet, { pointerId: 1, clientY: 520, buttons: 1 });
    vi.advanceTimersByTime(1000);
    fireEvent.pointerMove(sheet, { pointerId: 1, clientY: 700, buttons: 1 });
    fireEvent.pointerDown(sheet, { pointerId: 2, button: 0, clientY: 300, isPrimary: false });
    fireEvent.pointerUp(sheet, { pointerId: 2, clientY: 300 });
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    fireEvent.pointerUp(sheet, { pointerId: 1, clientY: 700 });
    expect(onClose).toHaveBeenCalled();
  });

  it('포털로 올라온 포커스는 시트를 펼치지 않는다', async () => {
    const onSnapChange = vi.fn();
    const sheet = await open({ onSnapChange });
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({ top: 400 } as DOMRect);
    const host = document.createElement('div');
    document.body.appendChild(host);
    function PortalChild() {
      return createPortal(<button type="button">포털 단추</button>, host);
    }
    // 시트 children 안에서 포털을 쓰는 상황을 흉내 낸다.
    cleanup();
    render(
      <PlaceSheet snap="half" onSnapChange={onSnapChange} onClose={vi.fn()}>
        <PortalChild />
      </PlaceSheet>,
    );
    const portalButton = screen.getByRole('button', { name: '포털 단추' });
    vi.spyOn(portalButton, 'getBoundingClientRect').mockReturnValue({ bottom: 900 } as DOMRect);
    act(() => portalButton.focus());
    expect(onSnapChange).not.toHaveBeenCalled();
    host.remove();
  });
});
