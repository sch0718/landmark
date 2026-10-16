import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ruleValue } from '../../components/helpers/rule-style';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { VisitEditor } from 'src/sections/place/VisitEditor';
import { libraryAtom } from 'src/stores/library-state';
import { makePlace, renderLibrary, sampleLibrary, withPlaces } from '../library/fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

// 앱 런타임의 기본 `Clock`은 `Date.now()`를 읽는다. 날짜만 고정하고 나머지 타이머는 진짜로 둔다.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 16, 0, 30)); // 기기 시각 10/16 00:30(한국이면 UTC로는 전날)
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  toastMock.mockClear();
  toastMock.error.mockClear();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

describe('VisitEditor (단독)', () => {
  const setup = (visitedOn: string | null) => {
    const handlers = { onMarkToday: vi.fn(), onSetDate: vi.fn(), onClear: vi.fn() };
    render(<VisitEditor visitedOn={visitedOn} today="2026-10-16" {...handlers} />);
    return handlers;
  };

  it('안 가 봄: 버튼 하나만 보이고 누르면 오늘로 표시를 부탁한다', () => {
    const h = setup(null);
    expect(screen.queryByLabelText('다녀온 날')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: '다녀왔어요' });
    expect(ruleValue(button, 'min-height')).toBe('44px');
    fireEvent.click(button);
    expect(h.onMarkToday).toHaveBeenCalledTimes(1);
  });

  it('다녀옴: 날짜 칸(max=오늘)·취소 버튼, 체크 아이콘은 숨김', () => {
    const h = setup('2026-10-10');
    const input = screen.getByLabelText('다녀온 날');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveValue('2026-10-10');
    expect(input).toHaveAttribute('max', '2026-10-16');
    expect(ruleValue(input, 'min-height')).toBe('44px');
    expect(ruleValue(input, 'font-size')).toBe('16px');
    const cancel = screen.getByRole('button', { name: '다녀옴 취소' });
    expect(ruleValue(cancel, 'min-height')).toBe('44px');
    expect(screen.queryByRole('button', { name: '다녀왔어요' })).not.toBeInTheDocument();
    expect(document.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(cancel);
    expect(h.onClear).toHaveBeenCalledTimes(1);
  });

  it('날짜를 바꾸면 저장을 부탁하고 오늘은 허용한다', () => {
    const h = setup('2026-10-10');
    const input = screen.getByLabelText('다녀온 날');
    fireEvent.change(input, { target: { value: '2026-10-12' } });
    expect(h.onSetDate).toHaveBeenLastCalledWith('2026-10-12');
    fireEvent.change(input, { target: { value: '2026-10-16' } });
    expect(h.onSetDate).toHaveBeenLastCalledWith('2026-10-16');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('칸을 비우면 저장하지 않고 저장된 날짜로 돌아간다', () => {
    const h = setup('2026-10-10');
    const input = screen.getByLabelText('다녀온 날');
    fireEvent.change(input, { target: { value: '' } });
    expect(h.onSetDate).not.toHaveBeenCalled();
    expect(input).toHaveValue('2026-10-10');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('오늘 이후 날짜는 저장하지 않고 안내를 보이며, 다음 올바른 입력에 안내가 사라진다', () => {
    const h = setup('2026-10-10');
    const input = screen.getByLabelText('다녀온 날');
    fireEvent.change(input, { target: { value: '2099-01-01' } });
    expect(h.onSetDate).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('오늘 이후 날짜는 고를 수 없어요');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
    expect(input).toHaveValue('2026-10-10');

    fireEvent.change(input, { target: { value: '2026-10-11' } });
    expect(h.onSetDate).toHaveBeenCalledWith('2026-10-11');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});

const P1 = 'place00001';
const open = (visitedOn?: string | null, review?: string) =>
  renderLibrary(
    withPlaces(sampleLibrary(), [
      makePlace(1, {
        name: '중앙시장 닭강정',
        ...(visitedOn !== undefined ? { visitedOn } : {}),
        ...(review !== undefined ? { review } : {}),
      }),
    ]),
    { path: `/place/${P1}` },
  );
const detail = () => within(screen.getByRole('region', { name: '장소 상세' }));
const stored = (store: Awaited<ReturnType<typeof open>>['store']) =>
  store.get(libraryAtom).places[P1]!;

describe('장소 상세의 다녀옴·한 줄 평', () => {
  it('제목 두 개가 보이고 다녀왔어요가 기기의 오늘로 저장된다', async () => {
    const user = userEvent.setup();
    const { store } = await open();
    expect(detail().getByRole('heading', { level: 2, name: '다녀옴' })).toBeInTheDocument();
    expect(detail().getByRole('heading', { level: 2, name: '한 줄 평' })).toBeInTheDocument();

    await user.click(detail().getByRole('button', { name: '다녀왔어요' }));
    await waitFor(() => expect(stored(store).visitedOn?.value).toBe('2026-10-16'));
    const input = await detail().findByLabelText('다녀온 날');
    expect(input).toHaveValue('2026-10-16');
    expect(input).toHaveAttribute('max', '2026-10-16');
  });

  it('날짜 바꾸기: 저장 / 비움 무시 / 미래 거절', async () => {
    const { store } = await open('2026-10-05');
    const input = await detail().findByLabelText('다녀온 날');

    fireEvent.change(input, { target: { value: '2026-10-10' } });
    await waitFor(() => expect(stored(store).visitedOn?.value).toBe('2026-10-10'));

    fireEvent.change(input, { target: { value: '' } });
    await act(async () => {});
    expect(stored(store).visitedOn?.value).toBe('2026-10-10');
    expect(input).toHaveValue('2026-10-10');

    fireEvent.change(input, { target: { value: '2099-01-01' } });
    await act(async () => {});
    expect(stored(store).visitedOn?.value).toBe('2026-10-10');
    expect(await detail().findByRole('alert')).toHaveTextContent('오늘 이후 날짜는 고를 수 없어요');
  });

  it('다녀옴 취소는 표시를 지우고 토스트의 되돌리기가 날짜를 되살린다', async () => {
    const user = userEvent.setup();
    const { store } = await open('2026-10-10', '일출 최고');
    await user.click(await detail().findByRole('button', { name: '다녀옴 취소' }));
    await waitFor(() => expect(stored(store).visitedOn?.value).toBeNull());
    expect(await detail().findByRole('button', { name: '다녀왔어요' })).toBeInTheDocument();
    // 평은 그대로.
    expect(stored(store).review?.value).toBe('일출 최고');

    expect(toastMock).toHaveBeenCalledTimes(1);
    const [message, options] = toastMock.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe('다녀옴 표시를 지웠어요');
    expect(options.duration).toBe(5000);
    expect(options.action.label).toBe('되돌리기');

    await act(async () => {
      options.action.onClick();
    });
    await waitFor(() => expect(stored(store).visitedOn?.value).toBe('2026-10-10'));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('그사이 다시 다녀옴으로 표시했다면 되돌리기는 덮어쓰지 않는다', async () => {
    const user = userEvent.setup();
    const { store } = await open('2026-10-10');
    await user.click(await detail().findByRole('button', { name: '다녀옴 취소' }));
    await waitFor(() => expect(stored(store).visitedOn?.value).toBeNull());
    await user.click(await detail().findByRole('button', { name: '다녀왔어요' }));
    await waitFor(() => expect(stored(store).visitedOn?.value).toBe('2026-10-16'));

    const [, options] = toastMock.mock.calls[0] as [string, { action: { onClick: () => void } }];
    await act(async () => {
      options.action.onClick();
    });
    expect(stored(store).visitedOn?.value).toBe('2026-10-16');
  });

  it('한 줄 평: 입력칸은 140자 제한, 공백을 다듬어 저장하고 비우면 지운다', async () => {
    const user = userEvent.setup();
    const { store } = await open();
    expect(detail().getByRole('button', { name: '한 줄 평 수정' })).toHaveTextContent(
      '한 줄 평 남기기 (140자까지)',
    );

    await user.click(detail().getByRole('button', { name: '한 줄 평 수정' }));
    const box = detail().getByRole('textbox', { name: '한 줄 평' });
    expect(box).toHaveAttribute('maxLength', '140');
    await user.type(box, '  일출 최고  {Enter}');
    await waitFor(() => expect(stored(store).review?.value).toBe('일출 최고'));
    expect(detail().getByRole('button', { name: '한 줄 평 수정' })).toHaveTextContent('일출 최고');

    await user.click(detail().getByRole('button', { name: '한 줄 평 수정' }));
    await user.clear(detail().getByRole('textbox', { name: '한 줄 평' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(stored(store).review?.value).toBe(''));
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
