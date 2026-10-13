import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { FolderRef, FolderResult, ResolvedPlace } from 'src/server/resolve';
import { LIBRARY_KEY } from 'src/services/library-store';
import { PlaceLookup } from 'src/services/place-lookup';
import { addFlowAtom, addTargetAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import {
  GANGNEUNG,
  makePlace,
  renderLibrary,
  sampleLibrary,
  T0,
  withPlaces,
} from '../library/fixtures';
import { f, makeTrip, P1, P2, P3, P5, TRIP, withTrip } from './planner-fixtures';

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

const LIST = { libraryView: 'list' as const };
const NEW_TRIP = 'tripnew001';
const NEW_PLACE = 'newplace01';

const trip = (lib: Library, id = TRIP) => lib.trips[id]!;
const candidatesOf = (lib: Library, id = TRIP) => trip(lib, id).candidates.value;
const toasted = (message: string) =>
  toastMock.mock.calls.some(([first]) => first === message) ? message : null;

const regionChip = (name: string) =>
  within(screen.getByRole('group', { name: '지역' })).getByRole('button', { name });
const labelChip = (name: string) =>
  within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name });
const row = (name: RegExp) =>
  within(screen.getByRole('list', { name: '장소 목록' })).getByRole('button', { name });
const toolbar = () => screen.getByRole('toolbar', { name: '일괄 편집' });
const panel = () => screen.getByRole('region', { name: '장소 추가' });
const candidatePanel = () => screen.getByRole('region', { name: '후보 칸' });

// ---------- 가짜 장소 조회 ----------

const naverPlace = (): ResolvedPlace => ({
  kind: 'place',
  provider: 'naver',
  providerId: '1958911015',
  name: '콤포트',
  address: '강원특별자치도 강릉시 경강로 1',
  lng: 128.9,
  lat: 37.75,
  category: '카페,디저트',
});

const folder = (): FolderResult => ({
  folderName: '강릉 맛집',
  places: [
    { sid: '9001', name: '폴더 장소 1', address: GANGNEUNG, lng: 128.9, lat: 37.75, memo: '' },
    // 보관함의 중앙시장 닭강정(sid 1001)과 같다. 이미 이 여행의 후보다.
    { sid: '1001', name: '닭강정', address: GANGNEUNG, lng: 128.9, lat: 37.75, memo: '' },
    { sid: '9003', name: '폴더 장소 3', address: GANGNEUNG, lng: 128.9, lat: 37.75, memo: '' },
  ],
});

function fakeLookup(link: ResolvedPlace | FolderRef = naverPlace()) {
  return Layer.succeed(
    PlaceLookup,
    PlaceLookup.of({
      lookupLink: () => Effect.succeed(link),
      lookupFolder: () => Effect.succeed(folder()),
    }),
  );
}

// ---------- 지역 칩 → 이 지역으로 여행 만들기 ----------

/**
 * 강릉: 닭강정·카페거리·창가 자리 + 주소 없는 곳(가까운 강릉에서 지역을 빌린다) = 4곳.
 * 보관함에서 숨긴 강릉 장소와 지운 강릉 장소는 세지 않는다.
 */
function regionLibrary(): Library {
  return withPlaces(sampleLibrary(), [
    makePlace(6, { name: '주소 없는 곳', address: '' }),
    { ...makePlace(7, { name: '숨긴 곳' }), saved: f(false) },
    makePlace(8, { name: '지운 곳', deletedAt: T0 }),
  ]);
}

