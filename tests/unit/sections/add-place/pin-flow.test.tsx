import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { ResolvedPlace } from 'src/server/resolve';
import { PlaceLookupError } from 'src/services/errors';
import { PlaceLookup } from 'src/services/place-lookup';
import { ReverseGeocoder } from 'src/services/reverse-geocoder';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { installMapResources } from '../../components/helpers/map-resources';
import {
  attachedNames,
  closeLabelPicker,
  openLabelPicker,
  pickerSearch,
  toggleLabel,
} from '../../helpers/label-picker';
import { L_CAFE, renderLibrary, sampleLibrary } from '../library/fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

let resources: ReturnType<typeof installMapResources>;
beforeEach(() => {
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  resources = installMapResources();
});
afterEach(() => {
  cleanup();
  toastMock.mockClear();
  toastMock.error.mockClear();
  setAppRuntimeForTest(null);
  resources.restore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const NEW_ID = 'newplace01';
const GUIDE = '지도를 움직여 위치를 맞추세요';
const ADDRESS_MISSING = '주소를 찾지 못했어요. 직접 입력해 주세요';

const fakeReverse = (address: string | null) =>
  Layer.succeed(ReverseGeocoder, ReverseGeocoder.of({ reverse: () => Effect.succeed(address) }));

/** 가짜 장소 조회. 늘 같은 답을 준다. */
const fakeLookup = (reply: ResolvedPlace | PlaceLookupError) =>
  Layer.succeed(
    PlaceLookup,
    PlaceLookup.of({
      lookupLink: () =>
        reply instanceof PlaceLookupError ? Effect.fail(reply) : Effect.succeed(reply),
      lookupFolder: () => Effect.fail(new PlaceLookupError({ code: 'OFFLINE' })),
    }),
  );

const panel = () => screen.getByRole('region', { name: '장소 추가' });
const queryPanel = () => screen.queryByRole('region', { name: '장소 추가' });
const fakeAdapter = () => [...resources.liveInstances][0]!;
const crosshair = () => screen.queryByTestId('pin-crosshair');
const placeCount = (lib: Library) => Object.keys(lib.places).length;

/** ＋추가 → 시트 항목을 고른다. */
async function openFrom(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole('button', { name: '장소 추가' }));
  const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
  await user.click(within(sheet).getByRole('button', { name: new RegExp(item) }));
  await waitFor(() => expect(sheet).not.toBeInTheDocument());
}

/** 지도가 뜰 때까지 기다린다. */
async function mapReady() {
  await waitFor(() => expect(screen.getByTestId('fake-map')).toBeInTheDocument());
  await waitFor(() => expect(resources.liveInstances.size).toBe(1));
}

/** 사용자가 지도를 끌어 옮긴 것처럼 카메라를 바꾼다(어댑터가 영역 변경을 알린다). */
function pan(center: [number, number], zoom = 14) {
  act(() => fakeAdapter().setCamera({ center, zoom }));
}

async function enterPinMode(
  options: { reverse?: string | null; width?: number; path?: string; ids?: string[] } = {},
) {
  const user = userEvent.setup();
  const rendered = await renderLibrary(sampleLibrary(), {
    ids: options.ids ?? [NEW_ID],
    width: options.width ?? 1280,
    path: options.path ?? '/',
    reverseGeocoder: fakeReverse(
      options.reverse === undefined ? '서울특별시 중구 세종대로 110' : options.reverse,
    ),
  });
  // 좁은 화면의 목록·보관함 밖 화면에는 처음에 지도가 없다(핀 모드가 지도로 옮긴다).
  const mapFirst = (options.width ?? 1280) >= 768 && !(options.path ?? '/').startsWith('/labels');
  if (mapFirst) await mapReady();
  await openFrom(user, '지도에서 핀 찍기');
  if (!mapFirst) await mapReady();
  return { user, ...rendered };
}

/** 핀 모드에서 지도를 옮기고 `여기에 추가`로 입력 카드를 연다. */
async function openPinCard(
  options: Parameters<typeof enterPinMode>[0] & { center?: [number, number] } = {},
) {
  const rendered = await enterPinMode(options);
  pan(options.center ?? [126.978, 37.5665]);
  await rendered.user.click(screen.getByRole('button', { name: '여기에 추가' }));
  await within(panel()).findByRole('textbox', { name: '이름' });
  return rendered;
}

describe('핀 모드', () => {
  it('＋추가 → 지도에서 핀 찍기는 지도 가운데 조준점과 안내를 보이고 추가 칸은 열지 않는다', async () => {
    const { store } = await enterPinMode();
    expect(store.get(addFlowAtom)).toEqual({ step: 'pin', name: '', start: null });
    expect(crosshair()).toBeInTheDocument();
    expect(screen.getByText(GUIDE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '여기에 추가' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
    expect(queryPanel()).not.toBeInTheDocument();
  });

  it('지도를 옮긴 뒤 여기에 추가하면 그 중심 좌표로 입력 카드를 연다', async () => {
    const { user, store } = await enterPinMode();
    pan([127.1234, 37.2345]);
    await user.click(screen.getByRole('button', { name: '여기에 추가' }));
    expect(store.get(addFlowAtom)).toEqual({
      step: 'pin-card',
      name: '',
      lng: 127.1234,
      lat: 37.2345,
    });
    expect(crosshair()).not.toBeInTheDocument();
    expect(screen.queryByText(GUIDE)).not.toBeInTheDocument();
    // 단계 화면은 처음 열 때 받으므로 한 박자 늦게 나타난다.
    expect(await within(panel()).findByRole('textbox', { name: '이름' })).toHaveValue('');
    // 고른 위치에는 임시 마커가 남는다.
    expect(await screen.findByTestId('marker-candidate')).toBeInTheDocument();
  });

  it('취소하면 흐름을 닫는다', async () => {
    const { user, store } = await enterPinMode();
    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(crosshair()).not.toBeInTheDocument();
    expect(screen.queryByText(GUIDE)).not.toBeInTheDocument();
  });

  it('Esc로도 취소한다', async () => {
    const { user, store } = await enterPinMode();
    await user.keyboard('{Escape}');
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(crosshair()).not.toBeInTheDocument();
  });

  it('대화상자가 열려 있으면 Esc는 그 대화상자만 닫고 핀 모드는 그대로다', async () => {
    const { user, store } = await enterPinMode();
    await user.click(screen.getByRole('button', { name: '장소 추가' }));
    const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
    expect(store.get(addFlowAtom)).toEqual({ step: 'pin', name: '', start: null });
    expect(crosshair()).toBeInTheDocument();
  });

  it('입력칸(목록 검색)에서 누른 Esc는 핀 모드를 끝내지 않는다', async () => {
    const { user, store } = await enterPinMode();
    await user.click(screen.getByRole('searchbox', { name: '장소 검색' }));
    await user.keyboard('{Escape}');
    expect(store.get(addFlowAtom)).toEqual({ step: 'pin', name: '', start: null });
    expect(crosshair()).toBeInTheDocument();
  });

  it.each([
    ['넓은 화면', 1280],
    ['중간 폭', 1100],
  ])('%s에서 뒤로 가면(지도는 그대로 보여도) 핀 모드를 끝낸다', async (_, width) => {
    const user = userEvent.setup();
    const { router, store } = await renderLibrary(sampleLibrary(), { width });
    await mapReady();
    await act(() => router.navigate('/place/place00001'));
    await openFrom(user, '지도에서 핀 찍기');
    expect(crosshair()).toBeInTheDocument();
    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(crosshair()).not.toBeInTheDocument();
  });

  it('중간 폭에서 핀 모드 중 다른 장소로 가면 핀 모드를 끝내고 상세 오버레이를 다시 보인다', async () => {
    const { router, store } = await enterPinMode({ width: 1100, path: '/place/place00001' });
    expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument();
    await act(() => router.navigate('/place/place00002'));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(screen.getByRole('region', { name: '장소 상세' })).toBeInTheDocument();
  });

  it('시작 좌표가 있으면 지도를 그 좌표로 옮기고, 그대로 여기에 추가하면 그 좌표다', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary(), {
      reverseGeocoder: fakeReverse(null),
    });
    await mapReady();
    act(() => store.set(addFlowAtom, { step: 'pin', name: '콤포트', start: [129.06, 35.15] }));
    await waitFor(() =>
      expect(fakeAdapter().getCamera()).toEqual({ center: [129.06, 35.15], zoom: 16 }),
    );
    await user.click(screen.getByRole('button', { name: '여기에 추가' }));
    expect(store.get(addFlowAtom)).toEqual({
      step: 'pin-card',
      name: '콤포트',
      lng: 129.06,
      lat: 35.15,
    });
  });

  it('핀 모드에서는 마커를 눌러도 상세로 가지 않는다', async () => {
    const { user, router } = await enterPinMode();
    await user.click(await screen.findByTestId('marker-place00001'));
    expect(router.state.location.pathname).toBe('/');
    expect(crosshair()).toBeInTheDocument();
  });

  it('중간 폭에서는 열어 둔 상세 오버레이를 내려 지도 전체를 쓰고, 끝나면 다시 보인다', async () => {
    const { user } = await enterPinMode({ width: 1100, path: '/place/place00001' });
    expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument();
    expect(crosshair()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.getByRole('region', { name: '장소 상세' })).toBeInTheDocument();
  });

  it('중간 폭에서 입력 카드가 지도를 덮으면 고른 위치를 가려지지 않는 쪽으로 옮긴다', async () => {
    const { user } = await enterPinMode({ width: 1100 });
    pan([127.5, 36.5]);
    await user.click(screen.getByRole('button', { name: '여기에 추가' }));
    await within(panel()).findByRole('textbox', { name: '이름' });
    await waitFor(() => expect(fakeAdapter().getCamera()?.zoom).toBe(16));
    const camera = fakeAdapter().getCamera()!;
    // 1100px 화면: 레일 64, 목록 360, 지도 676, 추가 칸이 오른쪽 360을 덮는다.
    const x = 338 + ((127.5 - camera.center[0]) * 256 * 2 ** camera.zoom) / 360;
    expect(x).toBeGreaterThanOrEqual(40);
    expect(x).toBeLessThanOrEqual(276);
  });

  it('보관함 밖 화면(넓은 화면)에서 시작하면 지도가 보이는 보관함으로 간다', async () => {
    const { router } = await enterPinMode({ path: '/labels' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByTestId('pin-crosshair')).toBeInTheDocument();
  });
});

describe('핀 입력 카드', () => {
  it('열리면 주소를 주소 변환 결과로 채운다', async () => {
    await openPinCard();
    await waitFor(() =>
      expect(within(panel()).getByRole('textbox', { name: '주소' })).toHaveValue(
        '서울특별시 중구 세종대로 110',
      ),
    );
    expect(within(panel()).queryByText(ADDRESS_MISSING)).not.toBeInTheDocument();
  });

  it('주소 변환이 못 찾으면 빈칸과 안내를 보이고, 직접 쓰면 안내가 사라진다', async () => {
    const { user } = await openPinCard({ reverse: null });
    expect(await within(panel()).findByText(ADDRESS_MISSING)).toBeInTheDocument();
    const address = within(panel()).getByRole('textbox', { name: '주소' });
    expect(address).toHaveValue('');
    await user.type(address, '부산 해운대구');
    expect(within(panel()).queryByText(ADDRESS_MISSING)).not.toBeInTheDocument();
  });

  it('이름이 비어 있으면 추가를 막는다', async () => {
    const { user } = await openPinCard();
    const add = within(panel()).getByRole('button', { name: '추가' });
    expect(add).toBeDisabled();
    await user.type(within(panel()).getByRole('textbox', { name: '이름' }), '   ');
    expect(add).toBeDisabled();
    await user.type(within(panel()).getByRole('textbox', { name: '이름' }), '시청');
    expect(add).toBeEnabled();
  });

  it('추가하면 핀 출처(옛 키 없음)·분류 없음으로 장소를 만들고 상세로 가며 토스트를 띄운다', async () => {
    const { user, store, router } = await openPinCard({ center: [126.978, 37.5665] });
    const card = panel();
    await waitFor(() =>
      expect(within(card).getByRole('textbox', { name: '주소' })).toHaveValue(
        '서울특별시 중구 세종대로 110',
      ),
    );
    await user.type(within(card).getByRole('textbox', { name: '이름' }), ' 서울시청 ');
    await toggleLabel(user, card, '카페');
    expect(attachedNames(card)).toEqual(['카페']);
    await user.type(within(card).getByRole('textbox', { name: '메모' }), '광장 앞');
    await user.click(within(card).getByRole('button', { name: '추가' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/place/${NEW_ID}`));
    const lib = store.get(libraryAtom);
    expect(placeCount(lib)).toBe(6);
    const added = lib.places[NEW_ID]!;
    expect(added.source).toEqual({ kind: 'pin' });
    expect('legacy' in added.source).toBe(false);
    expect(added.category.value).toBeNull();
    expect(added.name.value).toBe('서울시청');
    expect(added.address).toBe('서울특별시 중구 세종대로 110');
    expect([added.lng, added.lat]).toEqual([126.978, 37.5665]);
    expect(added.labelIds.value).toEqual([L_CAFE]);
    expect(added.memo.value).toBe('광장 앞');
    expect(toastMock).toHaveBeenCalledWith('추가했어요');
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(queryPanel()).not.toBeInTheDocument();
    expect(screen.queryByTestId('marker-candidate')).not.toBeInTheDocument();
  });

  it('새 라벨을 만드는 중에는 추가를 막아, 만든 라벨이 장소에서 빠지지 않는다', async () => {
    const { user, store } = await openPinCard({ ids: ['newlab01', NEW_ID] });
    const card = panel();
    await user.type(within(card).getByRole('textbox', { name: '이름' }), '여기');
    // 창이 열리면 카드가 가려지므로 추가 버튼은 미리 집어 둔다.
    const add = within(card).getByRole('button', { name: '추가' });
    const picker = await openLabelPicker(user, card);
    const search = pickerSearch(picker);
    await user.type(search, '데이트');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(add).toBeDisabled();
    await waitFor(() => expect(add).toBeEnabled());
    await closeLabelPicker(user, picker);
    await user.click(add);
    await waitFor(() => expect(store.get(libraryAtom).places[NEW_ID]).toBeDefined());
    expect(store.get(libraryAtom).places[NEW_ID]!.labelIds.value).toEqual(['newlab01']);
  });

  it('카드의 취소는 저장하지 않고 닫는다', async () => {
    const { user, store } = await openPinCard();
    await user.type(within(panel()).getByRole('textbox', { name: '이름' }), '시청');
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(placeCount(store.get(libraryAtom))).toBe(5);
  });

  it('저장 중에는 추가·취소를 막고, 그사이 칸을 닫고 새 흐름을 열면 새 흐름을 닫지 않는다', async () => {
    const { user, store, router } = await openPinCard();
    await user.type(within(panel()).getByRole('textbox', { name: '이름' }), '시청');
    const add = within(panel()).getByRole('button', { name: '추가' });
    fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(within(panel()).getByRole('button', { name: '취소' })).toBeDisabled();
    // 저장이 끝나기 전에 칸의 닫기 버튼으로 닫고 새 흐름을 연다.
    fireEvent.click(within(panel()).getByRole('button', { name: '닫기' }));
    act(() => store.set(addFlowAtom, { step: 'link', hint: 'place' }));
    await waitFor(() => expect(placeCount(store.get(libraryAtom))).toBe(6));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('추가했어요'));
    expect(store.get(addFlowAtom)).toEqual({ step: 'link', hint: 'place' });
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('주소 찾는 중 표시', () => {
  const LOADING = '주소 찾는 중…';

  /** 조회가 끝나지 않는 주소 변환(`resolve`로 끝낸다). */
  function pendingReverse() {
    let resolve!: (address: string | null) => void;
    const promise = new Promise<string | null>((r) => (resolve = r));
    const layer = Layer.succeed(
      ReverseGeocoder,
      ReverseGeocoder.of({ reverse: () => Effect.promise(() => promise) }),
    );
    return { layer, resolve };
  }

  async function openCardWith(layer: Layer.Layer<ReverseGeocoder>) {
    const user = userEvent.setup();
    const rendered = await renderLibrary(sampleLibrary(), {
      ids: [NEW_ID],
      reverseGeocoder: layer,
    });
    await mapReady();
    await openFrom(user, '지도에서 핀 찍기');
    pan([126.978, 37.5665]);
    await user.click(screen.getByRole('button', { name: '여기에 추가' }));
    await within(panel()).findByRole('textbox', { name: '이름' });
    return { user, ...rendered };
  }

  it('찾는 동안 보이고, 찾으면 사라진다', async () => {
    const pending = pendingReverse();
    await openCardWith(pending.layer);
    expect(within(panel()).getByRole('status')).toHaveTextContent(LOADING);
    await act(async () => pending.resolve('서울특별시 중구 세종대로 110'));
    await waitFor(() => expect(within(panel()).queryByText(LOADING)).not.toBeInTheDocument());
    expect(within(panel()).getByRole('textbox', { name: '주소' })).toHaveValue(
      '서울특별시 중구 세종대로 110',
    );
  });

  it('못 찾아도 사라지고 안내로 바뀐다', async () => {
    const pending = pendingReverse();
    await openCardWith(pending.layer);
    expect(within(panel()).getByText(LOADING)).toBeInTheDocument();
    await act(async () => pending.resolve(null));
    await waitFor(() => expect(within(panel()).queryByText(LOADING)).not.toBeInTheDocument());
    expect(within(panel()).getByText(ADDRESS_MISSING)).toBeInTheDocument();
  });

  it('찾는 동안 사용자가 주소를 쓰면 사라진다', async () => {
    const pending = pendingReverse();
    const { user } = await openCardWith(pending.layer);
    expect(within(panel()).getByText(LOADING)).toBeInTheDocument();
    await user.type(within(panel()).getByRole('textbox', { name: '주소' }), '내가 쓴 주소');
    expect(within(panel()).queryByText(LOADING)).not.toBeInTheDocument();
  });
});

describe('링크 실패에서 핀으로', () => {
  it('위치 없는 링크는 이름을 채운 채 핀 모드로 들어오고, 카드에 그 이름이 있다', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary(), {
      placeLookup: fakeLookup(
        new PlaceLookupError({
          code: 'NOT_FOUND',
          reason: 'no-location',
          placeName: '이재모피자 본점',
        }),
      ),
      reverseGeocoder: fakeReverse(null),
    });
    await mapReady();
    await openFrom(user, '링크 붙여넣기');
    await user.click(within(panel()).getByRole('textbox', { name: '링크' }));
    await user.paste('https://maps.app.goo.gl/abc');
    await user.click(within(panel()).getByRole('button', { name: '확인' }));
    expect(await screen.findByTestId('pin-crosshair')).toBeInTheDocument();
    expect(screen.getByText(GUIDE)).toBeInTheDocument();
    pan([129.1, 35.2]);
    await user.click(screen.getByRole('button', { name: '여기에 추가' }));
    expect(store.get(addFlowAtom)).toEqual({
      step: 'pin-card',
      name: '이재모피자 본점',
      lng: 129.1,
      lat: 35.2,
    });
    expect(within(panel()).getByRole('textbox', { name: '이름' })).toHaveValue('이재모피자 본점');
    expect(within(panel()).getByRole('button', { name: '추가' })).toBeEnabled();
  });

  it('조회 오류의 지도에서 핀으로 추가 버튼은 핀 모드로 들어간다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), {
      placeLookup: fakeLookup(new PlaceLookupError({ code: 'UPSTREAM_ERROR' })),
    });
    await mapReady();
    await openFrom(user, '링크 붙여넣기');
    await user.click(within(panel()).getByRole('textbox', { name: '링크' }));
    await user.paste('https://naver.me/Fk73Vab5');
    await user.click(within(panel()).getByRole('button', { name: '확인' }));
    await user.click(await within(panel()).findByRole('button', { name: '지도에서 핀으로 추가' }));
    expect(screen.getByTestId('pin-crosshair')).toBeInTheDocument();
    expect(screen.getByText(GUIDE)).toBeInTheDocument();
    expect(queryPanel()).not.toBeInTheDocument();
  });
});

describe('좁은 화면', () => {
  it('핀 모드에 들어가면 지도 탭으로 바꾸고, 뒤로 가면 핀 모드를 끝낸다', async () => {
    const { router, store } = await enterPinMode({ width: 390 });
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    expect(await screen.findByTestId('pin-crosshair')).toBeInTheDocument();
    expect(screen.getByText(GUIDE)).toBeInTheDocument();

    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
  });

  it('확인 카드가 열리면 지도 탭으로 바꿔 후보 마커를 보인다', async () => {
    const user = userEvent.setup();
    const place: ResolvedPlace = {
      kind: 'place',
      provider: 'naver',
      providerId: '1958911015',
      name: '콤포트',
      address: '서울특별시 용산구 두텁바위로60길 45',
      lng: 126.977,
      lat: 37.546,
      category: '카페,디저트',
    };
    const { router } = await renderLibrary(sampleLibrary(), {
      width: 390,
      placeLookup: fakeLookup(place),
    });
    await openFrom(user, '링크 붙여넣기');
    const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
    await user.click(within(sheet).getByRole('textbox', { name: '링크' }));
    await user.paste('https://naver.me/Fk73Vab5');
    await user.click(within(sheet).getByRole('button', { name: '확인' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    expect(await screen.findByTestId('marker-candidate')).toHaveTextContent('콤포트');
    await waitFor(() =>
      expect(fakeAdapter().getCamera()).toEqual({ center: [126.977, 37.546], zoom: 16 }),
    );
  });
});
