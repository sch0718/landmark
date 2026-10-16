import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUERY } from 'src/domain/library/query';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { localDate } from 'src/lib/local-date';
import type { FolderLink, Library } from 'src/schema/library';
import type { Prefs } from 'src/schema/prefs';
import type { FolderResult } from 'src/server/resolve';
import { PlaceLookupError } from 'src/services/errors';
import { LIBRARY_KEY } from 'src/services/library-store';
import { PlaceLookup } from 'src/services/place-lookup';
import { addFlowAtom, addTargetAtom } from 'src/stores/add-place';
import { queryDraftAtom } from 'src/stores/library-query-draft';
import { libraryAtom } from 'src/stores/library-state';
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
const IDS = ['newplace01', 'newplace02', 'newplace03'];
const CHECKED_AT = '2026-10-12T03:00:00.000Z';
const CHECKED_DAY = localDate(CHECKED_AT);

type FolderPlace = FolderResult['places'][number];
const folderPlace = (n: number): FolderPlace => ({
  sid: `900${n}`,
  name: `폴더 장소 ${n}`,
  address: `강원특별자치도 속초시 해맞이로 ${n}`,
  lng: 128.5 + n / 100,
  lat: 38.2,
  memo: '',
});

const threePlaces = (): FolderResult => ({
  folderName: '속초 맛집',
  places: [folderPlace(1), folderPlace(2), folderPlace(3)],
});

type Reply = FolderResult | PlaceLookupError;