describe('이 지역으로 여행 만들기', () => {
  it('지역 칩 하나를 고르면 버튼이 나오고, 만들면 그 지역의 보관함 장소가 모두 후보가 된다', async () => {
    const user = userEvent.setup();
    const { store, router } = await renderLibrary(regionLibrary(), {
      prefs: LIST,
      ids: [NEW_TRIP],
    });
    expect(screen.queryByRole('button', { name: '이 지역으로 여행 만들기' })).toBeNull();

    // 다른 필터(라벨)를 걸어 목록이 한 곳만 보여도 후보는 그 지역 전부다.
    await user.click(labelChip('맛집 2'));
    await user.click(regionChip('강릉 1'));
    await user.click(screen.getByRole('button', { name: '이 지역으로 여행 만들기' }));

    const dialog = screen.getByRole('dialog', { name: '새 여행' });
    expect(within(dialog).getByLabelText('여행 이름')).toHaveValue('강릉 여행');
    await user.click(within(dialog).getByRole('button', { name: '만들기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${NEW_TRIP}`));
    expect([...candidatesOf(store.get(libraryAtom), NEW_TRIP)].sort()).toEqual(
      [P1, P2, P5, 'place00006'].sort(),
    );
  });

  it('지역 칩을 두 개 고르면 버튼이 없다', async () => {
    const user = userEvent.setup();
    await renderLibrary(regionLibrary(), { prefs: LIST });
    await user.click(regionChip('강릉 4'));
    expect(screen.getByRole('button', { name: '이 지역으로 여행 만들기' })).toBeInTheDocument();
    await user.click(regionChip('속초 1'));
    expect(screen.queryByRole('button', { name: '이 지역으로 여행 만들기' })).toBeNull();
  });
});

// ---------- 일괄 편집 바 → 여행에 넣기 ----------

async function selectRows(user: ReturnType<typeof userEvent.setup>, ...names: RegExp[]) {
  await user.keyboard('{Shift>}');
  for (const name of names) await user.click(row(name));
  await user.keyboard('{/Shift}');
}

describe('여행에 넣기', () => {
  it('기존 여행을 고르면 새로 넣은 곳만 후보에 더하고 개수를 알린다', async () => {
    const user = userEvent.setup();
    const lib = withTrip(sampleLibrary(), makeTrip({ candidates: [P2] }));
    const { store } = await renderLibrary(lib, { prefs: LIST });

    await selectRows(user, /중앙시장 닭강정/, /안목 카페거리/, /속초 횟집/);
    await user.click(within(toolbar()).getByRole('button', { name: '여행에 넣기' }));
    const dialog = screen.getByRole('dialog', { name: '여행에 넣기' });
    await user.click(within(dialog).getByRole('button', { name: /강릉 여행/ }));

    // 목록 순서(최근 저장순)대로 붙는다.
    await waitFor(() => expect(candidatesOf(store.get(libraryAtom))).toEqual([P2, P3, P1]));
    expect(toasted('2곳을 후보에 넣었어요')).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '여행에 넣기' })).toBeNull());
  });

  it('여행을 두 번 빠르게 눌러도 한 번만 넣고 토스트도 한 번이다', async () => {
    const user = userEvent.setup();
    const lib = withTrip(sampleLibrary(), makeTrip({ candidates: [P2] }));
    const { store } = await renderLibrary(lib, { prefs: LIST });

    await selectRows(user, /중앙시장 닭강정/);
    await user.click(within(toolbar()).getByRole('button', { name: '여행에 넣기' }));
    const pick = within(screen.getByRole('dialog', { name: '여행에 넣기' })).getByRole('button', {
      name: /강릉 여행/,
    });
    // 저장이 끝나기 전에 두 번(동기로 연달아) 누른다.
    act(() => {
      pick.click();
      pick.click();
    });

    await waitFor(() => expect(candidatesOf(store.get(libraryAtom))).toEqual([P2, P1]));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '여행에 넣기' })).toBeNull());
    const notices = toastMock.mock.calls.filter(
      ([first]) => first === '1곳을 후보에 넣었어요' || first === '이미 후보에 있어요',
    );
    expect(notices).toEqual([['1곳을 후보에 넣었어요']]);
  });

  it('모두 이미 있으면 이미 후보에 있어요로 알린다', async () => {
    const user = userEvent.setup();
    const lib = withTrip(sampleLibrary(), makeTrip({ candidates: [P2, P1] }));
    const { store } = await renderLibrary(lib, { prefs: LIST });
    await selectRows(user, /중앙시장 닭강정/, /안목 카페거리/);
    await user.click(within(toolbar()).getByRole('button', { name: '여행에 넣기' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '여행에 넣기' })).getByRole('button', {
        name: /강릉 여행/,
      }),
    );
    await waitFor(() => expect(toasted('이미 후보에 있어요')).not.toBeNull());
    expect(candidatesOf(store.get(libraryAtom))).toEqual([P2, P1]);
  });

  it('새 여행을 고르면 선택한 장소를 후보로 새 여행을 만든다', async () => {
    const user = userEvent.setup();
    const { store, router } = await renderLibrary(sampleLibrary(), {
      prefs: LIST,
      ids: [NEW_TRIP],
    });
    await selectRows(user, /중앙시장 닭강정/, /속초 횟집/);
    await user.click(within(toolbar()).getByRole('button', { name: '여행에 넣기' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '여행에 넣기' })).getByRole('button', {
        name: '새 여행',
      }),
    );
    const form = screen.getByRole('dialog', { name: '새 여행' });
    await user.type(within(form).getByLabelText('여행 이름'), '동해 여행');
    await user.click(within(form).getByRole('button', { name: '만들기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${NEW_TRIP}`));
    expect([...candidatesOf(store.get(libraryAtom), NEW_TRIP)].sort()).toEqual([P1, P3].sort());
  });
});

