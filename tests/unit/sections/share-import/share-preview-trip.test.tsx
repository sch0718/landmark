import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { ShareDoc, ShareDocV1, ShareDocV2 } from 'src/schema/share';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { makeShareV2Doc } from '../../helpers/share-v2-doc';
import { makePlace, renderLibrary, sampleLibrary, withPlaces, T0 } from '../library/fixtures';
import { makeTrip, withTrip } from '../trips/planner-fixtures';

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

// 쓰이는 순서: 제목 라벨(8자), 새 장소 3곳(10자), Stop 3개(8자), 여행(10자).
const TRIP_ID = 'tripnew001';
const IDS = [
  'newlab01',
  'newplace01',
  'newplace02',
  'newplace03',
  'stop0001',
  'stop0002',
  'stop0003',
  TRIP_ID,
];

/**
 * 장소 4곳(Day 3개에 하나씩 + 후보 1곳). `placea0001`만 보관함의 `저장된 장소`(naverSid 9001)와 같다.
 * 여행은 `강릉 2박 3일`, 10.24 ~ 10.26.
 */
function makeDoc(title = '강릉 2박 3일'): ShareDocV2 {
  const base = makeShareV2Doc();
  const places = base.places
    .filter((p) => ['placea0001', 'placeb0001', 'placec0001', 'placed0001'].includes(p.id))
    .map((p) => (p.id === 'placea0001' ? { ...p, naverSid: '9001' } : p));
  const trip = base.trips[0]!;
  return {
    ...base,
    title: '강릉 모음',
    places,
    trips: [
      {
        ...trip,
        title,
        startDate: '2026-10-24',
        endDate: '2026-10-26',
        originId: null,
        legModes: {},
        candidateIds: ['placed0001'],
        days: ['placea0001', 'placeb0001', 'placec0001'].map((placeId) => ({
          startTime: '09:00',
          lodgingId: null,
          stops: [{ placeId, stayMin: 60, fixedTime: null }],
          legs: [],
        })),
      },
    ],
  };
}

const baseLibrary = (): Library =>
  withPlaces(sampleLibrary(), [makePlace(6, { name: '저장된 장소', sid: '9001' })]);

/** 같은 이름·기간의 살아 있는 여행이 이미 있는 보관함. */
function libraryWithSameTrip(): Library {
  const trip = makeTrip({ start: '2026-10-24', days: 3 });
  return withTrip(baseLibrary(), {
    ...trip,
    title: { value: '강릉 2박 3일', updatedAt: T0 },
  });
}

const panel = () => screen.getByRole('region', { name: '장소 추가' });
const queryPanel = () => screen.queryByRole('region', { name: '장소 추가' });
const tripSwitch = () => within(panel()).getByRole('switch', { name: '여행 계획도 가져오기' });
const tripButton = () => within(panel()).getByRole('button', { name: '여행 가져오기' });
const placeBoxes = () =>
  within(within(panel()).getByRole('list', { name: '가져올 장소' })).getAllByRole('checkbox');

async function openShare(doc: ShareDoc = makeDoc(), library: Library = libraryWithSameTrip()) {
  const user = userEvent.setup();
  const rendered = await renderLibrary(library, { ids: IDS, prefs: { libraryView: 'list' } });
  act(() => rendered.store.set(addFlowAtom, { step: 'share', doc }));
  await within(panel()).findByRole('heading', { name: '강릉 모음 · 4곳' });
  return { user, ...rendered };
}