/** 가짜 폴더 조회. 부를 때마다 공유 ID와 `fresh` 여부를 적는다. */
function fakeFolderLookup(reply: () => Reply | Promise<Reply>) {
  const calls: { shareId: string; fresh: boolean }[] = [];
  const layer = Layer.succeed(
    PlaceLookup,
    PlaceLookup.of({
      lookupLink: () => Effect.fail(new PlaceLookupError({ code: 'OFFLINE' })),
      lookupFolder: (shareId, options) =>
        Effect.promise(async () => {
          calls.push({ shareId, fresh: options?.fresh === true });
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

const link = (seenSids: string[], over: Partial<FolderLink> = {}): FolderLink => ({
  shareId: SHARE_ID,
  name: { value: '속초 맛집', updatedAt: CHECKED_AT },
  labelId: { value: L_FOOD, updatedAt: CHECKED_AT },
  seenSids: { value: seenSids, updatedAt: CHECKED_AT },
  checkedAt: CHECKED_AT,
  createdAt: CHECKED_AT,
  deletedAt: null,
  ...over,
});

/** 보관함에 9001·9002가 있고, 폴더 `abc123`이 `맛집` 라벨에 연결돼 그 둘을 봤다. */
function linkedLibrary(
  options: { seenSids?: string[]; places?: Parameters<typeof withPlaces>[1]; base?: Library } = {},
): Library {
  const lib = withPlaces(
    options.base ?? sampleLibrary(),
    options.places ?? [
      makePlace(6, { name: '저장된 장소 1', sid: '9001', labelIds: [L_FOOD] }),
      makePlace(7, { name: '저장된 장소 2', sid: '9002', labelIds: [L_FOOD] }),
    ],
  );
  return { ...lib, folders: { [SHARE_ID]: link(options.seenSids ?? ['9001', '9002']) } };
}

const panel = () => screen.getByRole('region', { name: '장소 추가' });
const queryPanel = () => screen.queryByRole('region', { name: '장소 추가' });
const listOf = (name: string) => within(panel()).getByRole('list', { name });
const rowIn = (list: string, name: string) =>
  within(listOf(list)).getByRole('checkbox', { name: new RegExp(name) });

async function openFolder(
  reply: () => Reply | Promise<Reply> = threePlaces,
  options: {
    library?: Library;
    ids?: string[];
    prefs?: Partial<Prefs>;
    target?: { tripId: string };
  } = {},
) {
  const user = userEvent.setup();
  const lookup = fakeFolderLookup(reply);
  const rendered = await renderLibrary(options.library ?? linkedLibrary(), {
    ids: options.ids ?? IDS,
    placeLookup: lookup.layer,
    prefs: { libraryView: 'list', ...options.prefs },
  });
  act(() => {
    if (options.target !== undefined) rendered.store.set(addTargetAtom, options.target);
    rendered.store.set(addFlowAtom, { step: 'folder', shareId: SHARE_ID });
  });
  return { user, lookup, ...rendered };
}

const placeCount = (lib: Library) => Object.keys(lib.places).length;

describe('폴더 다시 가져오기', () => {
  it('새로 저장한 곳만 체크해 보이고, 가져오면 본 장소를 바꾸고 보관함에서 보기를 준다', async () => {
    const { user, store, lookup, router } = await openFolder(undefined, {
      prefs: { query: { ...DEFAULT_QUERY, visited: 'visited' } },
    });
    expect(await within(panel()).findByRole('heading', { name: '속초 맛집' })).toBeVisible();
    expect(lookup.calls).toEqual([{ shareId: SHARE_ID, fresh: true }]);
    expect(within(panel()).getByText(`‘맛집’ 라벨 · 지난 확인 ${CHECKED_DAY}`)).toBeInTheDocument();
    expect(
      within(panel()).getByText('새로 저장한 곳 1 · 그대로 2 · 폴더에서 빠진 곳 0'),
    ).toBeInTheDocument();
    const fresh = within(listOf('새로 저장한 곳')).getAllByRole('checkbox');
    expect(fresh).toHaveLength(1);
    expect(rowIn('새로 저장한 곳', '폴더 장소 3')).toBeChecked();
    expect(within(panel()).queryByRole('list', { name: '보관함에서 지운 곳' })).toBeNull();
    expect(within(panel()).queryByRole('list', { name: '폴더에서 빠진 곳' })).toBeNull();
    expect(within(panel()).getByRole('button', { name: '전체 해제' })).toBeInTheDocument();

    await user.click(within(panel()).getByRole('button', { name: '1곳 가져오기' }));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('1곳을 새로 넣었어요', {
      action: { label: '보관함에서 보기', onClick: expect.any(Function) },
    });
    const lib = store.get(libraryAtom);
    expect(lib.folders![SHARE_ID]!.seenSids.value).toEqual(['9001', '9002', '9003']);
    expect(lib.places.newplace01!.name.value).toBe('폴더 장소 3');
    expect(lib.places.newplace01!.labelIds.value).toEqual([L_FOOD]);
    // 지금 화면의 필터는 바로 바꾸지 않는다.
    expect(store.get(queryDraftAtom)?.visited ?? 'visited').toBe('visited');

    const [, options] = toastMock.mock.calls[0] as [string, { action: { onClick: () => void } }];
    act(() => options.action.onClick());
    const query = store.get(queryDraftAtom)!;
    expect(query.labelIds).toEqual([L_FOOD]);
    expect(query.visited).toBe('all');
    expect(query.text).toBe('');
    expect(query.regions).toEqual([]);
    expect(query.unlabeled).toBe(false);
    expect(router.state.location.pathname).toBe('/');
  });

  it('보관함에서 지운 곳은 따로 묶어 체크 없이 보이고, 고르면 되살린다', async () => {
    const library = linkedLibrary({
      places: [
        makePlace(6, { name: '저장된 장소 1', sid: '9001', labelIds: [L_FOOD] }),
        makePlace(7, { name: '지운 장소', sid: '9002', deletedAt: '2026-10-13T00:00:00.000Z' }),
      ],
    });
    const { user, store } = await openFolder(undefined, { library });
    await within(panel()).findByRole('heading', { name: '속초 맛집' });
    expect(
      within(panel()).getByText('새로 저장한 곳 1 · 그대로 1 · 폴더에서 빠진 곳 0'),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('heading', { name: '보관함에서 지운 곳' })).toBeVisible();
    expect(
      within(panel()).getByText('전에 가져왔다가 보관함에서 지운 곳이에요. 다시 넣으려면 고르세요'),
    ).toBeInTheDocument();
    expect(rowIn('보관함에서 지운 곳', '폴더 장소 2')).not.toBeChecked();

    await user.click(rowIn('새로 저장한 곳', '폴더 장소 3'));
    expect(within(panel()).getByRole('button', { name: '확인했어요' })).toBeEnabled();
    await user.click(rowIn('보관함에서 지운 곳', '폴더 장소 2'));
    await user.click(within(panel()).getByRole('button', { name: '1곳 가져오기' }));

    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock).toHaveBeenCalledWith('1곳을 새로 넣었어요', expect.anything());
    const lib = store.get(libraryAtom);
    expect(lib.places.place00007!.deletedAt).toBeNull();
    expect(lib.places.place00007!.labelIds.value).toEqual([L_FOOD]);
    // 고르지 않은 새 곳은 넣지 않지만 본 장소에는 적는다.
    expect(Object.values(lib.places).some((p) => p.name.value === '폴더 장소 3')).toBe(false);
    expect(lib.folders![SHARE_ID]!.seenSids.value).toEqual(['9001', '9002', '9003']);
  });

  it('폴더에서 빠졌지만 보관함에 살아 있는 곳은 이름만 보이고 체크박스가 없다', async () => {
    const library = linkedLibrary({
      seenSids: ['9001', '9002', '9004'],
      places: [
        makePlace(6, { name: '저장된 장소 1', sid: '9001', labelIds: [L_FOOD] }),
        makePlace(7, { name: '저장된 장소 2', sid: '9002', labelIds: [L_FOOD] }),
        makePlace(8, { name: '빠진 장소', sid: '9004', labelIds: [L_FOOD] }),
      ],
    });
    await openFolder(undefined, { library });
    await within(panel()).findByRole('heading', { name: '속초 맛집' });
    expect(
      within(panel()).getByText('새로 저장한 곳 1 · 그대로 2 · 폴더에서 빠진 곳 1'),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('heading', { name: '폴더에서 빠진 곳' })).toBeVisible();
    expect(
      within(panel()).getByText('네이버 폴더에서는 빠졌지만 보관함에서는 지우지 않았어요'),
    ).toBeInTheDocument();
    const missing = listOf('폴더에서 빠진 곳');
    expect(within(missing).getByText('빠진 장소')).toBeInTheDocument();
    expect(within(missing).queryByRole('checkbox')).toBeNull();
  });

  it('새로 저장한 곳이 없으면 안내하고 확인했어요로 확인한 시각만 새로 쓴다', async () => {
    const library = linkedLibrary({
      seenSids: ['9001', '9002', '9003'],
      places: [
        makePlace(6, { name: '저장된 장소 1', sid: '9001', labelIds: [L_FOOD] }),
        makePlace(7, { name: '저장된 장소 2', sid: '9002', labelIds: [L_FOOD] }),
        makePlace(8, { name: '저장된 장소 3', sid: '9003', labelIds: [L_FOOD] }),
      ],
    });
    const { user, store } = await openFolder(undefined, { library });
    await within(panel()).findByRole('heading', { name: '속초 맛집' });
    expect(
      within(panel()).getByText(`${CHECKED_DAY} 뒤로 새로 저장한 곳이 없어요`),
    ).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: '전체 선택' })).toBeNull();
    expect(within(panel()).queryByRole('button', { name: '전체 해제' })).toBeNull();

    await user.click(within(panel()).getByRole('button', { name: '확인했어요' }));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('‘속초 맛집’ 폴더를 확인했어요');
    const lib = store.get(libraryAtom);
    expect(lib.folders![SHARE_ID]!.checkedAt).not.toBe(CHECKED_AT);
    expect(placeCount(lib)).toBe(8);
  });

  it('전체 해제·전체 선택은 새로 저장한 곳만 바꾼다', async () => {
    const { user } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집' });
    await user.click(within(panel()).getByRole('button', { name: '전체 해제' }));
    expect(rowIn('새로 저장한 곳', '폴더 장소 3')).not.toBeChecked();
    expect(within(panel()).getByRole('button', { name: '확인했어요' })).toBeEnabled();
    await user.click(within(panel()).getByRole('button', { name: '전체 선택' }));
    expect(rowIn('새로 저장한 곳', '폴더 장소 3')).toBeChecked();
  });

  it('빠르게 두 번 눌러도 한 번만 가져온다', async () => {
    const { store } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집' });
    const button = within(panel()).getByRole('button', { name: '1곳 가져오기' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(within(panel()).getByRole('button', { name: '취소' })).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(placeCount(store.get(libraryAtom))).toBe(8);
  });

  it('폴더 전체 보기는 읽은 결과로 지금의 미리보기를 연다', async () => {
    const { user, lookup } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집' });
    await user.click(within(panel()).getByRole('button', { name: '폴더 전체 보기' }));
    expect(
      await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' }),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('list', { name: '가져올 장소' })).toBeInTheDocument();
    expect(lookup.calls).toHaveLength(1);
  });

  it('연결된 라벨 이름이 폴더 이름과 달라도 폴더 전체 보기의 기본 가져오기는 그 라벨에 붙인다', async () => {
    const base = linkedLibrary();
    const library: Library = {
      ...base,
      labels: {
        ...base.labels,
        [L_FOOD]: {
          ...base.labels[L_FOOD]!,
          name: { value: '속초 단골집', updatedAt: CHECKED_AT },
        },
      },
    };
    const labelCount = Object.keys(library.labels).length;
    // 새 라벨을 만들지 않으므로 장소 id만 쓴다(라벨 id를 만들려 하면 형식이 맞지 않아 거절된다).
    const { user, store } = await openFolder(undefined, { library });
    await within(panel()).findByRole('heading', { name: '속초 맛집' });
    await user.click(within(panel()).getByRole('button', { name: '폴더 전체 보기' }));
    await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' });
    await user.click(within(panel()).getByRole('button', { name: '3곳 가져오기' }));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    const lib = store.get(libraryAtom);
    expect(Object.keys(lib.labels)).toHaveLength(labelCount);
    expect(lib.folders![SHARE_ID]!.labelId.value).toBe(L_FOOD);
    const imported = Object.values(lib.places).find((p) => p.name.value === '폴더 장소 3')!;
    expect(imported.labelIds.value).toEqual([L_FOOD]);
  });

  it('취소하면 아무것도 바꾸지 않고 닫는다', async () => {
    const { user, store } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집' });
    const before = store.get(libraryAtom);
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(store.get(libraryAtom)).toBe(before);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('여행 대상이 있는 흐름은 연결돼 있어도 지금의 미리보기를 열고 그 여행의 후보에 넣는다', async () => {
    const { user, store, lookup } = await openFolder(undefined, {
      library: linkedLibrary({ base: withTrip(sampleLibrary(), makeTrip()) }),
      ids: ['newlab01', 'newplace01'],
      target: { tripId: TRIP },
    });
    expect(
      await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' }),
    ).toBeInTheDocument();
    expect(lookup.calls).toEqual([{ shareId: SHARE_ID, fresh: false }]);
    await user.click(within(panel()).getByRole('button', { name: '3곳 가져오기' }));
    await waitFor(() => expect(queryPanel()).not.toBeInTheDocument());
    expect(store.get(libraryAtom).trips[TRIP]!.candidates.value).toHaveLength(3);
  });

  it('누르는 사이 다른 탭이 연결을 끊었으면 칸 안에 알리고 넣지 않으며 단추를 다시 켠다', async () => {
    const { user, store, storage } = await openFolder();
    await within(panel()).findByRole('heading', { name: '속초 맛집' });
    const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
    storage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        ...stored,
        folders: {
          [SHARE_ID]: { ...stored.folders![SHARE_ID]!, deletedAt: '2026-10-15T00:00:00.000Z' },
        },
      }),
    );
    const before = placeCount(store.get(libraryAtom));
    await user.click(within(panel()).getByRole('button', { name: '1곳 가져오기' }));
    expect(await within(panel()).findByRole('alert')).toHaveTextContent(
      '폴더 연결이 바뀌었어요. 창을 닫고 다시 열어 주세요',
    );
    expect(within(panel()).getByRole('button', { name: '1곳 가져오기' })).toBeEnabled();
    expect(placeCount(store.get(libraryAtom))).toBe(before);
    expect(toastMock).not.toHaveBeenCalled();
    expect(store.get(addFlowAtom)).toEqual({ step: 'folder', shareId: SHARE_ID });
  });
});

describe('연결된 폴더를 읽는 중·오류', () => {
  it('읽는 중에는 다시 가져오기 제목과 안내를 보인다', async () => {
    const pending = deferred<Reply>();
    await openFolder(() => pending.promise);
    expect(
      await within(panel()).findByRole('heading', { name: '네이버 폴더 다시 가져오기' }),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('status')).toHaveTextContent('새로 저장한 곳을 찾는 중…');
    await act(async () => pending.resolve(threePlaces()));
    expect(await within(panel()).findByRole('heading', { name: '속초 맛집' })).toBeVisible();
  });

  it('NOT_FOUND면 다른 문구와 연결 끊기를 주고, 누르면 끊고 닫는다', async () => {
    const { user, store } = await openFolder(() => new PlaceLookupError({ code: 'NOT_FOUND' }));
    expect(
      await within(panel()).findByText(
        '폴더를 찾지 못했어요. 네이버 지도에서 폴더 공유를 껐거나 폴더를 지웠을 수 있어요',
      ),
    ).toBeInTheDocument();
    expect(
      within(panel()).getByRole('heading', { name: '네이버 폴더 다시 가져오기' }),
    ).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: '다시 시도' })).toBeNull();
    await user.click(within(panel()).getByRole('button', { name: '연결 끊기' }));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(store.get(libraryAtom).folders![SHARE_ID]!.deletedAt).not.toBeNull();
    expect(toastMock).toHaveBeenCalledWith('폴더 연결을 끊었어요. 라벨과 장소는 그대로예요');
  });

  it('UPSTREAM_ERROR면 다시 시도도 새로 읽는다', async () => {
    let n = 0;
    const { user, lookup } = await openFolder(() =>
      ++n === 1 ? new PlaceLookupError({ code: 'UPSTREAM_ERROR' }) : threePlaces(),
    );
    await user.click(await within(panel()).findByRole('button', { name: '다시 시도' }));
    expect(await within(panel()).findByRole('heading', { name: '속초 맛집' })).toBeVisible();
    expect(lookup.calls).toEqual([
      { shareId: SHARE_ID, fresh: true },
      { shareId: SHARE_ID, fresh: true },
    ]);
  });

  it('연결이 없는 폴더의 NOT_FOUND는 지금 문구 그대로이고 연결 끊기가 없다', async () => {
    const { lookup } = await openFolder(() => new PlaceLookupError({ code: 'NOT_FOUND' }), {
      library: sampleLibrary(),
    });
    expect(
      await within(panel()).findByText('장소를 찾지 못했어요. 링크를 다시 확인해 주세요'),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('heading', { name: '네이버 폴더 가져오기' })).toBeVisible();
    expect(within(panel()).queryByRole('button', { name: '연결 끊기' })).toBeNull();
    expect(lookup.calls).toEqual([{ shareId: SHARE_ID, fresh: false }]);
  });

  it('연결이 지워진 폴더는 첫 가져오기로 읽는다', async () => {
    const library: Library = {
      ...linkedLibrary(),
      folders: { [SHARE_ID]: link(['9001', '9002'], { deletedAt: CHECKED_AT }) },
    };
    const { lookup } = await openFolder(undefined, { library });
    expect(
      await within(panel()).findByRole('heading', { name: '속초 맛집 · 3곳' }),
    ).toBeInTheDocument();
    expect(lookup.calls).toEqual([{ shareId: SHARE_ID, fresh: false }]);
  });
});