// ---------- 계획 화면 → 링크·핀으로 새로 추가 ----------

async function startAdd(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(within(candidatePanel()).getByRole('button', { name: '링크·핀으로 새로 추가' }));
  const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
  await user.click(within(sheet).getByRole('button', { name: new RegExp(item) }));
  await waitFor(() => expect(sheet).not.toBeInTheDocument());
}

async function submitLink(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(within(panel()).getByRole('textbox', { name: '링크' }));
  await user.paste(text);
  await user.click(within(panel()).getByRole('button', { name: '확인' }));
}

/** 확인 카드는 지도가 필요해 보관함(`/`)으로 옮겨 열린다. 옮긴 뒤의 카드를 쓴다. */
async function cardOnLibrary(router: { state: { location: { pathname: string } } }) {
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  // 경로가 바뀐 뒤 셸이 다시 그려져 칸이 새로 생긴다. 그 뒤의 칸을 잡는다.
  await act(async () => {});
  return panel();
}

describe('링크·핀으로 새로 추가', () => {
  it('보관함에도 저장을 끄고 추가하면 숨긴 장소로 만들어 후보에 넣고 계획 화면으로 돌아온다', async () => {
    const user = userEvent.setup();
    const lib = withTrip(sampleLibrary(), makeTrip({ candidates: [P2] }));
    const { store, router } = await renderLibrary(lib, {
      path: `/trips/${TRIP}`,
      ids: [NEW_PLACE],
      placeLookup: fakeLookup(),
    });

    await startAdd(user, '링크 붙여넣기');
    expect(store.get(addTargetAtom)).toEqual({ tripId: TRIP });
    await submitLink(user, 'https://naver.me/Fk73Vab5');
    const card = await cardOnLibrary(router);
    const keep = await within(card).findByRole('checkbox', { name: '보관함에도 저장' });
    expect(keep).toBeChecked();
    await user.click(keep);
    await user.click(within(card).getByRole('button', { name: '추가' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${TRIP}`));
    const after = store.get(libraryAtom);
    expect(after.places[NEW_PLACE]!.saved.value).toBe(false);
    expect(candidatesOf(after)).toEqual([P2, NEW_PLACE]);
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(store.get(addTargetAtom)).toBeNull();
    expect(toasted('1곳을 후보에 넣었어요')).not.toBeNull();
  });

  it('이미 Day에 있는 장소를 다시 넣으면 건너뛰고 그 Day를 알린다', async () => {
    const user = userEvent.setup();
    const existing = { ...makePlace(6, { name: '콤포트', sid: '1958911015' }) };
    const lib = withTrip(
      withPlaces(sampleLibrary(), [existing]),
      makeTrip({ stops: [[], [existing.id]] }),
    );
    const { store, router } = await renderLibrary(lib, {
      path: `/trips/${TRIP}`,
      placeLookup: fakeLookup(),
    });
    await startAdd(user, '링크 붙여넣기');
    await submitLink(user, 'https://naver.me/Fk73Vab5');
    const card = await cardOnLibrary(router);
    await user.click(await within(card).findByRole('button', { name: '라벨 더하기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${TRIP}`));
    expect(candidatesOf(store.get(libraryAtom))).toEqual([]);
    expect(toasted('이미 Day 2에 있어요')).not.toBeNull();
  });

  it('핀 카드에도 보관함에도 저장이 있고, 켠 채 추가하면 보관함에 보이는 장소로 넣는다', async () => {
    const user = userEvent.setup();
    const lib = withTrip(sampleLibrary(), makeTrip());
    const { store, router } = await renderLibrary(lib, {
      path: `/trips/${TRIP}`,
      ids: [NEW_PLACE],
    });
    await startAdd(user, '지도에서 핀 찍기');
    act(() =>
      store.set(addFlowAtom, { step: 'pin-card', name: '바닷가 벤치', lng: 128.9, lat: 37.75 }),
    );
    const keep = await within(panel()).findByRole('checkbox', { name: '보관함에도 저장' });
    expect(keep).toBeChecked();
    await user.click(within(panel()).getByRole('button', { name: '추가' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${TRIP}`));
    const after = store.get(libraryAtom);
    expect(after.places[NEW_PLACE]!.saved.value).toBe(true);
    expect(candidatesOf(after)).toEqual([NEW_PLACE]);
  });

  it('폴더를 가져오면 가져온 장소가 모두 후보가 되고 계획 화면으로 돌아온다', async () => {
    const user = userEvent.setup();
    const lib = withTrip(sampleLibrary(), makeTrip({ candidates: [P1] }));
    const { store, router } = await renderLibrary(lib, {
      path: `/trips/${TRIP}`,
      ids: ['newlab01', 'newplace01', 'newplace02'],
      placeLookup: fakeLookup({ kind: 'folder', shareId: 'abc123' }),
    });
    await startAdd(user, '네이버 폴더 가져오기');
    await submitLink(user, 'https://naver.me/5Iiuye7j');
    // 폴더 가져오기는 늘 보관함에 저장한다.
    await within(panel()).findByRole('button', { name: '3곳 가져오기' });
    expect(within(panel()).queryByRole('checkbox', { name: '보관함에도 저장' })).toBeNull();
    await user.click(within(panel()).getByRole('button', { name: '3곳 가져오기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${TRIP}`));
    const after = store.get(libraryAtom);
    expect(candidatesOf(after)).toEqual([P1, 'newplace01', 'newplace02']);
    expect(after.places['newplace01']!.saved.value).toBe(true);
    expect(toasted('2곳을 후보에 넣었어요')).not.toBeNull();
    expect(store.get(addTargetAtom)).toBeNull();
  });

  it('취소하면 대상을 지우고, 이후 ＋추가는 보통의 흐름이다', async () => {
    const user = userEvent.setup();
    const lib = withTrip(sampleLibrary(), makeTrip());
    const { store, router } = await renderLibrary(lib, {
      path: `/trips/${TRIP}`,
      placeLookup: fakeLookup(),
    });
    await startAdd(user, '링크 붙여넣기');
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(store.get(addTargetAtom)).toBeNull();

    // 시트를 열었다가 아무것도 고르지 않고 닫아도 대상을 지운다.
    await user.click(
      within(candidatePanel()).getByRole('button', { name: '링크·핀으로 새로 추가' }),
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '장소 추가' })).toBeNull());
    expect(store.get(addTargetAtom)).toBeNull();

    // 레일의 ＋추가는 대상 없이 연다.
    await user.click(screen.getByRole('button', { name: '장소 추가' }));
    const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
    await user.click(within(sheet).getByRole('button', { name: /링크 붙여넣기/ }));
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
    expect(store.get(addTargetAtom)).toBeNull();
    await submitLink(user, 'https://naver.me/Fk73Vab5');
    const card = await cardOnLibrary(router);
    await within(card).findByRole('button', { name: '추가' });
    expect(within(card).queryByRole('checkbox', { name: '보관함에도 저장' })).toBeNull();
  });
});

