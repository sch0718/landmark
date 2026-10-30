import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { libraryAtom } from 'src/stores/library-state';
import { makePlace, renderLibrary, sampleLibrary, T0, withPlaces } from '../library/fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

// 오늘은 2026-10-13(화)로 고정한다. 타이머는 그대로 두고 날짜만 속인다.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
});
afterEach(() => {
  cleanup();
  toastMock.mockClear();
  toastMock.error.mockClear();
  setAppRuntimeForTest(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const f = <V,>(value: V) => ({ value, updatedAt: T0 });

function makeTrip(
  n: number,
  title: string,
  startDate: string,
  endDate: string,
  options: { stops?: string[]; candidates?: string[]; deletedAt?: string | null } = {},
): Trip {
  const first = new Date(`${startDate}T00:00:00Z`).getTime();
  const days = Math.round((new Date(`${endDate}T00:00:00Z`).getTime() - first) / 86_400_000) + 1;
  return {
    id: `trip${String(n).padStart(6, '0')}`,
    title: f(title),
    startDate: f(startDate),
    endDate: f(endDate),
    origin: f<string | null>(null),
    candidates: f(options.candidates ?? []),
    days: Array.from({ length: days }, (_, i) => ({
      stops: f(
        i === 0
          ? (options.stops ?? []).map((placeId, k) => ({
              id: `stop${String(k).padStart(4, '0')}`,
              placeId,
              stayMin: null,
              fixedTime: null,
              note: '',
            }))
          : [],
      ),
      lodging: f<string | null>(null),
      startTime: f('09:00'),
    })),
    legModes: f({}),
    createdAt: T0,
    deletedAt: options.deletedAt ?? null,
  };
}

function withTrips(base: Library, trips: Trip[]): Library {
  return { ...base, trips: Object.fromEntries(trips.map((t) => [t.id, t])) };
}

const NEW_ID = 'trip000001';
const CAFE = 'place00002';
const HOUSE = 'place00006';

const newTripButton = () => screen.getByRole('button', { name: '새 여행' });

describe('여행 목록', () => {
  it('여행이 없으면 안내와 새 여행 버튼을 보인다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    expect(screen.getByText('아직 만든 여행이 없어요')).toBeInTheDocument();
    expect(newTripButton()).toBeInTheDocument();
  });

  it('카드에 제목·기간·박수·일정/후보 수를 보인다', async () => {
    const lib = withTrips(sampleLibrary(), [
      makeTrip(1, '강릉 여행', '2026-10-23', '2026-10-25', {
        stops: ['place00001', CAFE],
        candidates: ['place00003'],
      }),
      makeTrip(2, '하루 나들이', '2026-10-30', '2026-10-30'),
    ]);
    await renderLibrary(lib, { path: '/trips' });
    expect(screen.getByText('강릉 여행')).toBeInTheDocument();
    expect(screen.getByText('10.23(금) ~ 10.25(일) · 2박 3일')).toBeInTheDocument();
    expect(screen.getByText('일정 2곳 · 후보 1곳')).toBeInTheDocument();
    expect(screen.getByText('10.30(금) ~ 10.30(금) · 당일')).toBeInTheDocument();
    expect(screen.getByText('일정 0곳 · 후보 0곳')).toBeInTheDocument();
    // 링크 이름에도 일정/후보 수가 들어간다(aria-label이 가리지 않는다).
    expect(
      screen.getByRole('link', {
        name: '강릉 여행, 10.23(금) ~ 10.25(일) · 2박 3일, 일정 2곳 · 후보 1곳',
      }),
    ).toBeInTheDocument();
  });

  it('보관함에서 지운 장소는 일정·후보 수에서 뺀다', async () => {
    const deleted = makePlace(9, { deletedAt: T0 });
    const deletedToo = makePlace(8, { deletedAt: T0 });
    const lib = withTrips(withPlaces(sampleLibrary(), [deleted, deletedToo]), [
      makeTrip(1, '강릉 여행', '2026-10-23', '2026-10-25', {
        stops: ['place00001', deleted.id],
        candidates: [deletedToo.id],
      }),
    ]);
    await renderLibrary(lib, { path: '/trips' });
    expect(screen.getByText('일정 1곳 · 후보 0곳')).toBeInTheDocument();
  });

  it('가까운 여행 순으로 보이고 지난 여행은 머리글 아래에 모은다', async () => {
    const lib = withTrips(sampleLibrary(), [
      makeTrip(1, '먼 여행', '2026-12-01', '2026-12-03'),
      makeTrip(2, '지난 제주', '2026-09-01', '2026-09-03'),
      makeTrip(3, '곧 갈 여행', '2026-10-20', '2026-10-21'),
      makeTrip(4, '오늘 끝나는 여행', '2026-10-12', '2026-10-13'),
    ]);
    await renderLibrary(lib, { path: '/trips' });
    // 여행 카드 제목도 `h2`라 "지난 여행" 머리글과 같은 단계다.
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['오늘 끝나는 여행', '곧 갈 여행', '먼 여행', '지난 여행', '지난 제주']);
    const header = screen.getByRole('heading', { name: '지난 여행' });
    const past = screen.getByRole('heading', { name: '지난 제주' });
    const upcoming = screen.getByRole('heading', { name: '먼 여행' });
    expect(header.compareDocumentPosition(past) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      upcoming.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('지난 여행이 없으면 머리글을 보이지 않는다', async () => {
    const lib = withTrips(sampleLibrary(), [makeTrip(1, '곧 갈 여행', '2026-10-20', '2026-10-21')]);
    await renderLibrary(lib, { path: '/trips' });
    expect(screen.queryByRole('heading', { name: '지난 여행' })).not.toBeInTheDocument();
  });

  it('지운 여행은 보이지 않는다', async () => {
    const lib = withTrips(sampleLibrary(), [
      makeTrip(1, '지운 여행', '2026-10-20', '2026-10-21', { deletedAt: T0 }),
    ]);
    await renderLibrary(lib, { path: '/trips' });
    expect(screen.queryByText('지운 여행')).not.toBeInTheDocument();
    expect(screen.getByText('아직 만든 여행이 없어요')).toBeInTheDocument();
  });
});

describe('새 여행', () => {
  const open = async () => {
    const user = userEvent.setup();
    await user.click(newTripButton());
    const dialog = screen.getByRole('dialog', { name: '새 여행' });
    return { user, dialog };
  };

  it('기본 기간은 오늘~내일이다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    const { dialog } = await open();
    expect(within(dialog).getByLabelText('시작일')).toHaveValue('2026-10-13');
    expect(within(dialog).getByLabelText('종료일')).toHaveValue('2026-10-14');
  });

  it('제목과 기간을 넣고 만들면 여행이 저장되고 /trips/<id>로 이동한다', async () => {
    const { router, store } = await renderLibrary(sampleLibrary(), {
      path: '/trips',
      ids: [NEW_ID],
    });
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText('여행 이름'), '  강릉 여행  ');
    fireEvent.change(within(dialog).getByLabelText('시작일'), { target: { value: '2026-10-23' } });
    fireEvent.change(within(dialog).getByLabelText('종료일'), { target: { value: '2026-10-25' } });
    await user.click(within(dialog).getByRole('button', { name: '만들기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${NEW_ID}`));
    const trips = Object.values(store.get(libraryAtom).trips);
    expect(trips).toHaveLength(1);
    expect(trips[0]!.id).toBe(NEW_ID);
    expect(trips[0]!.title.value).toBe('강릉 여행');
    expect(trips[0]!.startDate.value).toBe('2026-10-23');
    expect(trips[0]!.endDate.value).toBe('2026-10-25');
    expect(trips[0]!.days).toHaveLength(3);
    expect(trips[0]!.origin.value).toBeNull();
  });

  it('빈 제목이면 문구를 보이고 만들기를 막는다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    const { user, dialog } = await open();
    const create = within(dialog).getByRole('button', { name: '만들기' });
    expect(create).toBeDisabled();
    expect(within(dialog).getByText('여행 이름을 넣어 주세요')).toBeInTheDocument();

    const input = within(dialog).getByLabelText('여행 이름');
    await user.type(input, '가');
    expect(create).toBeEnabled();
    await user.clear(input);
    expect(create).toBeDisabled();
    await user.type(input, '   ');
    expect(create).toBeDisabled();
    expect(within(dialog).getByText('여행 이름을 넣어 주세요')).toBeInTheDocument();
  });

  it('61자 제목은 막고 60자는 통과한다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    const { dialog } = await open();
    const input = within(dialog).getByLabelText('여행 이름');
    const create = within(dialog).getByRole('button', { name: '만들기' });

    fireEvent.change(input, { target: { value: '가'.repeat(61) } });
    expect(within(dialog).getByText('여행 이름은 60자까지예요')).toBeInTheDocument();
    expect(create).toBeDisabled();

    fireEvent.change(input, { target: { value: '가'.repeat(60) } });
    expect(within(dialog).queryByText('여행 이름은 60자까지예요')).not.toBeInTheDocument();
    expect(create).toBeEnabled();
  });

  it('31일 기간은 막고 30일은 통과한다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText('여행 이름'), '긴 여행');
    const create = within(dialog).getByRole('button', { name: '만들기' });
    fireEvent.change(within(dialog).getByLabelText('시작일'), { target: { value: '2026-11-01' } });

    fireEvent.change(within(dialog).getByLabelText('종료일'), { target: { value: '2026-12-01' } });
    expect(within(dialog).getByText('여행은 30일까지 만들 수 있어요')).toBeInTheDocument();
    expect(create).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('종료일'), { target: { value: '2026-11-30' } });
    expect(within(dialog).queryByText('여행은 30일까지 만들 수 있어요')).not.toBeInTheDocument();
    expect(create).toBeEnabled();
  });

  it('종료일이 시작일보다 빠르면 막는다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText('여행 이름'), '거꾸로');
    fireEvent.change(within(dialog).getByLabelText('종료일'), { target: { value: '2026-10-01' } });
    expect(within(dialog).getByText('종료일은 시작일 뒤여야 해요')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '만들기' })).toBeDisabled();
  });

  it('출발지를 검색해 고르면 origin으로 저장된다(보관함에서 숨긴 장소 포함)', async () => {
    const hidden = makePlace(6, { name: '속초 숙소 별채' });
    const lib = withPlaces(sampleLibrary(), [
      { ...hidden, saved: { value: false, updatedAt: T0 } },
    ]);
    const { store } = await renderLibrary(lib, { path: '/trips', ids: [NEW_ID] });
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText('여행 이름'), '속초 여행');
    await user.click(within(dialog).getByRole('button', { name: '출발지 고르기' }));

    const picker = screen.getByRole('dialog', { name: '출발지 고르기' });
    await user.type(within(picker).getByRole('searchbox', { name: '장소 검색' }), '별채');
    expect(within(picker).queryByText('중앙시장 닭강정')).not.toBeInTheDocument();
    await user.click(within(picker).getByRole('button', { name: /속초 숙소 별채/ }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '출발지 고르기' })).not.toBeInTheDocument(),
    );
    expect(within(dialog).getByText('속초 숙소 별채')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '만들기' }));
    await waitFor(() => expect(Object.keys(store.get(libraryAtom).trips)).toEqual([NEW_ID]));
    expect(store.get(libraryAtom).trips[NEW_ID]!.origin.value).toBe(HOUSE);
  });

  it('고른 출발지를 지울 수 있다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: '출발지 고르기' }));
    const picker = screen.getByRole('dialog', { name: '출발지 고르기' });
    await user.click(within(picker).getByRole('button', { name: /안목 카페거리/ }));
    expect(await within(dialog).findByText('안목 카페거리')).toBeInTheDocument();
    // 고르기 창이 닫히는 동안에는 아래 창이 보조기술에서 가려져 있다.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '출발지 고르기' })).toBeNull());
    await user.click(within(dialog).getByRole('button', { name: '출발지 지우기' }));
    expect(within(dialog).queryByText('안목 카페거리')).not.toBeInTheDocument();
  });

  it('취소하면 아무것도 저장하지 않는다', async () => {
    const { store } = await renderLibrary(sampleLibrary(), { path: '/trips' });
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText('여행 이름'), '취소할 여행');
    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '새 여행' })).not.toBeInTheDocument(),
    );
    expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(0);
  });
});

