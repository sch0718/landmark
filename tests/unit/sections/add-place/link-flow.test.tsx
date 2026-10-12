import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { FolderRef, ResolvedPlace } from 'src/server/resolve';
import { PlaceLookupError } from 'src/services/errors';
import { LIBRARY_KEY } from 'src/services/library-store';
import { PlaceLookup } from 'src/services/place-lookup';
import { ReverseGeocoder } from 'src/services/reverse-geocoder';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { installMapResources } from '../../components/helpers/map-resources';
import {
  L_CAFE,
  L_FOOD,
  makePlace,
  renderLibrary,
  sampleLibrary,
  withPlaces,
} from '../library/fixtures';

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

const SHARE_TEXT = '[네이버 지도]\n콤포트\nhttps://naver.me/Fk73Vab5';
const NEW_ID = 'newplace01';

const naverPlace = (over: Partial<ResolvedPlace> = {}): ResolvedPlace => ({
  kind: 'place',
  provider: 'naver',
  providerId: '1958911015',
  name: '콤포트',
  address: '서울특별시 용산구 두텁바위로60길 45',
  lng: 126.977,
  lat: 37.546,
  category: '카페,디저트',
  ...over,
});

type Reply = ResolvedPlace | FolderRef | PlaceLookupError;

/** 가짜 장소 조회. `reply`가 Promise를 돌려주면 그때까지 "찾는 중"이다. 받은 링크는 `calls`에 쌓인다. */
function fakeLookup(reply: (url: string) => Reply | Promise<Reply>) {
  const calls: string[] = [];
  const layer = Layer.succeed(
    PlaceLookup,
    PlaceLookup.of({
      lookupLink: (url) =>
        Effect.promise(async () => {
          calls.push(url);
          return reply(url);
        }).pipe(
          Effect.flatMap((r) =>
            r instanceof PlaceLookupError ? Effect.fail(r) : Effect.succeed(r),
          ),
        ),
      lookupFolder: () => Effect.fail(new PlaceLookupError({ code: 'OFFLINE' })),
    }),
  );
  return { layer, calls };
}

