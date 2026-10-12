import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayColor } from 'src/components/map/map-colors';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import { LIBRARY_KEY } from 'src/services/library-store';
import { libraryAtom } from 'src/stores/library-state';
import { selectedDayAtom, splitPreviewAtom } from 'src/stores/trip-planner';
import { installMapResources } from '../../components/helpers/map-resources';
import {
  f,
  makeTrip,
  open,
  P1,
  P2,
  P3,
  P5,
  plannerLibrary,
  TRIP,
  withTrip,
} from './planner-fixtures';

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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  resources = installMapResources();
});
afterEach(() => {
  toastMock.mockClear();
  toastMock.error.mockClear();
  resources.restore();
  setAppRuntimeForTest(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------- 도우미 ----------

type Opened = Awaited<ReturnType<typeof open>>;

const trip = (store: Opened['store']) => store.get(libraryAtom).trips[TRIP]!;
const dayPlaces = (store: Opened['store'], d: number) =>
  trip(store).days[d]!.stops.value.map((s) => s.placeId);
const candidates = (store: Opened['store']) => trip(store).candidates.value;

type ToastOptions = { duration?: number; action?: { label: string; onClick(): void } };

function lastToast(message: string): ToastOptions {
  const call = toastMock.mock.calls.findLast((c) => c[0] === message);
  expect(call, `토스트 '${message}'`).toBeDefined();
  return (call![1] ?? {}) as ToastOptions;
}

async function undo(message: string) {
  const options = lastToast(message);
  expect(options.action?.label).toBe('되돌리기');
  expect(options.duration).toBe(8000);
  await act(async () => {
    options.action!.onClick();
  });
}

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};
const markerChip = (id: string) =>
  screen.getByTestId(`marker-${id}`).firstElementChild as HTMLElement;
const panel = () => screen.getByRole('region', { name: '후보 칸' });
const marker = (id: string) => screen.getByTestId(`marker-${id}`);

/** 다른 탭이 쓴 것처럼 저장소의 문서를 직접 고친다. 이 탭의 화면은 모른다. */
function writeAsOtherTab(storage: Storage, edit: (lib: Library) => Library) {
  storage.setItem(LIBRARY_KEY, JSON.stringify(edit(JSON.parse(storage.getItem(LIBRARY_KEY)!))));
}

// ---------- 순서 정리 ----------

describe('순서 정리', () => {
  it('더 짧은 순서가 있으면 바꾸고 토스트의 되돌리기로 돌린다', async () => {
    // 출발지가 닭강정이면 카페거리(4.8km) → 창가 자리보다 창가 자리(440m) → 카페거리가 훨씬 짧다.
    const lib = withTrip(plannerLibrary(), makeTrip({ origin: P1, stops: [[P2, P5]] }));
    const { store } = await open(lib);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '순서 정리' }));

    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P5, P2]));
    expect(lastToast('순서를 정리했어요').duration).toBe(8000);
    await undo('순서를 정리했어요');
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P2, P5]));
  });

  it('이미 가장 짧으면 바꾸지 않고 알린다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ origin: P1, stops: [[P5, P2]] }));
    const { store } = await open(lib);
    const user = userEvent.setup();
    const before = trip(store);

    await user.click(screen.getByRole('button', { name: '순서 정리' }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('이미 가장 짧은 순서예요'));
    expect(toastMock.mock.calls.some((c) => c[0] === '순서를 정리했어요')).toBe(false);
    expect(trip(store)).toEqual(before);
  });

  it('저장이 실패하면 `이미 가장 짧은 순서예요`를 띄우지 않는다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ origin: P1, stops: [[P5, P2]] }));
    const { storage } = await open(lib);
    const user = userEvent.setup();
    // 이제부터 보관함 쓰기는 늘 용량 초과다.
    const setItem = storage.setItem.bind(storage);
    let attempts = 0;
    storage.setItem = (key: string, value: string) => {
      if (key === 'tripmap:library:v2') {
        attempts += 1;
        throw new DOMException('', 'QuotaExceededError');
      }
      setItem(key, value);
    };

    await user.click(screen.getByRole('button', { name: '순서 정리' }));
    await waitFor(() => expect(attempts).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(toastMock).not.toHaveBeenCalledWith('이미 가장 짧은 순서예요');
  });

  it('고정 시각 순서를 어기고 있으면 거리와 상관없이 바로잡는다', async () => {
    const base = makeTrip({ stops: [[P1, P5, P2]] });
    const stops = base.days[0]!.stops.value.map((s) =>
      s.placeId === P1
        ? { ...s, fixedTime: '15:00' }
        : s.placeId === P2
          ? { ...s, fixedTime: '10:00' }
          : s,
    );
    const lib = withTrip(plannerLibrary(), {
      ...base,
      days: [{ ...base.days[0]!, stops: f(stops) }, base.days[1]!],
    });
    const { store } = await open(lib);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '순서 정리' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('순서를 정리했어요', expect.anything()),
    );
    const order = dayPlaces(store, 0);
    expect(order.indexOf(P2)).toBeLessThan(order.indexOf(P1));
  });

  it('장소가 2곳 미만인 Day에서는 꺼져 있다', async () => {
    await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P1], []] })));
    expect(screen.getByRole('button', { name: '순서 정리' })).toBeDisabled();
  });
});