describe('카드 메뉴', () => {
  const lib = () =>
    withTrips(sampleLibrary(), [makeTrip(1, '강릉 여행', '2026-10-23', '2026-10-25')]);

  it('이름 바꾸기로 제목을 고친다', async () => {
    const { store } = await renderLibrary(lib(), { path: '/trips' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '‘강릉 여행’ 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }));

    const dialog = screen.getByRole('dialog', { name: '여행 고치기' });
    const input = within(dialog).getByLabelText('여행 이름');
    expect(input).toHaveValue('강릉 여행');
    await user.clear(input);
    expect(within(dialog).getByText('여행 이름을 넣어 주세요')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '저장' })).toBeDisabled();
    await user.type(input, '속초 여행');
    await user.click(within(dialog).getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(store.get(libraryAtom).trips['trip000001']!.title.value).toBe('속초 여행'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('속초 여행')).toBeInTheDocument();
  });

  it('삭제는 확인을 거쳐 묘비를 남기고, 토스트의 되돌리기로 살린다', async () => {
    const { store } = await renderLibrary(lib(), { path: '/trips' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '‘강릉 여행’ 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '삭제' }));

    const confirm = screen.getByRole('dialog', { name: '여행 지우기' });
    await user.click(within(confirm).getByRole('button', { name: '취소' }));
    expect(store.get(libraryAtom).trips['trip000001']!.deletedAt).toBeNull();

    await user.click(screen.getByRole('button', { name: '‘강릉 여행’ 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '삭제' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '여행 지우기' })).getByRole('button', {
        name: '삭제',
      }),
    );

    await waitFor(() =>
      expect(store.get(libraryAtom).trips['trip000001']!.deletedAt).not.toBeNull(),
    );
    expect(screen.queryByText('강릉 여행')).not.toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledTimes(1);
    const [message, options] = toastMock.mock.calls[0]!;
    expect(message).toContain('강릉 여행');
    expect(options.duration).toBe(8000);
    expect(options.action.label).toBe('되돌리기');

    await act(async () => {
      options.action.onClick();
    });
    await waitFor(() => expect(store.get(libraryAtom).trips['trip000001']!.deletedAt).toBeNull());
    expect(await screen.findByText('강릉 여행')).toBeInTheDocument();
  });

  it('메뉴의 `일정 공유`는 이름 바꾸기와 삭제 사이에 있고 일정 공유 창을 연다', async () => {
    await renderLibrary(lib(), { path: '/trips' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '‘강릉 여행’ 메뉴' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      '이름 바꾸기',
      '일정 공유',
      '삭제',
    ]);
    await user.click(screen.getByRole('menuitem', { name: '일정 공유' }));
    // 창은 처음 열 때 받으므로 한 박자 동안은 기다림 틀이 뜨고, 실제 창이 그것을 바꿔 놓는다.
    await screen.findByRole('textbox', { name: '제목' });
    const dialog = screen.getByRole('dialog', { name: '일정 공유' });
    expect(
      within(dialog).getByText('‘강릉 여행’ 일정을 HTML 파일 하나로 만들어요'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('여행 카드를 누르면 /trips/<id>로 간다', async () => {
    const { router } = await renderLibrary(lib(), { path: '/trips' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: /강릉 여행/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/trips/trip000001'));
  });
});

describe('장소 고르기 창', () => {
  it('이 여행의 장소가 보관함 검색 결과보다 먼저 나온다', async () => {
    const lib = withTrips(sampleLibrary(), [
      makeTrip(1, '강릉 여행', '2026-10-23', '2026-10-25', {
        stops: ['place00003'],
        candidates: [CAFE],
      }),
    ]);
    await renderLibrary(lib, { path: '/trips' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '‘강릉 여행’ 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    const dialog = screen.getByRole('dialog', { name: '여행 고치기' });
    await user.click(within(dialog).getByRole('button', { name: '출발지 고르기' }));

    const picker = screen.getByRole('dialog', { name: '출발지 고르기' });
    const names = within(picker)
      .getAllByRole('button', {
        name: /속초 횟집|안목 카페거리|중앙시장 닭강정|창가 자리|강남 한 곳/,
      })
      .map((b) => b.textContent);
    // 후보·Stop이 먼저(후보 → Day 순), 그다음 보관함의 나머지(이름순).
    expect(names[0]).toContain('안목 카페거리');
    expect(names[1]).toContain('속초 횟집');
    expect(names.slice(2).join('|')).toContain('중앙시장 닭강정');
    expect(within(picker).getByText('이 여행의 장소')).toBeInTheDocument();
    expect(within(picker).getByText('보관함')).toBeInTheDocument();
  });

  it('지운 장소는 나오지 않는다', async () => {
    const deleted = makePlace(9, { name: '지운 가게', deletedAt: T0 });
    await renderLibrary(withPlaces(sampleLibrary(), [deleted]), { path: '/trips' });
    const user = userEvent.setup();
    await user.click(newTripButton());
    await user.click(screen.getByRole('button', { name: '출발지 고르기' }));
    const picker = screen.getByRole('dialog', { name: '출발지 고르기' });
    await user.type(within(picker).getByRole('searchbox', { name: '장소 검색' }), '지운');
    expect(within(picker).queryByText('지운 가게')).not.toBeInTheDocument();
    expect(within(picker).getByText('찾는 장소가 없어요')).toBeInTheDocument();
  });

  it('주소로도 찾는다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    const user = userEvent.setup();
    await user.click(newTripButton());
    await user.click(screen.getByRole('button', { name: '출발지 고르기' }));
    const picker = screen.getByRole('dialog', { name: '출발지 고르기' });
    await user.type(within(picker).getByRole('searchbox', { name: '장소 검색' }), '테헤란로');
    expect(within(picker).getByRole('button', { name: /강남 한 곳/ })).toBeInTheDocument();
    expect(within(picker).queryByRole('button', { name: /닭강정/ })).not.toBeInTheDocument();
  });
});

describe('오늘 일정 버튼(스펙 §3.1)', () => {
  const todayLink = (title: string) => screen.queryByRole('link', { name: `‘${title}’ 오늘 일정` });

  it('오늘이 기간 안인 여행 카드에만 보이고 /trips/<id>/today로 간다', async () => {
    vi.setSystemTime(new Date(2026, 9, 24, 12, 0, 0));
    const lib = withTrips(sampleLibrary(), [
      makeTrip(1, '강릉 여행', '2026-10-24', '2026-10-26'),
      makeTrip(2, '속초 여행', '2026-11-01', '2026-11-02'),
    ]);
    const { router } = await renderLibrary(lib, { path: '/trips' });
    const link = todayLink('강릉 여행');
    expect(link).toHaveAttribute('href', '/trips/trip000001/today');
    expect(link).toHaveTextContent('오늘 일정');
    expect(todayLink('속초 여행')).not.toBeInTheDocument();
    // 카드 링크 안이 아니라 `li` 안의 다음 형제다.
    const card = screen.getByRole('link', { name: /^강릉 여행, / });
    expect(card).not.toContainElement(link);
    expect(card.closest('li')).toContainElement(link);
    expect(parseFloat(getComputedStyle(link!).minHeight)).toBeGreaterThanOrEqual(44);

    await userEvent.setup().click(link!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/trips/trip000001/today'));
  });

  it('시작 전날에는 없다', async () => {
    vi.setSystemTime(new Date(2026, 9, 23, 12, 0, 0));
    const lib = withTrips(sampleLibrary(), [makeTrip(1, '강릉 여행', '2026-10-24', '2026-10-26')]);
    await renderLibrary(lib, { path: '/trips' });
    expect(screen.getByText('강릉 여행')).toBeInTheDocument();
    expect(todayLink('강릉 여행')).not.toBeInTheDocument();
  });

  it('하루 여행은 다음 날 03:00(새벽 경계 전)에도 보이고 04:00에는 없다', async () => {
    const lib = withTrips(sampleLibrary(), [
      makeTrip(1, '하루 나들이', '2026-10-24', '2026-10-24'),
    ]);
    vi.setSystemTime(new Date(2026, 9, 25, 3, 0, 0));
    await renderLibrary(lib, { path: '/trips' });
    expect(todayLink('하루 나들이')).toBeInTheDocument();
    cleanup();
    vi.setSystemTime(new Date(2026, 9, 25, 4, 0, 0));
    await renderLibrary(lib, { path: '/trips' });
    expect(screen.getByText('하루 나들이')).toBeInTheDocument();
    expect(todayLink('하루 나들이')).not.toBeInTheDocument();
  });

  it('하루 여행은 다음 날 03:00에 여행 목록에 있고 04:00에는 지난 여행에 있다(새벽 경계)', async () => {
    const lib = withTrips(sampleLibrary(), [
      makeTrip(1, '하루 나들이', '2026-10-24', '2026-10-24'),
      makeTrip(2, '속초 여행', '2026-11-01', '2026-11-02'),
    ]);
    const titlesIn = (name: string) =>
      within(screen.getByRole('list', { name }))
        .getAllByRole('link', { name: /, / })
        .map((link) => link.getAttribute('aria-label')?.split(',')[0]);
    vi.setSystemTime(new Date(2026, 9, 25, 3, 0, 0));
    await renderLibrary(lib, { path: '/trips' });
    // 버튼과 같은 경계: 오늘 일정이 달린 여행이 맨 위 묶음에 있다.
    expect(titlesIn('여행 목록')).toEqual(['하루 나들이', '속초 여행']);
    expect(screen.queryByRole('list', { name: '지난 여행 목록' })).not.toBeInTheDocument();
    cleanup();
    vi.setSystemTime(new Date(2026, 9, 25, 4, 0, 0));
    await renderLibrary(lib, { path: '/trips' });
    expect(titlesIn('여행 목록')).toEqual(['속초 여행']);
    expect(titlesIn('지난 여행 목록')).toEqual(['하루 나들이']);
  });
});

it('갱신 공유 여행 카드와 지우기 확인에 서버 사본이 남는다는 안내를 보인다', async () => {
  const { tripLiveStore } = await import('src/services/trip-live/store');
  tripLiveStore.put({
    tripId: NEW_ID,
    liveId: 'abcdefghij',
    status: 'live',
    ownerToken: 'o'.repeat(43),
    viewToken: 'v'.repeat(43),
    rev: 1,
    dayIds: [],
    options: { title: '강릉 여행', includeMemo: false, includeCandidates: true },
    createdAt: T0,
  });
  try {
    await renderLibrary(
      withTrips(sampleLibrary(), [makeTrip(1, '강릉 여행', '2026-10-23', '2026-10-24')]),
      { path: '/trips' },
    );
    expect(screen.getByRole('link', { name: /강릉 여행.+갱신 공유 중/ })).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '‘강릉 여행’ 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '삭제' }));
    expect(
      screen.getByText('갱신 링크는 서버에 남아요. 설정 › 갱신 링크에서 지울 수 있어요'),
    ).toBeVisible();
  } finally {
    act(() => tripLiveStore.remove(NEW_ID));
  }
});