const fakeReverse = (address: string | null) =>
  Layer.succeed(ReverseGeocoder, ReverseGeocoder.of({ reverse: () => Effect.succeed(address) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const panel = () => screen.getByRole('region', { name: '장소 추가' });
const queryPanel = () => screen.queryByRole('region', { name: '장소 추가' });
const placeCount = (lib: Library) => Object.keys(lib.places).length;

/** ＋추가 → 시트 항목을 고른다. */
async function openFrom(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole('button', { name: '장소 추가' }));
  const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
  await user.click(within(sheet).getByRole('button', { name: new RegExp(item) }));
  await waitFor(() => expect(sheet).not.toBeInTheDocument());
}

/** 입력에 붙여 넣고 `확인`. */
async function submitLink(user: ReturnType<typeof userEvent.setup>, text = SHARE_TEXT) {
  const input = within(panel()).getByRole('textbox', { name: '링크' });
  await user.click(input);
  await user.paste(text);
  await user.click(within(panel()).getByRole('button', { name: '확인' }));
}

async function openCard(
  reply: (url: string) => Reply | Promise<Reply> = () => naverPlace(),
  options: { library?: Library; reverse?: string | null; ids?: string[] } = {},
) {
  const user = userEvent.setup();
  const lookup = fakeLookup(reply);
  const rendered = await renderLibrary(options.library ?? sampleLibrary(), {
    ids: options.ids ?? [NEW_ID],
    placeLookup: lookup.layer,
    ...(options.reverse === undefined ? {} : { reverseGeocoder: fakeReverse(options.reverse) }),
  });
  await openFrom(user, '링크 붙여넣기');
  await submitLink(user);
  return { user, lookup, ...rendered };
}

describe('링크 입력', () => {
  it('공유 문구를 붙여 넣으면 링크만 조회하고, 찾는 중에는 버튼을 막은 뒤 카드를 보인다', async () => {
    const user = userEvent.setup();
    const pending = deferred<Reply>();
    const lookup = fakeLookup(() => pending.promise);
    const { store } = await renderLibrary(sampleLibrary(), { placeLookup: lookup.layer });

    await openFrom(user, '링크 붙여넣기');
    expect(store.get(addFlowAtom)).toEqual({ step: 'link', hint: 'place' });
    expect(within(panel()).getByText('링크를 붙여 넣어 주세요')).toBeInTheDocument();
    const confirm = within(panel()).getByRole('button', { name: '확인' });
    expect(confirm).toBeDisabled();

    // 링크가 없는 글이면 여전히 막혀 있다.
    await user.type(within(panel()).getByRole('textbox', { name: '링크' }), '콤포트');
    expect(confirm).toBeDisabled();
    await user.clear(within(panel()).getByRole('textbox', { name: '링크' }));

    await submitLink(user);
    expect(lookup.calls).toEqual(['https://naver.me/Fk73Vab5']);
    expect(within(panel()).getByText('장소를 찾는 중…')).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: '확인' })).toBeDisabled();

    await act(async () => pending.resolve(naverPlace()));
    const card = panel();
    expect(await within(card).findByRole('heading', { name: '콤포트' })).toBeInTheDocument();
    expect(within(card).getByText('네이버')).toBeInTheDocument();
    expect(within(card).getByText('카페,디저트')).toBeInTheDocument();
    expect(within(card).getByRole('textbox', { name: '주소' })).toHaveValue(
      '서울특별시 용산구 두텁바위로60길 45',
    );
    expect(store.get(addFlowAtom)).toMatchObject({
      step: 'candidate',
      candidate: { source: { kind: 'naver', sid: '1958911015' }, name: '콤포트' },
    });
  });

  it('폴더 항목으로 열면 폴더 안내를 보이고, 폴더 링크면 폴더 단계로 넘어간다', async () => {
    const user = userEvent.setup();
    const lookup = fakeLookup(() => ({ kind: 'folder', shareId: 'abc123' }));
    const { store } = await renderLibrary(sampleLibrary(), { placeLookup: lookup.layer });

    await openFrom(user, '네이버 폴더 가져오기');
    expect(store.get(addFlowAtom)).toEqual({ step: 'link', hint: 'folder' });
    expect(
      within(panel()).getByText('네이버 공유 폴더 링크를 붙여 넣어 주세요'),
    ).toBeInTheDocument();
    expect(within(panel()).queryByText('링크를 붙여 넣어 주세요')).not.toBeInTheDocument();

    await submitLink(user, 'https://naver.me/5Iiuye7j');
    await waitFor(() =>
      expect(store.get(addFlowAtom)).toEqual({ step: 'folder', shareId: 'abc123' }),
    );
  });

  it('장소 링크 항목으로 열어도 폴더 링크면 폴더 단계로 간다', async () => {
    const user = userEvent.setup();
    const lookup = fakeLookup(() => ({ kind: 'folder', shareId: 'xyz' }));
    const { store } = await renderLibrary(sampleLibrary(), { placeLookup: lookup.layer });
    await openFrom(user, '링크 붙여넣기');
    await submitLink(user, 'https://naver.me/5Iiuye7j');
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'folder', shareId: 'xyz' }));
  });

  it('지도에서 핀 찍기 항목은 핀 단계로 시작하고 시트를 닫는다', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary());
    await openFrom(user, '지도에서 핀 찍기');
    expect(store.get(addFlowAtom)).toEqual({ step: 'pin', name: '', start: null });
  });

  it('취소하면 흐름을 닫는다', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary());
    await openFrom(user, '링크 붙여넣기');
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(queryPanel()).not.toBeInTheDocument();
  });

  it('찾는 중에 닫으면 늦게 온 결과를 무시한다', async () => {
    const user = userEvent.setup();
    const pending = deferred<Reply>();
    const lookup = fakeLookup(() => pending.promise);
    const { store } = await renderLibrary(sampleLibrary(), { placeLookup: lookup.layer });
    await openFrom(user, '링크 붙여넣기');
    await submitLink(user);
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    // 다시 열어도 지난 요청 결과가 끼어들지 않는다.
    await openFrom(user, '링크 붙여넣기');
    await act(async () => pending.resolve(naverPlace()));
    expect(store.get(addFlowAtom)).toEqual({ step: 'link', hint: 'place' });
    expect(within(panel()).getByRole('textbox', { name: '링크' })).toHaveValue('');
  });

  it('좁은 화면에서는 아래 시트로 연다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { width: 390 });
    await openFrom(user, '링크 붙여넣기');
    const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
    expect(within(sheet).getByRole('textbox', { name: '링크' })).toBeInTheDocument();
    expect(queryPanel()).not.toBeInTheDocument();
  });

  it('상세가 열려 있어도 추가 흐름이 그 자리를 쓰고, 닫으면 상세가 돌아온다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { path: '/place/place00001' });
    expect(screen.getByRole('region', { name: '장소 상세' })).toBeInTheDocument();
    await openFrom(user, '링크 붙여넣기');
    expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(screen.getByRole('region', { name: '장소 상세' })).toBeInTheDocument();
  });
});

