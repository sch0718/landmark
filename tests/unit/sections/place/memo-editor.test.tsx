import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ruleValue } from '../../components/helpers/rule-style';
import { MemoEditor } from 'src/sections/place/MemoEditor';

type Result = { ok: boolean };

const deferred = () => {
  let resolve: (r: Result) => void = () => {};
  const promise = new Promise<Result>((r) => (resolve = r));
  return { promise, resolve };
};

const textarea = () => screen.getByRole('textbox', { name: '메모' });
const type = (text: string) => fireEvent.change(textarea(), { target: { value: text } });

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setVisibility('visible');
});

describe('MemoEditor', () => {
  it('memo saves 600ms after typing stops and shows 저장됨 only after success', async () => {
    const save = deferred();
    const onSave = vi.fn(() => save.promise);
    render(<MemoEditor placeId="p1" saved="" onSave={onSave} />);

    type('안');
    act(() => void vi.advanceTimersByTime(500));
    type('안녕'); // 타이머를 다시 시작한다.
    act(() => void vi.advanceTimersByTime(599));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByText('저장됨')).not.toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(1));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('안녕');
    expect(screen.getByText('저장 중…')).toBeInTheDocument();
    expect(screen.queryByText('저장됨')).not.toBeInTheDocument();

    await act(async () => save.resolve({ ok: true }));
    expect(screen.getByText('저장됨')).toBeInTheDocument();
    expect(screen.queryByText('저장 중…')).not.toBeInTheDocument();
  });

  it('flushes draft on unmount and visibilitychange', () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const { unmount } = render(<MemoEditor placeId="p1" saved="" onSave={onSave} />);

    type('숨기기 전');
    expect(onSave).not.toHaveBeenCalled();
    act(() => setVisibility('hidden'));
    expect(onSave).toHaveBeenCalledWith('숨기기 전');
    act(() => setVisibility('visible'));

    onSave.mockClear();
    type('닫기 전');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(onSave).toHaveBeenCalledWith('닫기 전');

    onSave.mockClear();
    type('떠나기 전');
    unmount(); // 600ms를 기다리지 않는다.
    expect(onSave).toHaveBeenCalledWith('떠나기 전');
  });

  it('does not save when nothing was typed', () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const { unmount } = render(<MemoEditor placeId="p1" saved="원래 메모" onSave={onSave} />);
    act(() => void vi.advanceTimersByTime(2000));
    act(() => setVisibility('hidden'));
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('failed save keeps draft and shows retry', async () => {
    const onSave = vi.fn<(text: string) => Promise<Result>>(async () => ({ ok: false }));
    render(<MemoEditor placeId="p1" saved="" onSave={onSave} />);
    type('잃으면 안 되는 글');
    await act(async () => void vi.advanceTimersByTime(600));

    expect(textarea()).toHaveValue('잃으면 안 되는 글');
    expect(screen.queryByText('저장됨')).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: '저장하지 못했어요 · 다시 시도' });

    onSave.mockImplementation(async () => ({ ok: true }));
    await act(async () => fireEvent.click(retry));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith('잃으면 안 되는 글');
    expect(screen.getByText('저장됨')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /다시 시도/ })).not.toBeInTheDocument();
  });

  it('remote change while dirty keeps draft and shows notice', () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const { rerender } = render(<MemoEditor placeId="p1" saved="처음" onSave={onSave} />);
    expect(screen.queryByText('다른 탭에서 바뀌었어요')).not.toBeInTheDocument();

    type('내가 쓰는 중');
    rerender(<MemoEditor placeId="p1" saved="다른 탭이 쓴 글" onSave={onSave} />);
    expect(textarea()).toHaveValue('내가 쓰는 중');
    expect(screen.getByText('다른 탭에서 바뀌었어요')).toBeInTheDocument();
  });

  it('follows the saved memo while not dirty', () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const { rerender } = render(<MemoEditor placeId="p1" saved="처음" onSave={onSave} />);
    rerender(<MemoEditor placeId="p1" saved="다른 탭이 쓴 글" onSave={onSave} />);
    expect(textarea()).toHaveValue('다른 탭이 쓴 글');
    expect(screen.queryByText('다른 탭에서 바뀌었어요')).not.toBeInTheDocument();
  });

  it('shows the remaining count only past 9,000 characters and warns when a paste is cut', () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    render(<MemoEditor placeId="p1" saved="" onSave={onSave} />);
    expect(textarea()).toHaveAttribute('maxlength', '10000');

    type('가'.repeat(9000));
    expect(screen.queryByText(/자 남음/)).not.toBeInTheDocument();
    type('가'.repeat(9001));
    expect(screen.getByText('999자 남음')).toBeInTheDocument();
    type('가'.repeat(10000));
    expect(screen.getByText('0자 남음')).toBeInTheDocument();

    // 이미 가득 찬 상자에 붙여넣으면 브라우저가 전부 버려 `input`이 오지 않는다.
    fireEvent.paste(textarea(), { clipboardData: { getData: () => '나'.repeat(5) } });
    expect(screen.getByRole('alert')).toHaveTextContent('10,000자를 넘는 부분은 들어가지 않았어요');
    act(() => void vi.advanceTimersByTime(0));
    type('가'.repeat(9999)); // 다음 입력에서 안내를 지운다.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the paste warning through the input event the paste itself triggers', () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    render(<MemoEditor placeId="p1" saved="" onSave={onSave} />);
    type('가'.repeat(9990));

    // 브라우저 순서: paste -> (10,000자로 잘려 삽입) -> input
    fireEvent.paste(textarea(), { clipboardData: { getData: () => '나'.repeat(20) } });
    type('가'.repeat(9990) + '나'.repeat(10));
    expect(textarea()).toHaveValue('가'.repeat(9990) + '나'.repeat(10));
    expect(screen.getByRole('alert')).toHaveTextContent('10,000자를 넘는 부분은 들어가지 않았어요');

    act(() => void vi.advanceTimersByTime(0));
    type('가'.repeat(9000)); // 다음 일반 입력이 경고를 지운다.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends the same text once when hidden, pagehide and unmount arrive together', async () => {
    const save = deferred();
    const onSave = vi.fn(() => save.promise);
    const { unmount } = render(<MemoEditor placeId="p1" saved="" onSave={onSave} />);
    type('탭 닫는 중');
    act(() => setVisibility('hidden'));
    act(() => void window.dispatchEvent(new Event('pagehide')));
    unmount();
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => save.resolve({ ok: true }));
  });

  it('sends again when the text changed or the earlier save failed', async () => {
    const first = deferred();
    const onSave = vi.fn<(text: string) => Promise<Result>>(() => first.promise);
    render(<MemoEditor placeId="p1" saved="" onSave={onSave} />);
    type('하나');
    act(() => setVisibility('hidden'));
    type('하나 둘'); // 저장 중에 더 고쳤다.
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(onSave.mock.calls.map(([text]) => text)).toEqual(['하나', '하나 둘']);

    await act(async () => first.resolve({ ok: false }));
  });

  it('메모 칸은 16px이고 최소 높이 132px을 지킨다', () => {
    render(
      <MemoEditor placeId="p1" saved="" onSave={vi.fn(() => Promise.resolve({ ok: true }))} />,
    );
    expect(ruleValue(textarea(), 'font-size')).toBe('16px');
    expect(ruleValue(textarea(), 'min-height')).toBe('132px');
  });
});
