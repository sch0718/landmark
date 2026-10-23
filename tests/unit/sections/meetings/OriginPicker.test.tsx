import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateParticipant } from 'src/domain/meeting/ops';
import { LibrarySchema } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { buildMeeting } from '../../../fixtures/builders';
import { OriginPicker } from 'src/sections/meetings/OriginPicker';
import { libraryAtom } from 'src/stores/library-state';
import { sampleLibrary } from '../library/fixtures';

const search = vi.hoisted(() => vi.fn());
vi.mock('src/lib/effect/runtime', async (original) => ({
  ...(await original<typeof import('src/lib/effect/runtime')>()),
  startEffect: () => search(),
}));
vi.mock('src/components/map/MapView', () => ({
  MapView: ({
    onCenterChange,
    onReadyChange,
    onUnavailable,
  }: {
    onCenterChange(center: [number, number]): void;
    onReadyChange(ready: boolean): void;
    onUnavailable(reason: string): void;
  }) => (
    <div data-testid="picker-map">
      <button
        onClick={() => {
          onReadyChange(true);
          onCenterChange([127, 37.5]);
        }}
      >
        지도 중심 변경
      </button>
      <button
        onClick={() => {
          onReadyChange(true);
          onCenterChange([140, 30]);
        }}
      >
        범위 밖 중심
      </button>
      <button onClick={() => onUnavailable('지도 키가 없어요')}>지도 실패</button>
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  search.mockReset();
});
function setup() {
  const store = createStore();
  store.set(libraryAtom, sampleLibrary());
  const onPick = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <Provider store={store}>
      <OriginPicker open onPick={onPick} onClose={onClose} />
    </Provider>,
  );
  return { ...view, onPick, onClose, store };
}
const result = (name: string, lng = 127) => ({
  name,
  address: '서울 강남구',
  category: '역',
  lng,
  lat: 37.5,
});
describe('출발지 고르기', () => {
  it('보관함의 살아 있는 장소를 이름으로 찾아 placeId까지 고른다', () => {
    const { onPick } = setup();
    fireEvent.click(screen.getByRole('tab', { name: '보관함에서' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '보관함 장소 검색' }), {
      target: { value: '강남' },
    });
    fireEvent.click(screen.getByRole('button', { name: /강남 한 곳/ }));
    expect(onPick).toHaveBeenCalledWith({
      name: '강남 한 곳',
      lng: 128.95,
      lat: 37.77,
      placeId: 'place00004',
    });
  });
  it('300ms 뒤 검색하고 결과 이름과 주소·분류를 보인다', async () => {
    vi.useFakeTimers();
    search.mockResolvedValue([result('강남역')]);
    const { onPick } = setup();
    fireEvent.change(screen.getByRole('searchbox', { name: '출발지 검색' }), {
      target: { value: '강남' },
    });
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(search).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    const row = screen.getByRole('button', { name: /강남역 서울 강남구 역/ });
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith({ name: '강남역', lng: 127, lat: 37.5 });
  });
  it('바뀐 검색어의 응답이 먼저 오면 이전 응답은 버린다', async () => {
    vi.useFakeTimers();
    let old!: (value: ReturnType<typeof result>[]) => void;
    search
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            old = resolve;
          }),
      )
      .mockResolvedValueOnce([result('서울역')]);
    setup();
    const input = screen.getByRole('searchbox', { name: '출발지 검색' });
    fireEvent.change(input, { target: { value: '강남' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.change(input, { target: { value: '서울' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    await act(async () => {
      old([result('강남역')]);
    });
    expect(screen.queryByText('강남역')).not.toBeInTheDocument();
    expect(screen.getByText('서울역')).toBeInTheDocument();
  });
  it('닫고 다시 연 뒤 도착한 응답은 되살리지 않는다', async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof result>[]) => void;
    search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender, onPick, onClose, store } = setup();
    fireEvent.change(screen.getByRole('searchbox', { name: '출발지 검색' }), {
      target: { value: '강남' },
    });
    await act(() => vi.advanceTimersByTimeAsync(300));
    rerender(
      <Provider store={store}>
        <OriginPicker open={false} onPick={onPick} onClose={onClose} />
      </Provider>,
    );
    rerender(
      <Provider store={store}>
        <OriginPicker open onPick={onPick} onClose={onClose} />
      </Provider>,
    );
    await act(async () => finish([result('늦은 장소')]));
    expect(screen.queryByText('늦은 장소')).not.toBeInTheDocument();
  });
  it('검색 실패와 한국 범위 밖 좌표를 안전하게 처리한다', async () => {
    vi.useFakeTimers();
    search
      .mockRejectedValueOnce({ code: 'UPSTREAM_ERROR' })
      .mockResolvedValueOnce([result('해외', 140)]);
    setup();
    const input = screen.getByRole('searchbox', { name: '출발지 검색' });
    fireEvent.change(input, { target: { value: '오류' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByRole('alert')).toHaveTextContent(
      '검색이 안 돼요 — 지도 핀이나 보관함 장소를 써 주세요',
    );
    fireEvent.change(input, { target: { value: '해외' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.queryByRole('button', { name: /해외/ })).not.toBeInTheDocument();
  });
  it('지도에서 고른 곳의 이름을 바꾸고 중심 좌표를 저장한다', () => {
    const { onPick } = setup();
    fireEvent.click(screen.getByRole('tab', { name: '지도에서 고르기' }));
    expect(screen.getByRole('button', { name: '여기로 정하기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '지도 중심 변경' }));
    fireEvent.change(screen.getByRole('textbox', { name: '출발지 이름' }), {
      target: { value: '우리 집' },
    });
    fireEvent.click(screen.getByRole('button', { name: '여기로 정하기' }));
    expect(onPick).toHaveBeenCalledWith({ name: '우리 집', lng: 127, lat: 37.5 });
  });
  it('지도 좌표가 범위 밖이면 선택을 막고 지도 없이도 보관함을 쓴다', () => {
    const { onPick } = setup();
    fireEvent.click(screen.getByRole('tab', { name: '지도에서 고르기' }));
    fireEvent.click(screen.getByRole('button', { name: '범위 밖 중심' }));
    expect(screen.getByRole('button', { name: '여기로 정하기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '지도 실패' }));
    fireEvent.click(screen.getByRole('tab', { name: '보관함에서' }));
    fireEvent.click(
      within(screen.getByRole('tabpanel')).getByRole('button', { name: /강남 한 곳/ }),
    );
    expect(onPick).toHaveBeenCalledOnce();
  });
  it('Esc를 누르면 창을 닫는다', () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

it('열거나 탭을 바꾸면 검색·보관함 검색 상자로 포커스를 옮긴다', async () => {
  const { rerender, store, onPick, onClose } = setup();
  await waitFor(() => expect(screen.getByRole('searchbox', { name: '출발지 검색' })).toHaveFocus());
  fireEvent.click(screen.getByRole('tab', { name: '보관함에서' }));
  expect(screen.getByRole('searchbox', { name: '보관함 장소 검색' })).toHaveFocus();
  fireEvent.click(screen.getByRole('tab', { name: '검색' }));
  expect(screen.getByRole('searchbox', { name: '출발지 검색' })).toHaveFocus();
  rerender(
    <Provider store={store}>
      <OriginPicker open={false} onPick={onPick} onClose={onClose} />
    </Provider>,
  );
  rerender(
    <Provider store={store}>
      <OriginPicker open onPick={onPick} onClose={onClose} />
    </Provider>,
  );
  await waitFor(() => expect(screen.getByRole('searchbox', { name: '출발지 검색' })).toHaveFocus());
});

it('탭과 결과 높이가 바뀌어도 창은 위쪽에 고정하고 지도 탭 이름은 짧게 보인다', async () => {
  vi.useFakeTimers();
  search.mockResolvedValue(Array.from({ length: 10 }, (_, i) => result(`장소 ${i}`)));
  setup();
  const container = screen.getByRole('dialog').parentElement!;
  expect(getComputedStyle(container).alignItems).toBe('flex-start');
  const mapTab = screen.getByRole('tab', { name: '지도에서 고르기' });
  expect(mapTab).toHaveTextContent(/^지도에서$/);
  fireEvent.click(mapTab);
  expect(getComputedStyle(container).alignItems).toBe('flex-start');
  fireEvent.click(screen.getByRole('tab', { name: '검색' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '출발지 검색' }), {
    target: { value: '장소' },
  });
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(screen.getAllByRole('button', { name: /^장소 / })).toHaveLength(10);
  expect(getComputedStyle(container).alignItems).toBe('flex-start');
});

const longName = '가'.repeat(61);
const fittedName = '가'.repeat(59) + '…';

it.each(['검색', '보관함에서', '지도에서 고르기'])(
  '%s에서 긴 이름을 골라도 출발지를 저장한다',
  async (method) => {
    vi.useFakeTimers();
    search.mockResolvedValue([result(longName)]);
    const { onPick, store } = setup();
    const library = store.get(libraryAtom);
    const place = library.places.place00004!;
    act(() =>
      store.set(libraryAtom, {
        ...library,
        places: {
          ...library.places,
          [place.id]: { ...place, name: { ...place.name, value: longName } },
        },
      }),
    );
    fireEvent.click(screen.getByRole('tab', { name: method }));
    if (method === '검색') {
      fireEvent.change(screen.getByRole('searchbox', { name: '출발지 검색' }), {
        target: { value: '장소' },
      });
      await act(() => vi.advanceTimersByTimeAsync(300));
    } else if (method === '지도에서 고르기') {
      fireEvent.click(screen.getByRole('button', { name: '지도 중심 변경' }));
      fireEvent.change(screen.getByRole('textbox', { name: '출발지 이름' }), {
        target: { value: longName },
      });
    }
    fireEvent.click(
      screen.getByRole('button', {
        name: method === '지도에서 고르기' ? '여기로 정하기' : new RegExp(longName),
      }),
    );
    expect(onPick).toHaveBeenCalledOnce();
    const origin = onPick.mock.calls[0]![0];
    expect(origin.name).toBe(fittedName);
    expect(origin.name.length).toBeLessThanOrEqual(60);
    if (method === '보관함에서') expect(origin.placeId).toBe(place.id);
    const meeting = buildMeeting();
    const saved = updateParticipant(
      { ...library, meetings: { [meeting.id]: meeting } },
      meeting.id,
      'person01',
      { origin },
      { now: meeting.createdAt, newId: () => 'unused01' },
    );
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(safeParse(LibrarySchema, saved.lib).success).toBe(true);
      expect(saved.lib.meetings![meeting.id]!.participants.value[0]!.origin).toEqual(origin);
    }
  },
);

it('지도에서 공백 이름은 계속 선택할 수 없다', () => {
  const { onPick } = setup();
  fireEvent.click(screen.getByRole('tab', { name: '지도에서 고르기' }));
  fireEvent.click(screen.getByRole('button', { name: '지도 중심 변경' }));
  fireEvent.change(screen.getByRole('textbox', { name: '출발지 이름' }), {
    target: { value: '   ' },
  });
  expect(screen.getByRole('button', { name: '여기로 정하기' })).toBeDisabled();
  expect(onPick).not.toHaveBeenCalled();
});