describe('조회 오류', () => {
  const failWith = (error: PlaceLookupError) => () => error;

  it.each([
    ['UNSUPPORTED_LINK', '네이버·카카오·구글 지도의 장소 링크만 넣을 수 있어요'],
    ['NOT_FOUND', '장소를 찾지 못했어요. 링크를 다시 확인해 주세요'],
  ] as const)('%s는 문구만 보이고 입력을 유지한다', async (code, message) => {
    await openCard(failWith(new PlaceLookupError({ code })));
    expect(await within(panel()).findByText(message)).toBeInTheDocument();
    expect(within(panel()).getByRole('textbox', { name: '링크' })).toHaveValue(SHARE_TEXT);
    expect(within(panel()).queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
  });

  it('UPSTREAM_ERROR는 다시 시도(재요청)와 지도에서 핀으로 추가를 준다', async () => {
    let n = 0;
    const { user, lookup, store } = await openCard(() =>
      ++n === 1 ? new PlaceLookupError({ code: 'UPSTREAM_ERROR' }) : naverPlace(),
    );
    expect(
      await within(panel()).findByText(
        '지금은 장소 정보를 가져오지 못했어요. 잠시 뒤 다시 해 주세요',
      ),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: '지도에서 핀으로 추가' })).toBeEnabled();
    await user.click(within(panel()).getByRole('button', { name: '다시 시도' }));
    expect(await within(panel()).findByRole('heading', { name: '콤포트' })).toBeInTheDocument();
    expect(lookup.calls).toEqual(['https://naver.me/Fk73Vab5', 'https://naver.me/Fk73Vab5']);
    expect(store.get(addFlowAtom)).toMatchObject({ step: 'candidate' });
  });

  it('TIMEOUT의 지도에서 핀으로 추가는 빈 이름으로 핀 단계에 들어간다', async () => {
    const { user, store } = await openCard(failWith(new PlaceLookupError({ code: 'TIMEOUT' })));
    await user.click(await within(panel()).findByRole('button', { name: '지도에서 핀으로 추가' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'pin', name: '', start: null });
  });

  it('OFFLINE은 다시 시도만 준다', async () => {
    await openCard(failWith(new PlaceLookupError({ code: 'OFFLINE' })));
    expect(
      await within(panel()).findByText('인터넷 연결을 확인하고 다시 시도해 주세요'),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: '다시 시도' })).toBeEnabled();
    expect(
      within(panel()).queryByRole('button', { name: '지도에서 핀으로 추가' }),
    ).not.toBeInTheDocument();
  });

  it('위치 없는 구글 링크는 장소 이름을 채워 바로 핀 단계로 간다', async () => {
    const { store } = await openCard(
      failWith(
        new PlaceLookupError({
          code: 'NOT_FOUND',
          reason: 'no-location',
          placeName: '이재모피자 본점',
        }),
      ),
    );
    await waitFor(() =>
      expect(store.get(addFlowAtom)).toEqual({ step: 'pin', name: '이재모피자 본점', start: null }),
    );
    expect(toastMock).toHaveBeenCalledWith(
      '위치를 알 수 없는 링크예요. 지도에서 위치를 맞춰 주세요',
    );
  });

  it('위치 없는 링크에 이름도 없으면 빈 이름으로 핀 단계에 간다', async () => {
    const { store } = await openCard(
      failWith(new PlaceLookupError({ code: 'NOT_FOUND', reason: 'no-location' })),
    );
    await waitFor(() =>
      expect(store.get(addFlowAtom)).toEqual({ step: 'pin', name: '', start: null }),
    );
  });
});

