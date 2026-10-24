import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer, Result } from 'effect';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARE_DATA_PLACEHOLDER } from 'src/domain/share/inject';
import { readShareHtml } from 'src/domain/share/read-share';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import { ShareFileDialog } from 'src/sections/share-export/ShareFileDialog';
import { tooManyHint } from 'src/sections/share-export/TripShareDialog';
import { RouteLookupError } from 'src/services/errors';
import { RouteLookup } from 'src/services/route-lookup';
import { makePlace, renderLibrary, sampleLibrary, withPlaces } from '../library/fixtures';
import {
  fakeRoutes,
  HOUSE,
  makeTrip,
  open,
  P1,
  P2,
  P3,
  nameAt,
  P5,
  plannerLibrary,
  route,
  withTrip,
} from '../trips/planner-fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
const downloadMock = vi.hoisted(() => vi.fn());
vi.mock('src/lib/download-text', () => ({ downloadText: downloadMock }));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

/** 공유 API를 흉내 낸다(파일 공유가 되는 기기). */
function stubShare(share: (data: ShareData) => Promise<void>) {
  const shareFn = vi.fn(share);
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
  Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true });
  return shareFn;
}

beforeEach(() => {
  // 파일 이름의 날짜를 고정한다(타이머는 진짜 그대로).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 18, 12));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  toastMock.mockClear();
  toastMock.error.mockClear();
  downloadMock.mockClear();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

const dialog = () => screen.getByRole('dialog', { name: '일정 공유' });
const saveButton = () => within(dialog()).getByRole('button', { name: '파일 저장' });
const memoBox = () => within(dialog()).getByRole('checkbox', { name: '메모 포함' });
const statusLine = () => within(dialog()).getByRole('status');

/** 여행 목록 카드 메뉴에서 일정 공유 창을 연다. */
async function openFromList(user: ReturnType<typeof userEvent.setup>, title = '강릉 여행') {
  await user.click(screen.getByRole('button', { name: `‘${title}’ 메뉴` }));
  await user.click(screen.getByRole('menuitem', { name: '일정 공유' }));
  // 창은 처음 열 때 받으므로 한 박자 동안은 기다림 틀이 뜨고, 실제 창이 그것을 바꿔 놓는다.
  await screen.findByRole('textbox', { name: '제목' });
  return dialog();
}

/** 저장한 html의 데이터 블록을 읽는다. */
function savedDoc(): {
  version: number;
  title: string;
  places: Array<{ id: string; memo?: string }>;
  trips: Array<{ candidateIds: string[]; days: Array<{ legs: Array<{ status: string }> }> }>;
} {
  const html = downloadMock.mock.calls[0]![0] as string;
  const m = /<script type="application\/json" id="tripmap-share">(.*)<\/script>/s.exec(html);
  return JSON.parse(m![1]!) as ReturnType<typeof savedDoc>;
}

/** `answered(출발, 도착)`이 참인 구간만 답하고(10분·1km), 나머지는 끝나지 않는 가짜 경로 조회. */
function pendingRoutes(answered: (from: string, to: string) => boolean): Layer.Layer<RouteLookup> {
  let seq = 0;
  return Layer.succeed(
    RouteLookup,
    RouteLookup.of({
      leg: (_mode, from, to) =>
        Effect.suspend(() =>
          answered(nameAt(from), nameAt(to))
            ? Effect.succeed({ ...route(10, 1000), seq: ++seq, fresh: false })
            : Effect.never,
        ),
    }),
  );
}

// ---------- 창 문구·상태 ----------

describe('일정 공유 창', () => {
  // Day 1: 바다 숙소(출발지) → 닭강정 → 카페거리, Day 2: 창가 자리. 후보: 속초 횟집.
  const lib = (candidates: string[] = [P3]) =>
    withTrip(plannerLibrary(), makeTrip({ origin: HOUSE, stops: [[P1, P2], [P5]], candidates }));

  it('대상 문구 두 줄과 후보 체크, 기본 제목을 보이고 후보를 끄면 후보 수가 빠진다', async () => {
    const user = userEvent.setup();
    await open(lib(), { routes: fakeRoutes(() => route(10, 1000)), path: '/trips' });
    const d = await openFromList(user);
    expect(within(d).getByText('‘강릉 여행’ 일정을 HTML 파일 하나로 만들어요')).toBeInTheDocument();
    expect(within(d).getByText('Day 2개 · 일정 3곳 · 후보 1곳')).toBeInTheDocument();
    expect(within(d).getByRole('textbox', { name: '제목' })).toHaveValue('강릉 여행');
    expect(memoBox()).toBeChecked();
    const candidates = within(d).getByRole('checkbox', { name: '후보 1곳도 넣기' });
    expect(candidates).toBeChecked();

    await user.click(candidates);
    expect(within(d).getByText('Day 2개 · 일정 3곳')).toBeInTheDocument();
    expect(within(d).queryByText(/후보 1곳$/)).not.toBeInTheDocument();
  });

  it('후보가 0곳이면 후보 체크가 없다', async () => {
    const user = userEvent.setup();
    await open(lib([]), { routes: fakeRoutes(() => route(10, 1000)), path: '/trips' });
    const d = await openFromList(user);
    expect(within(d).getByText('Day 2개 · 일정 3곳')).toBeInTheDocument();
    expect(within(d).queryByRole('checkbox', { name: /후보/ })).not.toBeInTheDocument();
  });

  it('받는 중에는 받은 수/전체를 보인다', async () => {
    const user = userEvent.setup();
    // 구간: 숙소→닭강정(답), 닭강정→카페거리·카페거리→창가 자리(끝나지 않음).
    const routeLookup = pendingRoutes((_from, to) => to === '중앙시장 닭강정');
    const trip = makeTrip({ origin: HOUSE, stops: [[P1, P2, P5]] });
    await renderLibrary(withTrip(plannerLibrary(), trip), { path: '/trips', routeLookup });
    await openFromList(user);
    await waitFor(() => expect(statusLine()).toHaveTextContent('이동 경로를 받는 중이에요 (1/3)'));
  });

  it('다 받았고 어림값 구간이 있으면 그 수를 보인다', async () => {
    const user = userEvent.setup();
    const routes = fakeRoutes((call) =>
      call.to === '안목 카페거리' ? 'NO_ROUTE' : route(10, 1000),
    );
    await open(lib(), { routes, path: '/trips' });
    await openFromList(user);
    await waitFor(() =>
      expect(statusLine()).toHaveTextContent('1구간은 경로를 받지 못해 어림값으로 들어가요'),
    );
  });

  it('모두 받았으면 가장 오래된 조회 날짜를 보인다', async () => {
    const user = userEvent.setup();
    const routes = fakeRoutes((call) =>
      route(10, 1000, {
        queriedAt:
          call.to === '안목 카페거리' ? '2026-10-16T03:00:00.000Z' : '2026-10-17T03:00:00.000Z',
      }),
    );
    await open(lib(), { routes, path: '/trips' });
    await openFromList(user);
    await waitFor(() =>
      expect(statusLine()).toHaveTextContent('이동 시간은 10월 16일 조회 기준이에요'),
    );
  });

  it('구간이 없으면 상태 줄이 없다', async () => {
    const user = userEvent.setup();
    await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P1]] })), { path: '/trips' });
    const d = await openFromList(user);
    expect(within(d).queryByRole('status')).not.toBeInTheDocument();
  });

  it('일정이 0곳이고 후보도 없으면 안내를 보이고 저장을 막는다', async () => {
    const user = userEvent.setup();
    await open(withTrip(plannerLibrary(), makeTrip()), { path: '/trips' });
    const d = await openFromList(user);
    expect(within(d).getByText('Day 2개 · 일정 0곳')).toBeInTheDocument();
    expect(within(d).getByText('일정에 넣은 장소가 없어요')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('일정이 0곳이고 후보를 끄면 안내를 보이고 두 버튼을 막는다', async () => {
    const user = userEvent.setup();
    stubShare(() => Promise.resolve());
    await open(withTrip(plannerLibrary(), makeTrip({ candidates: [P3] })), { path: '/trips' });
    const d = await openFromList(user);
    expect(saveButton()).toBeEnabled();
    expect(within(d).queryByText('일정에 넣은 장소가 없어요')).not.toBeInTheDocument();

    await user.click(within(d).getByRole('checkbox', { name: '후보 1곳도 넣기' }));
    expect(within(d).getByText('일정에 넣은 장소가 없어요')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(await within(d).findByRole('button', { name: '공유' })).toBeDisabled();
  });

  it('파일 저장은 v2 데이터가 든 html을 <제목>-YYYYMMDD.html로 저장하고 토스트한다', async () => {
    const user = userEvent.setup();
    const routes = fakeRoutes((call) =>
      call.to === '안목 카페거리' ? 'NO_ROUTE' : route(10, 1000),
    );
    await open(lib(), { routes, path: '/trips' });
    await openFromList(user);
    await waitFor(() => expect(statusLine()).toHaveTextContent('1구간은'));
    await user.click(saveButton());

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const [html, fileName, type] = downloadMock.mock.calls[0]!;
    expect(fileName).toBe('강릉-여행-20261018.html');
    expect(type).toBe('text/html;charset=utf-8');
    expect(html).not.toContain(SHARE_DATA_PLACEHOLDER);
    const doc = savedDoc();
    expect(doc.version).toBe(2);
    expect(doc.title).toBe('강릉 여행');
    expect(doc.trips[0]!.candidateIds).toEqual([P3]);
    expect(doc.trips[0]!.days[0]!.legs.map((l) => l.status)).toEqual(['routed', 'no-route']);
    expect(toastMock).toHaveBeenCalledWith('파일을 만들었어요');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('받는 중·연결 실패인 구간은 경로선 없는 어림값(estimated)으로 저장한다', async () => {
    const user = userEvent.setup();
    // 닭강정→카페거리는 끝나지 않고(받는 중), 카페거리→창가 자리는 연결 실패다.
    let seq = 0;
    const routeLookup = Layer.succeed(
      RouteLookup,
      RouteLookup.of({
        leg: (_mode, _from, to) =>
          Effect.suspend(() =>
            nameAt(to) === '안목 카페거리'
              ? Effect.never
              : Effect.fail(new RouteLookupError({ code: 'OFFLINE', seq: ++seq, fresh: false })),
          ),
      }),
    );
    const trip = makeTrip({ stops: [[P1, P2, P5]] });
    await renderLibrary(withTrip(plannerLibrary(), trip), { path: '/trips', routeLookup });
    await openFromList(user);
    await waitFor(() => expect(statusLine()).toHaveTextContent('이동 경로를 받는 중이에요 (1/2)'));
    await user.click(saveButton());

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const legs = savedDoc().trips[0]!.days[0]!.legs as unknown as Array<Record<string, unknown>>;
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(leg).toMatchObject({ status: 'estimated', path: [], queriedAt: null });
    }
  });

  it('후보를 끄고 저장하면 후보가 빠진다', async () => {
    const user = userEvent.setup();
    await open(lib(), { routes: fakeRoutes(() => route(10, 1000)), path: '/trips' });
    const d = await openFromList(user);
    await user.click(within(d).getByRole('checkbox', { name: '후보 1곳도 넣기' }));
    await user.click(saveButton());
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const doc = savedDoc();
    expect(doc.trips[0]!.candidateIds).toEqual([]);
    expect(doc.places.map((p) => p.id)).not.toContain(P3);
  });

  it('다시 열면 후보 체크가 켜진 상태로 돌아온다', async () => {
    const user = userEvent.setup();
    await open(lib(), { routes: fakeRoutes(() => route(10, 1000)), path: '/trips' });
    const d = await openFromList(user);
    await user.click(within(d).getByRole('checkbox', { name: '후보 1곳도 넣기' }));
    await user.click(within(d).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const again = await openFromList(user);
    expect(within(again).getByRole('checkbox', { name: '후보 1곳도 넣기' })).toBeChecked();
  });
});

// ---------- 크기 한도 ----------

const BIG_MEMO = '가'.repeat(10_000);

/**
 * 메모 10,000자(한글)인 장소 300곳: 일정 200곳(4일 × 50곳), 후보 100곳. 모두 같은 좌표라 경로를 묻지 않는다.
 * 메모만 약 9MB라 한도를 넘고, 후보를 빼도(약 6MB) 넘는다.
 */
function bigLibrary(): Library {
  const places = Array.from({ length: 300 }, (_, i) =>
    makePlace(100 + i, { name: `큰 장소 ${i}`, memo: BIG_MEMO }),
  );
  const ids = places.map((p) => p.id);
  const stops = [0, 1, 2, 3].map((d) => ids.slice(d * 50, d * 50 + 50));
  const trip = makeTrip({ days: 4, stops, candidates: ids.slice(200) });
  return withTrip(withPlaces(sampleLibrary(), places), trip);
}

const TOO_BIG = /^파일이 너무 커요\(약 \d+\.\dMB\)\. Landmark는 5MB까지 가져올 수 있어요\. (.+)$/;

describe('일정 공유 크기 한도', () => {
  it('한도를 넘으면 저장·공유하지 않고 켜진 체크로 줄이는 방법을 말한다', async () => {
    const user = userEvent.setup();
    const share = stubShare(() => Promise.resolve());
    await renderLibrary(bigLibrary(), { path: '/trips' });
    const d = await openFromList(user);
    expect(within(d).getByText('Day 4개 · 일정 200곳 · 후보 100곳')).toBeInTheDocument();

    await user.click(saveButton());
    const alert = await within(d).findByRole('alert');
    expect(alert.textContent).toMatch(TOO_BIG);
    expect(TOO_BIG.exec(alert.textContent!)![1]).toBe(
      "'메모 포함'이나 '후보 100곳도 넣기'를 끄고 다시 해 주세요",
    );
    expect(downloadMock).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();

    await user.click(await within(d).findByRole('button', { name: '공유' }));
    expect(share).not.toHaveBeenCalled();
    expect((await within(d).findByRole('alert')).textContent).toMatch(
      /'메모 포함'이나 '후보 100곳도 넣기'를 끄고 다시 해 주세요$/,
    );

    // 후보만 끄면 일정 200곳(약 6MB)이라 아직 넘는다.
    await user.click(within(d).getByRole('checkbox', { name: '후보 100곳도 넣기' }));
    await user.click(saveButton());
    await waitFor(() =>
      expect(within(d).getByRole('alert').textContent).toMatch(
        /\. '메모 포함'을 끄고 다시 해 주세요$/,
      ),
    );
    expect(downloadMock).not.toHaveBeenCalled();

    // 메모를 끄면 저장된다.
    await user.click(memoBox());
    await user.click(saveButton());
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith('파일을 만들었어요');
    expect(savedDoc().places.every((p) => p.memo === undefined)).toBe(true);
  }, 60_000);
});

// ---------- ShareFileDialog 크기 검사 ----------

describe('ShareFileDialog 크기 검사', () => {
  /** 런타임(틀 받기)만 준비하고 창을 따로 그린다. `bytes`바이트(ASCII)인 html을 만드는 가짜 `make`. */
  async function renderShareFile(bytes: number, withHint: boolean) {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    const onClose = vi.fn();
    const make = vi.fn(() =>
      Result.succeed({ html: 'a'.repeat(bytes), fileName: '시험-20261018.html', count: 1 }),
    );
    await act(async () => {
      render(
        <ShareFileDialog
          open
          onClose={onClose}
          heading="시험 창"
          summary="시험 문구"
          defaultTitle="시험"
          emptyMessage={null}
          make={make}
          tooBigHint={withHint ? () => '줄여 주세요' : undefined}
        />,
        { wrapper: MemoryRouter },
      );
    });
    const d = screen.getByRole('dialog', { name: '시험 창' });
    return { d, onClose, make };
  }

  it('정확히 5,242,880바이트면 저장한다', async () => {
    const user = userEvent.setup();
    const { d, onClose } = await renderShareFile(5_242_880, true);
    await user.click(within(d).getByRole('button', { name: '파일 저장' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('파일을 만들었어요');
  });

  it('5,242,881바이트면 막는다', async () => {
    const user = userEvent.setup();
    const { d, onClose, make } = await renderShareFile(5_242_881, true);
    await user.click(within(d).getByRole('button', { name: '파일 저장' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent(
      '파일이 너무 커요(약 5.0MB). Landmark는 5MB까지 가져올 수 있어요. 줄여 주세요',
    );
    expect(downloadMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(make).toHaveBeenCalledWith(expect.any(String), {
      title: '시험',
      includeMemo: true,
      now: expect.any(Date),
    });
    // 다음에 누르면 다시 잰다.
    await user.click(within(d).getByRole('button', { name: '파일 저장' }));
    await waitFor(() => expect(make).toHaveBeenCalledTimes(2));
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('tooBigHint가 없으면 넘어도 저장한다', async () => {
    const user = userEvent.setup();
    const { d } = await renderShareFile(5_242_881, false);
    await user.click(within(d).getByRole('button', { name: '파일 저장' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(within(d).queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ---------- 장소 내보내기(v1)의 크기 검사 (스펙 §13 결정 9 (a)) ----------

describe('내보내기 크기 한도', () => {
  it('메모가 큰 장소로 한도를 넘으면 막고 메모를 끄면 저장한다', async () => {
    const user = userEvent.setup();
    const places = Array.from({ length: 200 }, (_, i) =>
      makePlace(100 + i, { name: `큰 장소 ${i}`, memo: BIG_MEMO }),
    );
    await renderLibrary(withPlaces(sampleLibrary(), places), {
      prefs: { libraryView: 'list' },
    });
    await user.click(screen.getByRole('button', { name: '내보내기' }));
    await screen.findByRole('textbox', { name: '제목' });
    const d = screen.getByRole('dialog', { name: '내보내기' });

    await user.click(within(d).getByRole('button', { name: '파일 저장' }));
    const alert = await within(d).findByRole('alert');
    expect(alert.textContent).toMatch(TOO_BIG);
    expect(TOO_BIG.exec(alert.textContent!)![1]).toBe(
      "'메모 포함'을 끄거나 장소 수를 줄여 다시 해 주세요",
    );
    expect(downloadMock).not.toHaveBeenCalled();

    await user.click(within(d).getByRole('checkbox', { name: '메모 포함' }));
    await user.click(within(d).getByRole('button', { name: '파일 저장' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith('파일을 만들었어요');
  }, 60_000);
});

// ---------- 장소 수 한도 (가져오기 1,000곳) ----------

const TOO_MANY =
  /^장소가 너무 많아요\(([\d,]+)곳\)\. Landmark는 1,000곳까지 가져올 수 있어요\. (.+)$/;

describe('ShareFileDialog 장소 수 검사', () => {
  /** 런타임(틀 받기)만 준비하고 창을 따로 그린다. 장소 `count`곳·`bytes`바이트인 html을 만드는 가짜 `make`. */
  async function renderShareFile(count: number, withHint: boolean, bytes = 10) {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    const onClose = vi.fn();
    const make = vi.fn(() =>
      Result.succeed({ html: 'a'.repeat(bytes), fileName: '시험-20261018.html', count }),
    );
    const hint = vi.fn(() => '나눠 주세요');
    await act(async () => {
      render(
        <ShareFileDialog
          open
          onClose={onClose}
          heading="시험 창"
          summary="시험 문구"
          defaultTitle="시험"
          emptyMessage={null}
          make={make}
          tooBigHint={() => '줄여 주세요'}
          tooManyHint={withHint ? hint : undefined}
        />,
        { wrapper: MemoryRouter },
      );
    });
    const d = screen.getByRole('dialog', { name: '시험 창' });
    return { d, onClose, make, hint };
  }

  it('정확히 1,000곳이면 저장한다', async () => {
    const user = userEvent.setup();
    const { d, onClose } = await renderShareFile(1000, true);
    await user.click(within(d).getByRole('button', { name: '파일 저장' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('1,001곳이면 저장·공유하지 않고 알린다(누를 때마다 다시 본다)', async () => {
    const user = userEvent.setup();
    const share = stubShare(() => Promise.resolve());
    const { d, onClose, make, hint } = await renderShareFile(1001, true);
    await user.click(within(d).getByRole('button', { name: '파일 저장' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent(
      '장소가 너무 많아요(1,001곳). Landmark는 1,000곳까지 가져올 수 있어요. 나눠 주세요',
    );
    expect(hint).toHaveBeenCalledWith({ title: '시험', includeMemo: true, now: expect.any(Date) });
    expect(downloadMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();

    await user.click(await within(d).findByRole('button', { name: '공유' }));
    await waitFor(() => expect(make).toHaveBeenCalledTimes(2));
    expect(share).not.toHaveBeenCalled();
    expect(within(d).getByRole('alert').textContent).toMatch(TOO_MANY);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('장소 수 검사가 크기 검사보다 먼저다', async () => {
    const user = userEvent.setup();
    const { d } = await renderShareFile(1001, true, 5_242_881);
    await user.click(within(d).getByRole('button', { name: '파일 저장' }));
    expect((await within(d).findByRole('alert')).textContent).toMatch(TOO_MANY);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('tooManyHint가 없으면 1,001곳이어도 저장한다', async () => {
    const user = userEvent.setup();
    const { d } = await renderShareFile(1001, false);
    await user.click(within(d).getByRole('button', { name: '파일 저장' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(within(d).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('일정 공유 장소 수 한도', () => {
  /** 모두 같은 좌표라 경로를 묻지 않는다. 일정 `stops`곳(Day 1) + 후보 `candidates`곳. */
  function manyLibrary(stops: number, candidates: number): Library {
    const places = Array.from({ length: stops + candidates }, (_, i) => makePlace(100 + i));
    const ids = places.map((p) => p.id);
    const trip = makeTrip({ days: 1, stops: [ids.slice(0, stops)], candidates: ids.slice(stops) });
    return withTrip(withPlaces(sampleLibrary(), places), trip);
  }

  it('정확히 1,000곳(일정 1곳 + 후보 999곳)이면 저장한다', async () => {
    const user = userEvent.setup();
    await renderLibrary(manyLibrary(1, 999), { path: '/trips' });
    await openFromList(user);
    await user.click(saveButton());
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const read = readShareHtml(downloadMock.mock.calls[0]![0] as string);
    expect(read.ok && read.doc.places).toHaveLength(1000);
  }, 60_000);

  it('1,001곳(일정 2곳 + 후보 999곳)이면 막고 후보를 끄라고 말한다. 끄면 저장되고 다시 읽힌다', async () => {
    const user = userEvent.setup();
    const share = stubShare(() => Promise.resolve());
    await renderLibrary(manyLibrary(2, 999), { path: '/trips' });
    const d = await openFromList(user);

    await user.click(saveButton());
    const alert = await within(d).findByRole('alert');
    expect(alert.textContent).toBe(
      "장소가 너무 많아요(1,001곳). Landmark는 1,000곳까지 가져올 수 있어요. '후보 999곳도 넣기'를 끄고 다시 해 주세요",
    );
    expect(downloadMock).not.toHaveBeenCalled();
    await user.click(await within(d).findByRole('button', { name: '공유' }));
    expect(share).not.toHaveBeenCalled();

    await user.click(within(d).getByRole('checkbox', { name: '후보 999곳도 넣기' }));
    await user.click(saveButton());
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const read = readShareHtml(downloadMock.mock.calls[0]![0] as string);
    expect(read.ok).toBe(true);
    expect(read.ok && read.doc.places).toHaveLength(2);
  }, 60_000);

  it('줄이는 방법: 후보가 켜져 있고 1곳 이상이면 후보 체크를, 아니면 일정을 나누라고 말한다', () => {
    expect(tooManyHint(999)).toBe("'후보 999곳도 넣기'를 끄고 다시 해 주세요");
    expect(tooManyHint(null)).toBe('일정을 나눠 보내 주세요');
  });
});
