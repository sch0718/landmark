import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUERY } from 'src/domain/library/query';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { Prefs } from 'src/schema/prefs';
import type { FolderResult } from 'src/server/resolve';
import { PlaceLookupError } from 'src/services/errors';
import { LIBRARY_KEY } from 'src/services/library-store';
import { PlaceLookup } from 'src/services/place-lookup';
import { addFlowAtom, addTargetAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { myLocationAtom, nearbyAtom } from 'src/stores/my-location';
import { nearbyHarness, turnNearbyOn } from '../../helpers/nearby-on';
import { L_FOOD, makePlace, renderLibrary, sampleLibrary, withPlaces } from '../library/fixtures';
import { makeTrip, TRIP, withTrip } from '../trips/planner-fixtures';

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

const SHARE_ID = 'abc123';
const IDS = ['newlab01', 'newplace01', 'newplace02', 'newplace03'];

type FolderPlace = FolderResult['places'][number];
const folderPlace = (n: number, over: Partial<FolderPlace> = {}): FolderPlace => ({
  sid: `900${n}`,
  name: `폴더 장소 ${n}`,
  address: `강원특별자치도 속초시 해맞이로 ${n}`,
  lng: 128.5 + n / 100,
  lat: 38.2,
  memo: '',
  ...over,
});

/** 3곳 중 1곳(9001)은 보관함의 `저장된 장소`(sid 9001)와 같다. */
const threePlaces = (): FolderResult => ({
  folderName: '속초 맛집',
  places: [folderPlace(1), folderPlace(2), folderPlace(3, { memo: '웨이팅 많음' })],
});

type Reply = FolderResult | PlaceLookupError;

/** 가짜 폴더 조회. `reply`가 Promise를 돌려주면 그때까지 "찾는 중"이다. */
function fakeFolderLookup(reply: () => Reply | Promise<Reply>) {
  const calls: string[] = [];
  const layer = Layer.succeed(
    PlaceLookup,
    PlaceLookup.of({
      lookupLink: () => Effect.fail(new PlaceLookupError({ code: 'OFFLINE' })),
      lookupFolder: (shareId) =>
        Effect.promise(async () => {
          calls.push(shareId);
          return reply();
        }).pipe(
          Effect.flatMap((r) =>
            r instanceof PlaceLookupError ? Effect.fail(r) : Effect.succeed(r),
          ),
        ),
    }),
  );
  return { layer, calls };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const panel = () => screen.getByRole('region', { name: '장소 추가' });
const queryPanel = () => screen.queryByRole('region', { name: '장소 추가' });
const importButton = (count: number) =>
  within(panel()).getByRole('button', { name: `${count}곳 가져오기` });
const row = (name: string) => within(panel()).getByRole('checkbox', { name: new RegExp(name) });

const LIST = { libraryView: 'list' as const };

/** 라이브러리를 그리고 폴더 단계로 연다. */
async function openFolder(
  reply: () => Reply | Promise<Reply> = threePlaces,
  options: {
    library?: Library;
    ids?: string[];
    width?: number;
    prefs?: Partial<Prefs>;
    geolocation?: NonNullable<Parameters<typeof renderLibrary>[1]>['geolocation'];
  } = {},
) {
  const user = userEvent.setup();
  const lookup = fakeFolderLookup(reply);
  const library =
    options.library ??
    withPlaces(sampleLibrary(), [makePlace(6, { name: '저장된 장소', sid: '9001' })]);
  const rendered = await renderLibrary(library, {
    ids: options.ids ?? IDS,
    placeLookup: lookup.layer,
    prefs: { ...LIST, ...options.prefs },
    geolocation: options.geolocation,
    ...(options.width === undefined ? {} : { width: options.width }),
  });
  act(() => rendered.store.set(addFlowAtom, { step: 'folder', shareId: SHARE_ID }));
  return { user, lookup, ...rendered };
}

const shownNames = () =>
  within(screen.getByRole('list', { name: '장소 목록' }))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');

describe('폴더 미리보기', () => {
  it('폴더를 찾는 동안 안내하고, 머리글·목록·이미 있음 표시를 보인다', async () => {
    const pending = deferred<Reply>();
    const { lookup } = await openFolder(() => pending.promise);
    // 단계 화면은 처음 열 때 받으므로 한 박자 늦게 나타난다.
    expect(await within(panel()).findByText('장소를 찾는 중…')).toBeInTheDocument();
    await act(async () => pending.resolve(threePlaces()));

    expect(lookup.calls).toEqual([SHARE_ID]);
    expect(
      await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' }),
    ).toBeInTheDocument();
    // 모두 체크된 채 시작한다.
    for (const n of [1, 2, 3]) expect(row(`폴더 장소 ${n}`)).toBeChecked();
    expect(within(panel()).getByText('강원특별자치도 속초시 해맞이로 2')).toBeInTheDocument();
    // 이미 있는 장소(f1)에만 표시가 붙는다.
    expect(within(panel()).getAllByText('이미 있음')).toHaveLength(1);
    expect(within(row('폴더 장소 1').closest('label')!).getByText('이미 있음')).toBeInTheDocument();
    expect(importButton(3)).toBeEnabled();
    // 기본 라벨 이름은 폴더 이름이다.
    expect(within(panel()).getByRole('textbox', { name: '붙일 라벨 이름' })).toHaveValue(
      '속초 맛집',
    );
  });

  it('하나를 해제하고 가져오면 새 1곳·합친 1곳으로 센다', async () => {
    const { user, store } = await openFolder(undefined, { ids: IDS });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    await user.click(row('폴더 장소 3'));
    expect(importButton(2)).toBeEnabled();
    await user.click(importButton(2));

    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('1곳을 새로 넣고, 1곳은 라벨만 더했어요');
    const lib = store.get(libraryAtom);
    // 폴더 이름의 새 라벨이 생기고, 새 장소와 이미 있던 장소에 붙는다.
    expect(lib.labels.newlab01!.name.value).toBe('속초 맛집');
    expect(lib.places.newplace01!.name.value).toBe('폴더 장소 2');
    expect(lib.places.newplace01!.labelIds.value).toEqual(['newlab01']);
    expect(lib.places.place00006!.labelIds.value).toEqual(['newlab01']);
    // 해제한 장소는 들어오지 않는다.
    expect(Object.values(lib.places).some((p) => p.name.value === '폴더 장소 3')).toBe(false);
    expect(queryPanel()).not.toBeInTheDocument();
  });

  it('가져오면 폴더 연결이 남는다: 고르지 않은 곳도 확인한 곳(seenSids)으로 적는다', async () => {
    const { user, store } = await openFolder(undefined, { ids: IDS });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    await user.click(row('폴더 장소 3'));
    await user.click(importButton(2));

    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    const link = store.get(libraryAtom).folders?.[SHARE_ID];
    expect(link).toBeDefined();
    expect(link!.shareId).toBe(SHARE_ID);
    expect(link!.name.value).toBe('속초 맛집');
    expect(link!.labelId.value).toBe('newlab01');
    expect(link!.seenSids.value).toEqual(['9001', '9002', '9003']);
    expect(link!.deletedAt).toBeNull();
  });

  it('기존 라벨을 골라 가져와도 그 라벨에 연결한다', async () => {
    const { user, store } = await openFolder(undefined, { ids: ['newplace01', 'newplace02'] });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    await user.click(within(panel()).getByRole('button', { name: '맛집' }));
    await user.click(importButton(3));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    const link = store.get(libraryAtom).folders?.[SHARE_ID];
    expect(link!.labelId.value).toBe(L_FOOD);
    expect(link!.name.value).toBe('속초 맛집');
  });

  it('여행 대상이 있는 흐름에서도 연결이 남는다', async () => {
    const { user, store } = await openFolder(undefined, {
      library: withTrip(sampleLibrary(), makeTrip()),
      ids: IDS,
    });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    act(() => store.set(addTargetAtom, { tripId: TRIP }));
    await user.click(importButton(3));
    await waitFor(() => expect(queryPanel()).not.toBeInTheDocument());
    const lib = store.get(libraryAtom);
    expect(lib.trips[TRIP]!.candidates.value).toHaveLength(3);
    const link = lib.folders?.[SHARE_ID];
    expect(link!.labelId.value).toBe('newlab01');
    expect(link!.seenSids.value).toEqual(['9001', '9002', '9003']);
  });

  describe('근처 모드', () => {
    it('보관함으로 가져오면 근처 모드를 끄고 새 장소를 보인다(반경과 내 위치는 그대로)', async () => {
      const { fake, geolocation } = nearbyHarness();
      // 폴더 장소는 모두 기준점에서 20km를 넘게 떨어져 있어, 근처 모드가 켜져 있으면 가려진다.
      const { user, store } = await openFolder(undefined, { ids: IDS, geolocation });
      await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
      await turnNearbyOn(store, fake);
      expect(screen.getByRole('group', { name: '반경' })).toBeInTheDocument();

      await user.click(importButton(3));
      await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));

      expect(screen.queryByRole('group', { name: '반경' })).not.toBeInTheDocument();
      const shown = shownNames().join();
      expect(shown).toContain('폴더 장소 2');
      expect(shown).toContain('폴더 장소 3');
      expect(store.get(nearbyAtom)).toEqual({ on: false, radiusM: 3000 });
      expect(store.get(myLocationAtom).fix).not.toBeNull();
    });

    it('여행으로 가져오면 필터를 건드리지 않으므로 근처 모드도 그대로다', async () => {
      const { fake, geolocation } = nearbyHarness();
      const { user, store } = await openFolder(undefined, {
        library: withTrip(sampleLibrary(), makeTrip()),
        ids: IDS,
        geolocation,
      });
      await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
      act(() => store.set(addTargetAtom, { tripId: TRIP }));
      await turnNearbyOn(store, fake);

      await user.click(importButton(3));
      await waitFor(() => expect(queryPanel()).not.toBeInTheDocument());
      expect(store.get(libraryAtom).trips[TRIP]!.candidates.value).toHaveLength(3);
      expect(store.get(nearbyAtom)).toEqual({ on: true, radiusM: 3000 });
    });
  });

  it('모두 새것이면 새로 넣었다는 문장만 쓴다', async () => {
    const { user } = await openFolder(undefined, { library: sampleLibrary() });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    expect(within(panel()).queryByText('이미 있음')).not.toBeInTheDocument();
    await user.click(importButton(3));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('3곳을 새로 넣었어요'));
  });

  it('모두 이미 있으면 라벨만 더했다는 문장만 쓴다', async () => {
    const library = withPlaces(sampleLibrary(), [
      makePlace(11, { sid: '9001' }),
      makePlace(12, { sid: '9002' }),
      makePlace(13, { sid: '9003' }),
    ]);
    const { user } = await openFolder(undefined, { library });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    expect(within(panel()).getAllByText('이미 있음')).toHaveLength(3);
    await user.click(importButton(3));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('3곳은 라벨만 더했어요'));
  });

  it('지운 장소를 되살린 것은 새로 넣은 수에 더한다', async () => {
    const library = withPlaces(sampleLibrary(), [
      makePlace(11, { sid: '9001', deletedAt: '2026-10-09T00:00:00.000Z' }),
    ]);
    const { user, store } = await openFolder(undefined, { library });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    // 지운 장소는 화면에 없으므로 이미 있음으로 보이지 않는다.
    expect(within(panel()).queryByText('이미 있음')).not.toBeInTheDocument();
    await user.click(importButton(3));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('3곳을 새로 넣었어요'));
    expect(store.get(libraryAtom).places.place00011!.deletedAt).toBeNull();
  });

  it('다른 탭이 미리보기 뒤에 같은 장소를 먼저 넣었으면 합친 것으로 센다', async () => {
    const { user, store, storage } = await openFolder(undefined, {
      library: sampleLibrary(),
      ids: IDS,
    });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    expect(within(panel()).queryByText('이미 있음')).not.toBeInTheDocument();

    // 다른 탭이 f2를 저장소에 직접 넣는다(이 탭의 화면 상태는 그대로다).
    const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
    const other = makePlace(20, { name: '다른 탭 장소', sid: '9002' });
    storage.setItem(
      LIBRARY_KEY,
      JSON.stringify({ ...stored, places: { ...stored.places, [other.id]: other } }),
    );
    expect(within(panel()).queryByText('이미 있음')).not.toBeInTheDocument();

    await user.click(importButton(3));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('2곳을 새로 넣고, 1곳은 라벨만 더했어요'),
    );
    const lib = store.get(libraryAtom);
    expect(lib.places[other.id]!.labelIds.value).toEqual(['newlab01']);
    expect(Object.values(lib.places).filter((p) => p.name.value === '폴더 장소 2')).toHaveLength(0);
  });

  it('라벨 이름이 31자면 안내하고 가져오기를 막는다', async () => {
    const { user } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    const name = within(panel()).getByRole('textbox', { name: '붙일 라벨 이름' });
    await user.clear(name);
    await user.type(name, '가'.repeat(31));
    expect(within(panel()).getByText('라벨 이름은 30자까지예요')).toBeInTheDocument();
    expect(importButton(3)).toBeDisabled();

    await user.type(name, '{Backspace}');
    expect(within(panel()).queryByText('라벨 이름은 30자까지예요')).not.toBeInTheDocument();
    expect(importButton(3)).toBeEnabled();
  });

  it('이름을 비우면 가져오기를 막는다', async () => {
    const { user } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    await user.clear(within(panel()).getByRole('textbox', { name: '붙일 라벨 이름' }));
    expect(importButton(3)).toBeDisabled();
  });

  it('기존 라벨을 고르면 입력 대신 그 라벨로 가져오고 새 라벨은 생기지 않는다', async () => {
    const { user, store } = await openFolder(undefined, { ids: ['newplace01', 'newplace02'] });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    const food = within(panel()).getByRole('button', { name: '맛집' });
    await user.click(food);
    expect(food).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel()).getByRole('textbox', { name: '붙일 라벨 이름' })).toBeDisabled();

    await user.click(importButton(3));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    const lib = store.get(libraryAtom);
    expect(Object.keys(lib.labels).sort()).toEqual(['label001', 'label002', 'label003']);
    expect(lib.places.newplace01!.labelIds.value).toEqual([L_FOOD]);
    // 이미 있던 장소는 가진 라벨에 맛집이 더해진다.
    expect(lib.places.place00006!.labelIds.value).toEqual([L_FOOD]);
  });

  it('고른 라벨을 다시 누르면 이름 입력으로 돌아간다', async () => {
    const { user } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    const food = within(panel()).getByRole('button', { name: '맛집' });
    await user.click(food);
    await user.click(food);
    expect(food).toHaveAttribute('aria-pressed', 'false');
    expect(within(panel()).getByRole('textbox', { name: '붙일 라벨 이름' })).toBeEnabled();
  });

  it('31자 이름을 적어 둬도 기존 라벨을 고르면 막지 않는다', async () => {
    const { user } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    const name = within(panel()).getByRole('textbox', { name: '붙일 라벨 이름' });
    await user.clear(name);
    await user.type(name, '가'.repeat(31));
    await user.click(within(panel()).getByRole('button', { name: '카페' }));
    expect(within(panel()).queryByText('라벨 이름은 30자까지예요')).not.toBeInTheDocument();
    expect(importButton(3)).toBeEnabled();
  });

  it('전체 해제하면 가져오기가 비활성이고, 전체 선택하면 다시 켜진다', async () => {
    const { user } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    await user.click(within(panel()).getByRole('button', { name: '전체 해제' }));
    for (const n of [1, 2, 3]) expect(row(`폴더 장소 ${n}`)).not.toBeChecked();
    expect(importButton(0)).toBeDisabled();

    await user.click(within(panel()).getByRole('button', { name: '전체 선택' }));
    for (const n of [1, 2, 3]) expect(row(`폴더 장소 ${n}`)).toBeChecked();
    expect(importButton(3)).toBeEnabled();
  });

  it('가져온 뒤 목록이 그 라벨로 걸러지고, 검색어·지역 필터는 비워진다', async () => {
    const { user } = await openFolder(undefined, {
      prefs: { query: { ...DEFAULT_QUERY, text: '저장된', regions: ['없는 지역'] } },
    });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    // 검색어·지역이 걸린 상태에서는 가져올 장소들이 보이지 않는다.
    expect(screen.getByRole('searchbox')).toHaveValue('저장된');
    expect(screen.queryByRole('list', { name: '장소 목록' })).not.toBeInTheDocument();
    await user.click(importButton(3));
    await waitFor(() => expect(queryPanel()).not.toBeInTheDocument());
    await waitFor(() => expect(shownNames()).toHaveLength(3));
    expect(shownNames().some((text) => text.includes('폴더 장소 2'))).toBe(true);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', {
        name: /^속초 맛집/,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('가 본 곳 필터를 켠 채 가져오면 방문 필터가 풀려 새 장소가 보인다', async () => {
    const { user } = await openFolder(undefined, {
      prefs: { query: { ...DEFAULT_QUERY, visited: 'visited' } },
    });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    await user.click(importButton(3));
    await waitFor(() => expect(queryPanel()).not.toBeInTheDocument());
    await waitFor(() => expect(shownNames()).toHaveLength(3));
    expect(shownNames().some((text) => text.includes('폴더 장소 2'))).toBe(true);
  });

  it('기존 라벨로 가져오면 그 라벨 하나로만 거른다', async () => {
    const { user } = await openFolder(undefined, { ids: ['newplace01', 'newplace02'] });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    await user.click(within(panel()).getByRole('button', { name: '카페' }));
    await user.click(importButton(3));
    await waitFor(() => expect(queryPanel()).not.toBeInTheDocument());
    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name: /^카페/ }),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name: /^맛집/ }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('가져오기를 빠르게 두 번 눌러도 한 번만 넣고, 저장 중에는 취소도 막는다', async () => {
    const { store } = await openFolder(undefined, { library: sampleLibrary() });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    const button = importButton(3);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(within(panel()).getByRole('button', { name: '취소' })).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(store.get(libraryAtom).places)).toHaveLength(8);
  });

  it('취소하면 아무것도 넣지 않고 닫는다', async () => {
    const { user, store } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(Object.keys(store.get(libraryAtom).places)).toHaveLength(6);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('저장 중에 흐름이 닫혀도 결과 토스트는 띄우되 흐름·필터는 건드리지 않는다', async () => {
    const { store } = await openFolder(undefined, { library: sampleLibrary() });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    // 저장이 끝나기 전에 바깥에서(예: 칸의 닫기 버튼) 흐름을 닫는다.
    fireEvent.click(importButton(3));
    act(() => store.set(addFlowAtom, { step: 'closed' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('3곳을 새로 넣었어요'));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    // 가져온 것은 들어왔지만 목록은 라벨로 걸러지지 않았다.
    expect(Object.keys(store.get(libraryAtom).places)).toHaveLength(8);
    expect(shownNames()).toHaveLength(8);
    expect(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', {
        name: /^속초 맛집/,
      }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('고른 기존 라벨을 다른 탭이 그사이 지웠으면 같은 이름의 라벨로 가져온다', async () => {
    const { user, store, storage } = await openFolder(undefined, { library: sampleLibrary() });
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    await user.click(within(panel()).getByRole('button', { name: '맛집' }));

    // 다른 탭이 `맛집` 라벨을 지운다(장소에서도 떼어진다). 이 탭의 화면 상태는 그대로다.
    const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
    storage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        ...stored,
        labels: {
          ...stored.labels,
          [L_FOOD]: { ...stored.labels[L_FOOD]!, deletedAt: '2026-10-12T00:00:00.000Z' },
        },
        places: Object.fromEntries(
          Object.entries(stored.places).map(([id, place]) => [
            id,
            {
              ...place,
              labelIds: {
                ...place.labelIds,
                value: place.labelIds.value.filter((labelId) => labelId !== L_FOOD),
              },
            },
          ]),
        ),
      }),
    );

    await user.click(importButton(3));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock).toHaveBeenCalledWith('3곳을 새로 넣었어요');
    const lib = store.get(libraryAtom);
    const made = lib.labels.newlab01!;
    expect(made.name.value).toBe('맛집');
    expect(made.deletedAt).toBeNull();
    expect(lib.places.newplace01!.labelIds.value).toEqual(['newlab01']);
  });
});