describe('확인 카드', () => {
  it('라벨·메모를 골라 추가하면 장소가 생기고 상세로 가며 토스트를 띄운다', async () => {
    const { user, store, router, storage } = await openCard();
    const card = panel();
    await within(card).findByRole('heading', { name: '콤포트' });
    expect(
      within(card).queryByText('이미 있는 장소예요. 고른 라벨만 더할게요'),
    ).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '카페' }));
    expect(within(card).getByRole('button', { name: '카페' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.type(within(card).getByRole('textbox', { name: '메모' }), '창가 자리');
    await user.click(within(card).getByRole('button', { name: '추가' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/place/${NEW_ID}`));
    const lib = store.get(libraryAtom);
    expect(placeCount(lib)).toBe(6);
    const added = lib.places[NEW_ID]!;
    expect(added.source).toEqual({ kind: 'naver', sid: '1958911015' });
    expect(added.name.value).toBe('콤포트');
    expect(added.address).toBe('서울특별시 용산구 두텁바위로60길 45');
    expect(added.category.value).toBe('카페,디저트');
    expect(added.labelIds.value).toEqual([L_CAFE]);
    expect(added.memo.value).toBe('창가 자리');
    expect((JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library).places[NEW_ID]).toBeDefined();
    expect(toastMock).toHaveBeenCalledWith('추가했어요');
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(queryPanel()).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '장소 상세' })).toBeInTheDocument();
  });

  it('고친 주소로 저장한다', async () => {
    const { user, store } = await openCard();
    const address = await within(panel()).findByRole('textbox', { name: '주소' });
    await user.clear(address);
    await user.type(address, '고친 주소 1');
    await user.click(within(panel()).getByRole('button', { name: '추가' }));
    await waitFor(() => expect(store.get(libraryAtom).places[NEW_ID]?.address).toBe('고친 주소 1'));
  });

  it('카드에서 새 라벨을 만들면 고른 상태가 되고 함께 붙는다', async () => {
    // 라벨이 장소보다 먼저 만들어지므로 id 순서를 맞춘다.
    const { user, store } = await openCard(() => naverPlace(), { ids: ['newlab01', NEW_ID] });
    const card = panel();
    await within(card).findByRole('heading', { name: '콤포트' });
    await user.type(within(card).getByRole('textbox', { name: '새 라벨 이름' }), '데이트{Enter}');
    const created = await within(card).findByRole('button', { name: '데이트' });
    expect(created).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(card).getByRole('button', { name: '추가' }));
    await waitFor(() => expect(placeCount(store.get(libraryAtom))).toBe(6));
    const lib = store.get(libraryAtom);
    expect(lib.labels.newlab01!.name.value).toBe('데이트');
    expect(lib.places[NEW_ID]!.labelIds.value).toEqual(['newlab01']);
  });

  it('새 라벨을 만드는 중에는 추가를 막아, 만든 라벨이 장소에서 빠지지 않는다', async () => {
    const { user, store } = await openCard(() => naverPlace(), { ids: ['newlab01', NEW_ID] });
    const card = panel();
    await within(card).findByRole('heading', { name: '콤포트' });
    const nameInput = within(card).getByRole('textbox', { name: '새 라벨 이름' });
    await user.type(nameInput, '데이트');
    const add = within(card).getByRole('button', { name: '추가' });
    // 라벨 만들기가 끝나기 전에 추가를 누른다(다른 탭의 저장으로 잠금이 늦어지는 경우).
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(placeCount(store.get(libraryAtom))).toBe(5);
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: '데이트' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    await waitFor(() => expect(store.get(libraryAtom).places[NEW_ID]).toBeDefined());
    expect(store.get(libraryAtom).places[NEW_ID]!.labelIds.value).toEqual(['newlab01']);
  });

  it('같은 이름의 라벨을 만들려 하면 그 라벨을 고른다', async () => {
    const { user, store } = await openCard();
    const card = panel();
    await within(card).findByRole('heading', { name: '콤포트' });
    await user.type(within(card).getByRole('textbox', { name: '새 라벨 이름' }), ' 맛집 {Enter}');
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: '맛집' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(within(card).getByRole('textbox', { name: '새 라벨 이름' })).toHaveValue('');
    expect(Object.keys(store.get(libraryAtom).labels)).toHaveLength(3);
  });

  it('같은 sid의 장소가 있으면 안내와 라벨 더하기를 보이고, 누르면 라벨만 더한다', async () => {
    const existing = makePlace(9, {
      name: '콤포트(저장됨)',
      sid: '1958911015',
      labelIds: [L_FOOD],
    });
    const { user, store, router } = await openCard(() => naverPlace(), {
      library: withPlaces(sampleLibrary(), [existing]),
    });
    const card = panel();
    expect(
      await within(card).findByText('이미 있는 장소예요. 고른 라벨만 더할게요'),
    ).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '추가' })).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '카페' }));
    await user.click(within(card).getByRole('button', { name: '라벨 더하기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/place/${existing.id}`));
    const lib = store.get(libraryAtom);
    expect(placeCount(lib)).toBe(6);
    expect(lib.places[existing.id]!.labelIds.value).toEqual([L_FOOD, L_CAFE]);
    expect(lib.places[existing.id]!.name.value).toBe('콤포트(저장됨)');
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
  });

  it('같은 sid의 장소가 지운 것이면 안내 없이 추가하고 그 장소를 되살린다', async () => {
    const deleted = makePlace(9, { sid: '1958911015', deletedAt: '2026-10-09T00:00:00.000Z' });
    const { user, store, router } = await openCard(() => naverPlace(), {
      library: withPlaces(sampleLibrary(), [deleted]),
    });
    const card = panel();
    await within(card).findByRole('heading', { name: '콤포트' });
    expect(
      within(card).queryByText('이미 있는 장소예요. 고른 라벨만 더할게요'),
    ).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '라벨 더하기' })).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '추가' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/place/${deleted.id}`));
    expect(store.get(libraryAtom).places[deleted.id]!.deletedAt).toBeNull();
  });

  it('구글 후보에 주소가 없으면 주소 변환 결과로 채운다', async () => {
    const google = naverPlace({
      provider: 'google',
      providerId: '0x357ca2:0x8f1e',
      name: '이재모피자 본점',
      address: '',
      category: null,
    });
    const { store } = await openCard(() => google, { reverse: '부산광역시 중구 광복중앙로 31' });
    const card = panel();
    expect(await within(card).findByRole('textbox', { name: '주소' })).toHaveValue(
      '부산광역시 중구 광복중앙로 31',
    );
    expect(within(card).getByText('구글')).toBeInTheDocument();
    expect(
      within(card).queryByText('주소를 찾지 못했어요. 직접 입력해 주세요'),
    ).not.toBeInTheDocument();
    expect(store.get(addFlowAtom)).toMatchObject({
      candidate: { source: { kind: 'google', googleId: '0x357ca2:0x8f1e' } },
    });
  });

  it('주소 변환이 실패하면 안내하고 빈 주소칸을 고칠 수 있다', async () => {
    const google = naverPlace({ provider: 'google', providerId: '0x1:0x2', address: '' });
    const { user, store } = await openCard(() => google, { reverse: null });
    const card = panel();
    const address = await within(card).findByRole('textbox', { name: '주소' });
    expect(address).toHaveValue('');
    expect(within(card).getByText('주소를 찾지 못했어요. 직접 입력해 주세요')).toBeInTheDocument();
    await user.type(address, '직접 쓴 주소');
    // 주소를 쓰면 안내가 사라지고, 다시 비우면 돌아온다.
    expect(
      within(card).queryByText('주소를 찾지 못했어요. 직접 입력해 주세요'),
    ).not.toBeInTheDocument();
    await user.clear(address);
    expect(within(card).getByText('주소를 찾지 못했어요. 직접 입력해 주세요')).toBeInTheDocument();
    await user.type(address, '직접 쓴 주소');
    await user.click(within(card).getByRole('button', { name: '추가' }));
    await waitFor(() =>
      expect(store.get(libraryAtom).places[NEW_ID]?.address).toBe('직접 쓴 주소'),
    );
  });

  it('장소 ID 없는 구글 링크는 핀 출처로 중복 판단 없이 넣고 출처 표시는 구글이다', async () => {
    const google = naverPlace({ provider: 'google', providerId: null, name: '어딘가' });
    const { user, store } = await openCard(() => google);
    const card = panel();
    await within(card).findByRole('heading', { name: '어딘가' });
    expect(within(card).getByText('구글')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '추가' }));
    await waitFor(() => expect(store.get(libraryAtom).places[NEW_ID]).toBeDefined());
    expect(store.get(libraryAtom).places[NEW_ID]!.source).toEqual({ kind: 'pin' });
  });

  it('이름 없는 구글 결과는 확인 카드에서 이름을 받아야 추가하고, 구글 ID 출처는 그대로다', async () => {
    const nameless = naverPlace({
      provider: 'google',
      providerId: '0x1:0x2',
      name: '',
      address: '',
      lng: 127,
      lat: 37.5,
      category: null,
    });
    const { user, store } = await openCard(() => nameless, { reverse: '서울특별시 어딘가 1' });
    const card = panel();
    const nameInput = await within(card).findByRole('textbox', { name: '이름' });
    expect(store.get(addFlowAtom)).toMatchObject({ step: 'candidate' });
    const add = within(card).getByRole('button', { name: '추가' });
    expect(add).toBeDisabled();
    await user.type(nameInput, '   ');
    expect(add).toBeDisabled();
    await user.type(nameInput, '이름 붙인 곳 ');
    expect(add).toBeEnabled();
    await user.click(add);
    await waitFor(() => expect(store.get(libraryAtom).places[NEW_ID]).toBeDefined());
    const added = store.get(libraryAtom).places[NEW_ID]!;
    expect(added.name.value).toBe('이름 붙인 곳');
    expect(added.source).toEqual({ kind: 'google', googleId: '0x1:0x2' });
  });

  it('이름 없는 구글 결과도 같은 구글 ID 장소가 있으면 라벨만 더한다(이름 칸 없이)', async () => {
    const google = naverPlace({ provider: 'google', providerId: '0x1:0x2', name: '', address: '' });
    const { user, store } = await openCard(() => google, { reverse: null });
    await waitFor(() => expect(store.get(addFlowAtom)).toMatchObject({ step: 'candidate' }));
    // 처음 추가
    await user.type(within(panel()).getByRole('textbox', { name: '이름' }), '첫 저장');
    await user.click(within(panel()).getByRole('button', { name: '추가' }));
    await waitFor(() => expect(store.get(libraryAtom).places[NEW_ID]).toBeDefined());
    // 같은 링크로 다시 열면 이미 있는 장소로 다룬다.
    act(() => store.set(addFlowAtom, { step: 'link', hint: 'place' }));
    await submitLink(user);
    expect(
      await within(panel()).findByText('이미 있는 장소예요. 고른 라벨만 더할게요'),
    ).toBeInTheDocument();
    expect(within(panel()).queryByRole('textbox', { name: '이름' })).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole('button', { name: '라벨 더하기' }));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(placeCount(store.get(libraryAtom))).toBe(6);
  });

  it('카카오 후보는 카카오 출처로 넣는다', async () => {
    const kakao = naverPlace({ provider: 'kakao', providerId: '16990385', name: '카카오 장소' });
    const { user, store } = await openCard(() => kakao);
    const card = panel();
    await within(card).findByRole('heading', { name: '카카오 장소' });
    expect(within(card).getByText('카카오')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '추가' }));
    await waitFor(() =>
      expect(store.get(libraryAtom).places[NEW_ID]?.source).toEqual({
        kind: 'kakao',
        kakaoId: '16990385',
      }),
    );
  });

  it('추가를 빠르게 두 번 눌러도 장소는 하나다', async () => {
    // 중복 판단이 없는 출처(ID 없는 구글)라야 두 번 저장되면 장소가 둘이 된다.
    const { store } = await openCard(() => naverPlace({ provider: 'google', providerId: null }), {
      ids: [NEW_ID, 'newplace02'],
    });
    const add = await within(panel()).findByRole('button', { name: '추가' });
    // 저장이 끝나기 전에 같은 작업 안에서 두 번 누른다.
    fireEvent.click(add);
    // 저장이 끝나기 전에는 추가·취소 모두 막혀 있다.
    expect(add).toBeDisabled();
    expect(within(panel()).getByRole('button', { name: '취소' })).toBeDisabled();
    fireEvent.click(add);
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(placeCount(store.get(libraryAtom))).toBe(6);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('저장 중에 칸을 닫고 새 흐름을 열면, 늦게 끝난 저장은 알리기만 하고 새 흐름을 닫지 않는다', async () => {
    const { store, router } = await openCard();
    const add = await within(panel()).findByRole('button', { name: '추가' });
    fireEvent.click(add);
    // 저장이 끝나기 전에 칸의 닫기 버튼으로 닫고 새 흐름을 연다.
    fireEvent.click(within(panel()).getByRole('button', { name: '닫기' }));
    act(() => store.set(addFlowAtom, { step: 'link', hint: 'folder' }));
    await waitFor(() => expect(placeCount(store.get(libraryAtom))).toBe(6));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('추가했어요'));
    expect(store.get(addFlowAtom)).toEqual({ step: 'link', hint: 'folder' });
    expect(router.state.location.pathname).toBe('/');
    expect(
      within(panel()).getByText('네이버 공유 폴더 링크를 붙여 넣어 주세요'),
    ).toBeInTheDocument();
  });

  it('넓은 화면의 지도 없는 화면(/labels)에서 카드가 열리면 지도가 있는 보관함으로 옮긴다', async () => {
    const user = userEvent.setup();
    const lookup = fakeLookup(() => naverPlace());
    const { router } = await renderLibrary(sampleLibrary(), {
      path: '/labels',
      placeLookup: lookup.layer,
    });
    await openFrom(user, '링크 붙여넣기');
    expect(router.state.location.pathname).toBe('/labels');
    await submitLink(user);
    await within(panel()).findByRole('heading', { name: '콤포트' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('카드의 취소는 저장하지 않고 닫는다', async () => {
    const { user, store } = await openCard();
    await within(panel()).findByRole('heading', { name: '콤포트' });
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(placeCount(store.get(libraryAtom))).toBe(5);
  });
});

describe('후보 마커', () => {
  let resources: ReturnType<typeof installMapResources>;
  beforeEach(() => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    resources = installMapResources();
  });
  afterEach(() => {
    resources.restore();
    vi.unstubAllEnvs();
  });

  it('카드가 열리면 지도가 후보 좌표로 이동하고 임시 마커를 보이며, 닫으면 마커가 사라진다', async () => {
    const { user } = await openCard();
    await within(panel()).findByRole('heading', { name: '콤포트' });
    const marker = await screen.findByTestId('marker-candidate');
    expect(marker).toHaveTextContent('콤포트');
    const adapter = [...resources.liveInstances][0]!;
    await waitFor(() => expect(adapter.getCamera()?.zoom).toBe(16));
    // 넓은 화면: 지도는 추가 칸에 가리지 않으므로 후보가 가운데에 온다.
    expect(adapter.getCamera()!.center).toEqual([126.977, 37.546]);

    await user.click(marker);
    expect(screen.getByRole('region', { name: '장소 추가' })).toBeInTheDocument();

    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByTestId('marker-candidate')).not.toBeInTheDocument());
  });

  it('이름 없는 결과도 확인 카드에서 지도를 그 좌표로 옮긴다', async () => {
    await openCard(() =>
      naverPlace({ provider: 'google', providerId: null, name: '', lng: 127, lat: 37.5 }),
    );
    await within(panel()).findByRole('textbox', { name: '이름' });
    await screen.findByTestId('marker-candidate');
    const adapter = [...resources.liveInstances][0]!;
    await waitFor(() => expect(adapter.getCamera()?.center).toEqual([127, 37.5]));
  });
});
