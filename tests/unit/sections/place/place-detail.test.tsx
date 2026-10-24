import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import type { Library } from 'src/schema/library';
import { LIBRARY_KEY } from 'src/services/library-store';
import { libraryAtom } from 'src/stores/library-state';
import { attachedNames, openLabelPicker, pickerSearch } from '../../helpers/label-picker';
import { L_FOOD, makePlace, renderLibrary, sampleLibrary, withPlaces } from '../library/fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  toastMock.mockClear();
  toastMock.error.mockClear();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const P1 = 'place00001'; // 중앙시장 닭강정 (맛집)
const P2 = 'place00002'; // 안목 카페거리 (카페)
const open = (id: string, options: { width?: number; ids?: string[] } = {}) =>
  renderLibrary(sampleLibrary(), { path: `/place/${id}`, ...options });
const detail = () => screen.getByRole('region', { name: '장소 상세' });
const storedPlace = (storage: Storage, id: string) =>
  (JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library).places[id]!;
const memoBox = () => within(detail()).getByRole('textbox', { name: '메모' });

describe('PlaceDetail', () => {
  it('shows name, address, category and the naver link for a naver place', async () => {
    await open(P1);
    const d = within(detail());
    expect(d.getByRole('button', { name: '이름 수정' })).toHaveTextContent('중앙시장 닭강정');
    expect(d.getByText('강원특별자치도 강릉시 난설헌로 131')).toBeInTheDocument();
    expect(d.getByRole('button', { name: '분류 수정' })).toHaveTextContent('분류 추가');
    const link = d.getByRole('link', { name: '네이버 지도에서 열기' });
    expect(link).toHaveAttribute('href', 'https://m.place.naver.com/place/1001');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    // 반쯤 시트를 마우스로 끌 때 링크 끌기(브라우저 기본 동작)가 시트 끌기를 끊지 않게 한다.
    expect(link).toHaveAttribute('draggable', 'false');
  });

  it('naver link only for naver source', async () => {
    const pin = { ...makePlace(7, { name: '내가 찍은 곳' }), source: { kind: 'pin' as const } };
    await renderLibrary(withPlaces(sampleLibrary(), [pin]), { path: `/place/${pin.id}` });
    expect(within(detail()).getByRole('button', { name: '이름 수정' })).toHaveTextContent(
      '내가 찍은 곳',
    );
    expect(
      within(detail()).queryByRole('link', { name: '네이버 지도에서 열기' }),
    ).not.toBeInTheDocument();
    expect(within(detail()).getByRole('link', { name: '도움말' })).toHaveAttribute(
      'href',
      '/help/place',
    );
  });

  it('edits the name and the category', async () => {
    const user = userEvent.setup();
    const { storage, store } = await open(P1);
    await user.click(within(detail()).getByRole('button', { name: '이름 수정' }));
    const name = within(detail()).getByRole('textbox', { name: '이름' });
    await user.clear(name);
    await user.type(name, '  새 이름{Enter}');
    await waitFor(() => expect(store.get(libraryAtom).places[P1]!.name.value).toBe('새 이름'));
    expect(storedPlace(storage, P1).name.value).toBe('새 이름');
    expect(within(detail()).getByRole('button', { name: '이름 수정' })).toHaveTextContent(
      '새 이름',
    );

    await user.click(within(detail()).getByRole('button', { name: '분류 수정' }));
    await user.type(within(detail()).getByRole('textbox', { name: '분류' }), '시장{Enter}');
    await waitFor(() => expect(store.get(libraryAtom).places[P1]!.category.value).toBe('시장'));

    // 분류를 비우면 미분류(null)가 된다.
    await user.click(within(detail()).getByRole('button', { name: '분류 수정' }));
    await user.clear(within(detail()).getByRole('textbox', { name: '분류' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(store.get(libraryAtom).places[P1]!.category.value).toBeNull());
  });

  it('saves the one-line review trimmed and stores it', async () => {
    const user = userEvent.setup();
    const { store, storage } = await open(P1);
    await user.click(within(detail()).getByRole('button', { name: '한 줄 평 수정' }));
    const box = within(detail()).getByRole('textbox', { name: '한 줄 평' });
    expect(box).toHaveAttribute('maxLength', '140');
    await user.type(box, '  일출 최고  {Enter}');
    await waitFor(() => expect(store.get(libraryAtom).places[P1]!.review?.value).toBe('일출 최고'));
    expect(storedPlace(storage, P1).review?.value).toBe('일출 최고');
  });

  it('keeps the name when the edit is cancelled or emptied', async () => {
    const user = userEvent.setup();
    const { store } = await open(P1);
    await user.click(within(detail()).getByRole('button', { name: '이름 수정' }));
    await user.type(within(detail()).getByRole('textbox', { name: '이름' }), '지울 글{Escape}');
    expect(within(detail()).getByRole('button', { name: '이름 수정' })).toHaveTextContent(
      '중앙시장 닭강정',
    );

    await user.click(within(detail()).getByRole('button', { name: '이름 수정' }));
    await user.clear(within(detail()).getByRole('textbox', { name: '이름' }));
    await user.keyboard('{Enter}');
    expect(within(detail()).getByRole('button', { name: '이름 수정' })).toHaveTextContent(
      '중앙시장 닭강정',
    );
    expect(store.get(libraryAtom).places[P1]!.name.value).toBe('중앙시장 닭강정');
  });

  it('라벨 바꾸기 창에서 켜고 끄고, Enter로 새 라벨을 만든다. 잘못된 이름은 알린다', async () => {
    const user = userEvent.setup();
    const { store } = await open(P1, { ids: ['newlabel'] });
    expect(attachedNames(detail())).toEqual(['맛집']);
    const dialog = await openLabelPicker(user, detail());
    const food = within(dialog).getByRole('checkbox', { name: /^맛집/ });
    const cafe = within(dialog).getByRole('checkbox', { name: /^카페/ });
    expect(food).toBeChecked();
    expect(cafe).not.toBeChecked();

    await user.click(cafe);
    await waitFor(() => expect(cafe).toBeChecked());
    expect(store.get(libraryAtom).places[P1]!.labelIds.value).toEqual([L_FOOD, 'label002']);
    await user.click(food);
    await waitFor(() => expect(food).not.toBeChecked());
    expect(store.get(libraryAtom).places[P1]!.labelIds.value).toEqual(['label002']);

    const input = pickerSearch(dialog);
    await user.type(input, '   {Enter}');
    expect(await within(dialog).findByText('1–30자로 입력하세요')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.clear(input);
    await user.type(input, '가'.repeat(31));
    await user.keyboard('{Enter}');
    expect(await within(dialog).findByText('1–30자로 입력하세요')).toBeInTheDocument();
    expect(Object.keys(store.get(libraryAtom).labels)).toHaveLength(3);
    expect(toastMock.error).not.toHaveBeenCalled();

    await user.clear(input);
    expect(within(dialog).queryByText('1–30자로 입력하세요')).not.toBeInTheDocument();
    await user.type(input, '야시장{Enter}');
    const created = await within(dialog).findByRole('checkbox', { name: /^야시장/ });
    expect(created).toBeChecked();
    expect(input).toHaveValue('');
    const lib = store.get(libraryAtom);
    expect(lib.labels.newlabel!.name.value).toBe('야시장');
    expect(lib.places[P1]!.labelIds.value).toEqual(['label002', 'newlabel']);

    await user.click(within(dialog).getByRole('button', { name: '완료' }));
    await waitFor(() => expect(attachedNames(detail())).toEqual(['카페', '야시장']));
  });

  it('휴대폰 시트에서 라벨 바꾸기 창의 Esc는 창만 닫고 시트는 남기며 포커스를 라벨 바꾸기로 돌린다', async () => {
    const user = userEvent.setup();
    const { router } = await open(P1, { width: 390 });
    const sheet = detail();
    expect(within(sheet).getByRole('button', { name: '닫기' })).toBeInTheDocument();
    const dialog = await openLabelPicker(user, sheet);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(`/place/${P1}`);
    expect(detail()).toBe(sheet);
    expect(within(sheet).getByRole('button', { name: '라벨 바꾸기' })).toHaveFocus();
  });

  it('ignores Enter that only confirms a Korean composition', async () => {
    const user = userEvent.setup();
    const { store } = await open(P1, { ids: ['newlabel'] });
    const input = pickerSearch(await openLabelPicker(user, detail()));
    fireEvent.change(input, { target: { value: '야시' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    await act(async () => {});
    expect(Object.keys(store.get(libraryAtom).labels)).toHaveLength(3);
    expect(input).toHaveValue('야시');

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(Object.keys(store.get(libraryAtom).labels)).toHaveLength(4));
  });

  it('delete navigates back and undo restores', async () => {
    const user = userEvent.setup();
    const { store, router } = await open(P1);
    expect(router.state.location.pathname).toBe(`/place/${P1}`);

    await user.click(within(detail()).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(store.get(libraryAtom).places[P1]!.deletedAt).not.toBeNull());
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    // 뒤로 가기가 지운 장소를 다시 열지 않는다(기록을 교체했다).
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await within(detail()).findByText('장소를 고르면 여기에 보여요')).toBeInTheDocument();

    expect(toastMock).toHaveBeenCalledTimes(1);
    const [message, options] = toastMock.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe('장소를 지웠어요');
    expect(options.duration).toBe(5000);
    expect(options.action.label).toBe('되돌리기');

    await act(async () => {
      options.action.onClick();
    });
    await waitFor(() => expect(store.get(libraryAtom).places[P1]!.deletedAt).toBeNull());
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('undo after delete does not revive a place another tab had already deleted', async () => {
    const user = userEvent.setup();
    const { store, storage, router } = await open(P1);
    const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
    const gone = { ...stored.places[P1]!, deletedAt: '2026-10-08T02:00:00.000Z' };
    storage.setItem(
      LIBRARY_KEY,
      JSON.stringify({ ...stored, places: { ...stored.places, [P1]: gone } }),
    );

    await user.click(within(detail()).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(store.get(libraryAtom).places[P1]!.deletedAt).not.toBeNull());
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(store.get(libraryAtom).places[P1]!.deletedAt).toBe('2026-10-08T02:00:00.000Z');
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('unknown or deleted id shows not-found', async () => {
    const user = userEvent.setup();
    const { router } = await open('zzz');
    expect(within(detail()).getByText('장소를 찾을 수 없어요')).toBeInTheDocument();
    await user.click(within(detail()).getByRole('button', { name: '보관함으로 돌아가기' }));
    expect(router.state.location.pathname).toBe('/');
    cleanup();

    const deleted = makePlace(8, { name: '지운 곳', deletedAt: '2026-10-08T02:00:00.000Z' });
    await renderLibrary(withPlaces(sampleLibrary(), [deleted]), { path: `/place/${deleted.id}` });
    expect(within(detail()).getByText('장소를 찾을 수 없어요')).toBeInTheDocument();
    expect(within(detail()).queryByRole('textbox', { name: '메모' })).not.toBeInTheDocument();
  });

  it('autosaves the memo 600ms after typing and shows 저장됨 afterwards', async () => {
    const { storage, store } = await open(P1);
    fireEvent.change(memoBox(), { target: { value: '웨이팅 길다' } });
    expect(storedPlace(storage, P1).memo.value).toBe(''); // 아직 디바운스 중
    await waitFor(() => expect(store.get(libraryAtom).places[P1]!.memo.value).toBe('웨이팅 길다'), {
      timeout: 3000,
    });
    expect(storedPlace(storage, P1).memo.value).toBe('웨이팅 길다');
    expect(await within(detail()).findByText('저장됨')).toBeInTheDocument();
  });

  it('flushes the draft when the place changes without waiting for the debounce', async () => {
    const { storage, router } = await open(P1);
    fireEvent.change(memoBox(), { target: { value: '떠나기 전에 쓴 메모' } });
    expect(storedPlace(storage, P1).memo.value).toBe('');

    await act(async () => {
      await router.navigate(`/place/${P2}`);
    });
    await waitFor(() => expect(storedPlace(storage, P1).memo.value).toBe('떠나기 전에 쓴 메모'));
    // 다음 장소의 메모칸에 이전 글이 따라오지 않는다.
    expect(memoBox()).toHaveValue('');
    expect(storedPlace(storage, P2).memo.value).toBe('');
  });

  it('keeps the memo draft when the window crosses 1280px', async () => {
    const { storage, setWidth } = await open(P1);
    const box = memoBox();
    fireEvent.change(box, { target: { value: '쓰는 중' } });
    setWidth(1279);
    expect(memoBox()).toBe(box);
    expect(box).toHaveValue('쓰는 중');
    await waitFor(() => expect(storedPlace(storage, P1).memo.value).toBe('쓰는 중'), {
      timeout: 3000,
    });
  });

  describe('a memo whose save failed', () => {
    const RETRY = '저장하지 못했어요 · 다시 시도';
    /** 서비스가 `full`일 때 보관함 키 쓰기만 용량 초과로 실패하는 저장소. */
    function fullableStorage() {
      const storage = createMemoryStorage();
      const state = { full: false };
      const setItem = storage.setItem.bind(storage);
      storage.setItem = (key: string, value: string) => {
        if (state.full && key === LIBRARY_KEY) throw new DOMException('', 'QuotaExceededError');
        setItem(key, value);
      };
      return { storage, state };
    }
    const retry = () => within(detail()).getByRole('button', { name: RETRY });

    it('is kept and can be retried after navigating to another place and back', async () => {
      const user = userEvent.setup();
      const { storage, state } = fullableStorage();
      const { router } = await renderLibrary(sampleLibrary(), { path: `/place/${P1}`, storage });
      state.full = true;
      fireEvent.change(memoBox(), { target: { value: '잃으면 안 되는 메모' } });

      await act(async () => {
        await router.navigate(`/place/${P2}`);
      });
      await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
      expect(memoBox()).toHaveValue('');

      await act(async () => {
        await router.navigate(`/place/${P1}`);
      });
      expect(memoBox()).toHaveValue('잃으면 안 되는 메모');
      expect(await within(detail()).findByRole('button', { name: RETRY })).toBeInTheDocument();
      expect(storedPlace(storage, P1).memo.value).toBe('');

      state.full = false;
      await user.click(retry());
      await waitFor(() => expect(storedPlace(storage, P1).memo.value).toBe('잃으면 안 되는 메모'));
      expect(await within(detail()).findByText('저장됨')).toBeInTheDocument();
      expect(within(detail()).queryByRole('button', { name: RETRY })).not.toBeInTheDocument();
    });

    it('is kept when the detail remounts on a compact to wide resize', async () => {
      const { storage, state } = fullableStorage();
      const { setWidth } = await renderLibrary(sampleLibrary(), {
        path: `/place/${P1}`,
        width: 390,
        storage,
      });
      state.full = true;
      fireEvent.change(memoBox(), { target: { value: '리사이즈 전에 쓴 메모' } });
      expect(
        await within(detail()).findByRole('button', { name: RETRY }, { timeout: 3000 }),
      ).toBeInTheDocument();

      setWidth(1400);
      expect(memoBox()).toHaveValue('리사이즈 전에 쓴 메모');
      expect(await within(detail()).findByRole('button', { name: RETRY })).toBeInTheDocument();
    });

    it('still tells that another tab changed the memo while the draft was away', async () => {
      const { storage, state } = fullableStorage();
      const { router, store } = await renderLibrary(sampleLibrary(), {
        path: `/place/${P1}`,
        storage,
      });
      state.full = true;
      fireEvent.change(memoBox(), { target: { value: '내가 쓴 초안' } });
      await act(async () => {
        await router.navigate(`/place/${P2}`);
      });
      await waitFor(() => expect(toastMock.error).toHaveBeenCalled());

      // 다른 탭이 그 사이 P1의 메모를 고쳤다.
      state.full = false;
      const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
      const edited: Library = {
        ...stored,
        places: {
          ...stored.places,
          [P1]: {
            ...stored.places[P1]!,
            memo: { value: '다른 탭이 쓴 메모', updatedAt: '2026-10-08T03:00:00.000Z' },
          },
        },
      };
      storage.setItem(LIBRARY_KEY, JSON.stringify(edited));
      act(() => store.set(libraryAtom, edited));

      await act(async () => {
        await router.navigate(`/place/${P1}`);
      });
      expect(memoBox()).toHaveValue('내가 쓴 초안');
      expect(within(detail()).getByText('다른 탭에서 바뀌었어요')).toBeInTheDocument();
      expect(retry()).toBeInTheDocument();
    });

    it('is dropped once a save of that exact text succeeds', async () => {
      const { router, storage } = await open(P1);
      fireEvent.change(memoBox(), { target: { value: '저장되는 메모' } });
      await act(async () => {
        await router.navigate(`/place/${P2}`);
      });
      await waitFor(() => expect(storedPlace(storage, P1).memo.value).toBe('저장되는 메모'));
      await act(async () => {
        await router.navigate(`/place/${P1}`);
      });
      expect(memoBox()).toHaveValue('저장되는 메모');
      expect(within(detail()).queryByRole('button', { name: RETRY })).not.toBeInTheDocument();
    });
  });
});