describe('폴더 조회 오류', () => {
  it('TOO_MANY_PLACES는 문구만 보이고 다시 시도는 주지 않는다', async () => {
    await openFolder(() => new PlaceLookupError({ code: 'TOO_MANY_PLACES' }));
    expect(
      await within(panel()).findByText('장소가 너무 많은 폴더예요(최대 1,000곳)'),
    ).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: '취소' })).toBeEnabled();
  });

  it('NOT_FOUND는 문구만 보인다', async () => {
    await openFolder(() => new PlaceLookupError({ code: 'NOT_FOUND' }));
    expect(
      await within(panel()).findByText('장소를 찾지 못했어요. 링크를 다시 확인해 주세요'),
    ).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
  });

  it('UPSTREAM_ERROR는 다시 시도를 주고, 누르면 다시 조회해 미리보기를 보인다', async () => {
    let n = 0;
    const { user, lookup } = await openFolder(() =>
      ++n === 1 ? new PlaceLookupError({ code: 'UPSTREAM_ERROR' }) : threePlaces(),
    );
    expect(
      await within(panel()).findByText(
        '지금은 장소 정보를 가져오지 못했어요. 잠시 뒤 다시 해 주세요',
      ),
    ).toBeInTheDocument();
    expect(
      within(panel()).queryByRole('button', { name: '지도에서 핀으로 추가' }),
    ).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole('button', { name: '다시 시도' }));
    expect(
      await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' }),
    ).toBeInTheDocument();
    expect(lookup.calls).toEqual([SHARE_ID, SHARE_ID]);
  });

  it('OFFLINE도 다시 시도를 준다', async () => {
    await openFolder(() => new PlaceLookupError({ code: 'OFFLINE' }));
    expect(
      await within(panel()).findByText('인터넷 연결을 확인하고 다시 시도해 주세요'),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: '다시 시도' })).toBeEnabled();
  });

  it('찾는 중에 닫으면 늦게 온 결과를 무시한다', async () => {
    const pending = deferred<Reply>();
    const { user, store } = await openFolder(() => pending.promise);
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    await act(async () => pending.resolve(threePlaces()));
    expect(queryPanel()).not.toBeInTheDocument();
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
  });
});

describe('빈 폴더', () => {
  it('안내를 보이고 전체 선택은 선택 상태가 아니며 가져오기는 막힌다', async () => {
    await openFolder(() => ({ folderName: '빈 폴더', places: [] }));
    expect(await within(panel()).findByRole('heading', { name: '빈 폴더 · 0곳' })).toBeVisible();
    expect(within(panel()).getByText('가져올 장소가 없는 폴더예요')).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: '전체 선택' })).toBeInTheDocument();
    expect(importButton(0)).toBeDisabled();
  });
});

describe('폴더 미리보기 자리', () => {
  it('좁은 화면에서는 아래 시트로 열고 높이는 90vh다', async () => {
    await openFolder(undefined, { width: 390 });
    const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
    expect(
      await within(sheet).findByRole('heading', { name: '속초 맛집 · 3곳' }),
    ).toBeInTheDocument();
    expect(queryPanel()).not.toBeInTheDocument();
    // jsdom은 vh를 화면 높이로 풀어 보여 준다.
    expect(sheet).toHaveStyle({ height: `${window.innerHeight * 0.9}px` });
  });

  it('넓은 화면에서는 오른쪽 칸에 열린다', async () => {
    await openFolder();
    expect(await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' })).toBeVisible();
  });
});