describe('받은 일정 미리보기(여행 칸)', () => {
  it('여행 칸에 제목·기간·개수·스위치·설명·중복 경고를 보인다', async () => {
    await openShare();
    const box = within(panel());
    expect(box.getByRole('heading', { level: 3, name: '강릉 2박 3일' })).toBeInTheDocument();
    expect(box.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(box.getByText('10.24(토) ~ 10.26(월) · 2박 3일')).toBeInTheDocument();
    expect(box.getByText('일정 3곳 · 후보 1곳')).toBeInTheDocument();
    expect(tripSwitch()).toBeChecked();
    expect(
      box.getByText('새 여행으로 만들어요. 이동 시간은 내 Landmark에서 다시 조회해요'),
    ).toBeInTheDocument();
    expect(
      box.getByText('같은 이름·기간의 여행이 이미 있어요. 가져오면 하나 더 생겨요'),
    ).toBeInTheDocument();
  });

  it('같은 여행이 없으면 경고가 없고, 후보가 0이면 일정 개수만 보인다', async () => {
    const doc = makeDoc();
    const trip = { ...doc.trips[0]!, candidateIds: [] };
    await openShare({ ...doc, trips: [trip] }, baseLibrary());
    expect(within(panel()).getByText('일정 3곳')).toBeInTheDocument();
    expect(within(panel()).queryByText(/같은 이름·기간의 여행/)).not.toBeInTheDocument();
  });

  it('제목이 비면 `받은 여행`으로 보인다', async () => {
    await openShare(makeDoc('  '), baseLibrary());
    expect(
      within(panel()).getByRole('heading', { level: 3, name: '받은 여행' }),
    ).toBeInTheDocument();
  });

  it('스위치를 켜면 행이 모두 체크된 채 비활성이고 일괄 버튼도 꺼진다', async () => {
    await openShare();
    for (const box of placeBoxes()) {
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    expect(within(panel()).getByRole('button', { name: '모두 선택' })).toBeDisabled();
    expect(within(panel()).getByRole('button', { name: '모두 해제' })).toBeDisabled();
    expect(within(panel()).getByText('여행에 쓰이는 장소는 모두 가져와요')).toBeInTheDocument();
    expect(tripButton()).toBeEnabled();
    expect(within(panel()).queryByRole('button', { name: /곳 가져오기/ })).not.toBeInTheDocument();
  });

  it('스위치를 끄면 v1처럼 고를 수 있고 버튼이 `N곳 가져오기`이며 여행이 생기지 않는다', async () => {
    const { user, store } = await openShare();
    await user.click(tripSwitch());
    expect(within(panel()).queryByText('여행에 쓰이는 장소는 모두 가져와요')).toBeNull();
    for (const box of placeBoxes()) expect(box).toBeEnabled();
    await user.click(placeBoxes()[3]!);
    const tripsBefore = Object.keys(store.get(libraryAtom).trips);
    await user.click(within(panel()).getByRole('button', { name: '3곳 가져오기' }));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(Object.keys(store.get(libraryAtom).trips)).toEqual(tripsBefore);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0]![0]).not.toMatch(/여행/);
  });

  it('끄고 일부를 골랐다가 다시 켜면 모두 선택으로 돌아온다', async () => {
    const { user } = await openShare();
    await user.click(tripSwitch());
    await user.click(placeBoxes()[3]!);
    await user.click(tripSwitch());
    for (const box of placeBoxes()) expect(box).toBeChecked();
    expect(tripButton()).toBeEnabled();
  });

  it('켠 채 가져오면 여행을 만들고 토스트·흐름 닫기·계획 화면 이동을 한다', async () => {
    const { user, store, router } = await openShare();
    await user.click(tripButton());
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    const lib = store.get(libraryAtom);
    const created = Object.values(lib.trips).filter((t) => t.title.value === '강릉 2박 3일');
    // 같은 이름·기간 여행이 이미 있었으므로 하나 더 생겨 둘이다.
    expect(created).toHaveLength(2);
    const fresh = lib.trips[TRIP_ID]!;
    expect(fresh.days.map((d) => d.stops.value.length)).toEqual([1, 1, 1]);
    expect(fresh.candidates.value).toHaveLength(1);

    // 장소 결과 문장은 v1 가져오기가 쓰는 `resultMessage`의 같은 출력이다(새 3곳·라벨만 1곳).
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      '여행 ‘강릉 2박 3일’을 가져왔어요. 3곳을 새로 넣고, 1곳은 라벨만 더했어요',
    );
    await waitFor(() => expect(router.state.location.pathname).toBe(`/trips/${fresh.id}`));
    expect(queryPanel()).not.toBeInTheDocument();
  });

  it('제목 끝 받침이 없으면 `를`을 쓴다', async () => {
    const { user, store } = await openShare(makeDoc('제주'));
    await user.click(tripButton());
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock.mock.calls[0]![0]).toMatch(/^여행 ‘제주’를 가져왔어요\. /);
  });

  it('빈 제목은 토스트에도 `받은 여행`으로 쓴다', async () => {
    const { user, store } = await openShare(makeDoc(' '));
    await user.click(tripButton());
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock.mock.calls[0]![0]).toMatch(/^여행 ‘받은 여행’을 가져왔어요\. /);
  });

  it('빠르게 두 번 눌러도 여행은 하나만 만든다', async () => {
    const { store } = await openShare(makeDoc(), baseLibrary());
    const button = tripButton();
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(1);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('저장 중에 흐름이 닫히면 토스트는 띄우되 이동하지 않는다', async () => {
    const { store, router } = await openShare(makeDoc(), baseLibrary());
    fireEvent.click(tripButton());
    act(() => store.set(addFlowAtom, { step: 'closed' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(1);
    expect(router.state.location.pathname).toBe('/');
  });

  it('스위치·버튼·체크 높이는 44px 이상이다', async () => {
    await openShare();
    const label = tripSwitch().closest('label')!;
    expect(label).toHaveStyle({ minHeight: '44px' });
    expect(tripButton()).toHaveStyle({ minHeight: '44px' });
  });

  it('v1 문서에는 여행 칸이 없다', async () => {
    const v1: ShareDocV1 = { ...makeDoc(), version: 1, trips: undefined } as never;
    delete (v1 as { trips?: unknown }).trips;
    await openShare(v1, baseLibrary());
    expect(within(panel()).queryByRole('switch', { name: '여행 계획도 가져오기' })).toBeNull();
    expect(within(panel()).getByRole('button', { name: '4곳 가져오기' })).toBeInTheDocument();
    for (const box of placeBoxes()) expect(box).toBeEnabled();
  });
});