// ---------- Day 자동 나누기 ----------

describe('Day 자동 나누기', () => {
  const splitTrip = () =>
    withTrip(plannerLibrary(), makeTrip({ days: 2, candidates: [P1, P5, P2, P3] }));

  it('후보가 없으면 꺼져 있다', async () => {
    await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P1]] })));
    expect(screen.getByRole('button', { name: 'Day 자동 나누기' })).toBeDisabled();
  });

  it('미리보기: 칸에 Day별 곳 수, 지도에는 배정될 Day 색 — 취소하면 그대로', async () => {
    const { store } = await open(splitTrip());
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId(`marker-${P1}`)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Day 자동 나누기' }));

    const preview = store.get(splitPreviewAtom);
    expect(preview?.tripId).toBe(TRIP);
    expect(preview!.plan.flat().sort()).toEqual([P1, P2, P3, P5].sort());
    const text = preview!.plan.map((ids, d) => `Day ${d + 1}에 ${ids.length}곳`).join(', ');
    expect(within(panel()).getByText(text)).toBeInTheDocument();
    // 미리보기가 후보 목록 자리를 차지한다.
    expect(within(panel()).queryByRole('list', { name: '후보' })).not.toBeInTheDocument();
    preview!.plan.forEach((ids, d) => {
      for (const id of ids) expect(markerChip(id).style.background).toBe(rgb(dayColor(d)));
    });
    // 아직 아무것도 바뀌지 않았다.
    expect(candidates(store)).toEqual([P1, P5, P2, P3]);

    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(store.get(splitPreviewAtom)).toBeNull();
    expect(within(panel()).getByRole('list', { name: '후보' })).toBeInTheDocument();
    expect(candidates(store)).toEqual([P1, P5, P2, P3]);
    expect(dayPlaces(store, 0)).toEqual([]);
  });

  it('적용: 후보가 Day로 가고 되돌리기 토스트로 돌린다', async () => {
    const { store } = await open(splitTrip(), {
      ids: ['stopaaaa', 'stopbbbb', 'stopcccc', 'stopdddd'],
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Day 자동 나누기' }));
    const plan = store.get(splitPreviewAtom)!.plan;
    await user.click(within(panel()).getByRole('button', { name: '적용' }));

    await waitFor(() => expect(candidates(store)).toEqual([]));
    expect(dayPlaces(store, 0)).toEqual(plan[0]);
    expect(dayPlaces(store, 1)).toEqual(plan[1]);
    expect(store.get(splitPreviewAtom)).toBeNull();
    expect(lastToast('Day 자동 나누기를 적용했어요').duration).toBe(8000);

    await undo('Day 자동 나누기를 적용했어요');
    await waitFor(() => expect([...candidates(store)].sort()).toEqual([P1, P2, P3, P5].sort()));
    expect(dayPlaces(store, 0)).toEqual([]);
    expect(dayPlaces(store, 1)).toEqual([]);
  });

  it('미리보기는 Day의 새 전체 순서를 보이고, 지도의 그날 번호도 새 순서를 따른다(스펙 §5.2)', async () => {
    // 출발지가 닭강정이면 창가 자리(440m)가 카페거리(4.8km)보다 먼저다. 지금 순서는 카페거리 → 창가 자리.
    const lib = withTrip(
      plannerLibrary(),
      makeTrip({ days: 1, origin: P1, stops: [[P2, P5]], candidates: [P3] }),
    );
    const { store } = await open(lib);
    const user = userEvent.setup();
    await waitFor(() => expect(marker(P2)).toHaveTextContent('1 안목 카페거리'));
    expect(marker(P5)).toHaveTextContent('2 창가 자리');
    expect(screen.getAllByTestId(/^polyline-/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Day 자동 나누기' }));

    const plan = store.get(splitPreviewAtom)!.plan;
    expect(plan).toEqual([[P5, P2, P3]]);
    const order = within(panel()).getByRole('list', { name: '새 순서' });
    expect(
      within(order)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Day 1: 1 창가 자리 · 2 안목 카페거리 · 3 속초 횟집(새)']);
    // 지도: 그날 핀 번호가 새 순서, 들어올 후보도 번호와 Day 색. 지금 순서의 경로선은 숨긴다.
    await waitFor(() => expect(marker(P5)).toHaveTextContent('1 창가 자리'));
    expect(marker(P2)).toHaveTextContent('2 안목 카페거리');
    expect(marker(P3)).toHaveTextContent('3 속초 횟집');
    expect(markerChip(P3).style.background).toBe(rgb(dayColor(0)));
    expect(screen.queryAllByTestId(/^polyline-/)).toHaveLength(0);

    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(marker(P2)).toHaveTextContent('1 안목 카페거리'));
    expect(marker(P3)).toHaveTextContent(/^속초 횟집$/);
  });

  it('미리보기 뒤 다른 탭이 일정을 바꿨으면 적용하지 않고 미리보기를 닫는다', async () => {
    const lib = withTrip(
      plannerLibrary(),
      makeTrip({ days: 2, stops: [[P1, P5], []], candidates: [P2, P3] }),
    );
    // 고치기 전에는 낡은 plan을 그대로 적용해 새 Stop id가 필요했다(되돌아간 결과를 보려고 넉넉히 준다).
    const { store, storage } = await open(lib, { ids: ['stopaaaa', 'stopbbbb'] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Day 자동 나누기' }));
    expect(store.get(splitPreviewAtom)!.plan[0]).toContain(P1);

    // 이 탭이 다시 읽기 전에 다른 탭이 닭강정을 Day 2로 옮겼다.
    writeAsOtherTab(storage, (l) => {
      const t = l.trips[TRIP]!;
      const [d1, d2] = t.days;
      const moved = d1!.stops.value.find((s) => s.placeId === P1)!;
      const at = '2026-10-13T03:00:30.000Z';
      const days = [
        { ...d1!, stops: { value: d1!.stops.value.filter((s) => s !== moved), updatedAt: at } },
        { ...d2!, stops: { value: [moved], updatedAt: at } },
      ];
      return { ...l, trips: { [TRIP]: { ...t, days } } };
    });
    await user.click(within(panel()).getByRole('button', { name: '적용' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('일정이 바뀌어 미리보기를 닫았어요. 다시 나눠 보세요'),
    );
    const saved = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
    const savedPlaces = (d: number) =>
      saved.trips[TRIP]!.days[d]!.stops.value.map((s) => s.placeId);
    expect(savedPlaces(0)).toEqual([P5]);
    expect(savedPlaces(1)).toEqual([P1]);
    expect(saved.trips[TRIP]!.candidates.value).toEqual([P2, P3]);
    expect(store.get(splitPreviewAtom)).toBeNull();
    expect(toastMock.mock.calls.some((c) => c[0] === 'Day 자동 나누기를 적용했어요')).toBe(false);
  });

  it('미리보기 중에 다른 편집을 하면 미리보기가 닫힌다', async () => {
    const { store } = await open(splitTrip());
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Day 자동 나누기' }));
    expect(store.get(splitPreviewAtom)).not.toBeNull();

    fireEvent.change(screen.getByLabelText('출발 시각'), { target: { value: '10:30' } });

    await waitFor(() => expect(trip(store).days[0]!.startTime.value).toBe('10:30'));
    await waitFor(() =>
      expect(within(panel()).getByRole('list', { name: '후보' })).toBeInTheDocument(),
    );
    expect(store.get(splitPreviewAtom)).toBeNull();
    expect(candidates(store)).toHaveLength(4);
  });
});

// ---------- 여행 설정 ----------

describe('여행 설정', () => {
  const settings = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '여행 설정' }));
    return { user, dialog: screen.getByRole('dialog', { name: '여행 고치기' }) };
  };
  const setEnd = (dialog: HTMLElement, value: string) =>
    fireEvent.change(within(dialog).getByLabelText('종료일'), { target: { value } });

  const threeDays = () =>
    withTrip(plannerLibrary(), makeTrip({ days: 3, stops: [[P1], [P5, P2], [P3]] }));

  it('기간을 줄이면 확인한 뒤 장소가 후보로 돌아오고 되돌리기로 Day가 살아난다', async () => {
    const { store } = await open(threeDays());
    const { user, dialog } = await settings();

    setEnd(dialog, '2026-10-24'); // 3일 → 2일: Day 3의 1곳이 잘린다
    await user.click(within(dialog).getByRole('button', { name: '저장' }));

    expect(
      within(dialog).getByText('Day 3의 1곳은 후보로 돌아가요. 바꿀까요?'),
    ).toBeInTheDocument();
    expect(trip(store).days).toHaveLength(3); // 확인 전에는 바뀌지 않는다
    await user.click(within(dialog).getByRole('button', { name: '바꾸기' }));

    await waitFor(() => expect(trip(store).days).toHaveLength(2));
    expect(candidates(store)).toEqual([P3]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const message = toastMock.mock.calls.findLast((c) => c[1]?.action?.label === '되돌리기')![0];
    await undo(message);
    await waitFor(() => expect(trip(store).days).toHaveLength(3));
    expect(dayPlaces(store, 2)).toEqual([P3]);
    expect(candidates(store)).toEqual([]);
  });

  it('잘리는 Day가 여럿이면 범위로 합쳐 묻는다', async () => {
    const { store } = await open(threeDays());
    const { user, dialog } = await settings();

    setEnd(dialog, '2026-10-23'); // 3일 → 1일: Day 2~3의 3곳
    await user.click(within(dialog).getByRole('button', { name: '저장' }));

    expect(
      within(dialog).getByText('Day 2~3의 3곳은 후보로 돌아가요. 바꿀까요?'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '바꾸기' }));
    await waitFor(() => expect(trip(store).days).toHaveLength(1));
    expect(candidates(store)).toEqual([P5, P2, P3]);
  });

  it('장소가 없는 Day를 줄일 때는 묻지 않는다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ days: 3, stops: [[P1]] }));
    const { store } = await open(lib);
    const { user, dialog } = await settings();

    setEnd(dialog, '2026-10-24');
    await user.click(within(dialog).getByRole('button', { name: '저장' }));

    await waitFor(() => expect(trip(store).days).toHaveLength(2));
    expect(screen.queryByText(/후보로 돌아가요/)).not.toBeInTheDocument();
  });

  it('기간을 늘리면 뒤에 빈 Day가 생기고 탭으로 열 수 있다', async () => {
    const { store } = await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P1], [P2]] })));
    const { user, dialog } = await settings();

    setEnd(dialog, '2026-10-25'); // 2일 → 3일
    await user.click(within(dialog).getByRole('button', { name: '저장' }));

    await waitFor(() => expect(trip(store).days).toHaveLength(3));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(dayPlaces(store, 2)).toEqual([]);
    await user.click(screen.getByRole('tab', { name: /Day 3/ }));
    expect(screen.getByText('장소를 넣어 보세요')).toBeInTheDocument();
    expect(dayPlaces(store, 0)).toEqual([P1]);
    expect(dayPlaces(store, 1)).toEqual([P2]);
  });

  it('보던 Day가 기간을 줄여 사라지면 마지막 Day로 옮기고, 다시 늘려도 예전 Day로 넘어가지 않는다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ days: 3, stops: [[P1]] }));
    const { store } = await open(lib);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /^Day 3/ }));
    expect(store.get(selectedDayAtom)[TRIP]).toBe(2);

    let { dialog } = await settings();
    setEnd(dialog, '2026-10-23'); // 3일 → 1일
    await user.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(trip(store).days).toHaveLength(1));
    await waitFor(() => expect(store.get(selectedDayAtom)[TRIP]).toBe(0));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    ({ dialog } = await settings());
    setEnd(dialog, '2026-10-25'); // 1일 → 3일
    await user.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(trip(store).days).toHaveLength(3));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /^Day 1/ })).toHaveAttribute('aria-selected', 'true');
    expect(store.get(selectedDayAtom)[TRIP]).toBe(0);
  });

  it('제목도 여기서 고친다', async () => {
    const { store } = await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P1]] })));
    const { user, dialog } = await settings();
    const input = within(dialog).getByLabelText('여행 이름');
    expect(input).toHaveValue('강릉 여행');
    await user.clear(input);
    await user.type(input, '속초 여행');
    await user.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(trip(store).title.value).toBe('속초 여행'));
  });
});