// ---------- 계획 화면 → 보관함에서 더하기 ----------

describe('보관함에서 더하기', () => {
  it('이미 이 여행에 있는 장소는 막고, 체크한 곳을 후보에 더한다', async () => {
    const user = userEvent.setup();
    const lib = withTrip(sampleLibrary(), makeTrip({ stops: [[P1]], candidates: [P2] }));
    const { store } = await renderLibrary(lib, { path: `/trips/${TRIP}` });

    await user.click(within(candidatePanel()).getByRole('button', { name: '보관함에서 더하기' }));
    const dialog = screen.getByRole('dialog', { name: '보관함에서 더하기' });
    const inDay = within(dialog).getByRole('checkbox', { name: /중앙시장 닭강정/ });
    expect(inDay).toBeDisabled();
    expect(within(dialog).getByText('이미 Day 1에 있어요')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /안목 카페거리/ })).toBeDisabled();
    expect(within(dialog).getByText('이미 후보에 있어요')).toBeInTheDocument();

    // 지역·라벨·검색으로 거른다.
    await user.click(within(dialog).getByRole('button', { name: '속초 1' }));
    expect(within(dialog).queryByRole('checkbox', { name: /창가 자리/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: '속초 1' }));
    await user.click(within(dialog).getByRole('button', { name: '맛집 2' }));
    expect(within(dialog).queryByRole('checkbox', { name: /창가 자리/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: '맛집 2' }));
    await user.type(within(dialog).getByRole('searchbox', { name: '장소 검색' }), '창가');
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1);
    await user.clear(within(dialog).getByRole('searchbox', { name: '장소 검색' }));

    await user.click(within(dialog).getByRole('checkbox', { name: /창가 자리/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /속초 횟집/ }));
    await user.click(within(dialog).getByRole('button', { name: '2곳 넣기' }));

    await waitFor(() => expect(candidatesOf(store.get(libraryAtom))).toEqual([P2, P5, P3]));
    expect(toasted('2곳을 후보에 넣었어요')).not.toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '보관함에서 더하기' })).toBeNull(),
    );
  });

  /** 다른 탭이 쓴 것처럼 저장소의 후보에 장소를 더한다. 이 탭의 화면은 모른다. */
  function addCandidateAsOtherTab(storage: Storage, placeId: string) {
    const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
    const t = stored.trips[TRIP]!;
    const next = { ...t, candidates: { ...t.candidates, value: [...t.candidates.value, placeId] } };
    storage.setItem(LIBRARY_KEY, JSON.stringify({ ...stored, trips: { [TRIP]: next } }));
  }

  it('알림은 체크한 수가 아니라 새로 넣은 수를 센다(그사이 다른 탭이 먼저 넣은 곳은 빼고)', async () => {
    const user = userEvent.setup();
    const lib = withTrip(sampleLibrary(), makeTrip({ stops: [[P1]], candidates: [P2] }));
    const { store, storage } = await renderLibrary(lib, { path: `/trips/${TRIP}` });

    await user.click(within(candidatePanel()).getByRole('button', { name: '보관함에서 더하기' }));
    const dialog = screen.getByRole('dialog', { name: '보관함에서 더하기' });
    await user.click(within(dialog).getByRole('checkbox', { name: /창가 자리/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /속초 횟집/ }));
    addCandidateAsOtherTab(storage, P5);
    await user.click(within(dialog).getByRole('button', { name: '2곳 넣기' }));

    await waitFor(() => expect(candidatesOf(store.get(libraryAtom))).toEqual([P2, P5, P3]));
    expect(toasted('1곳을 후보에 넣었어요')).not.toBeNull();
    expect(toasted('2곳을 후보에 넣었어요')).toBeNull();
  });

  it('체크한 곳을 모두 다른 탭이 먼저 넣었으면 이미 후보에 있어요로 알린다', async () => {
    const user = userEvent.setup();
    const lib = withTrip(sampleLibrary(), makeTrip({ stops: [[P1]], candidates: [P2] }));
    const { store, storage } = await renderLibrary(lib, { path: `/trips/${TRIP}` });

    await user.click(within(candidatePanel()).getByRole('button', { name: '보관함에서 더하기' }));
    const dialog = screen.getByRole('dialog', { name: '보관함에서 더하기' });
    await user.click(within(dialog).getByRole('checkbox', { name: /창가 자리/ }));
    addCandidateAsOtherTab(storage, P5);
    await user.click(within(dialog).getByRole('button', { name: '1곳 넣기' }));

    await waitFor(() => expect(candidatesOf(store.get(libraryAtom))).toEqual([P2, P5]));
    await waitFor(() => expect(toasted('이미 후보에 있어요')).not.toBeNull());
    expect(toasted('1곳을 후보에 넣었어요')).toBeNull();
  });
});
