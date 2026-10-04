import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore } from 'jotai';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from 'src/app';
import { hashDayStops } from 'src/domain/day-hash';
import { encodeEditLayer } from 'src/domain/codec';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import { routes } from 'src/routes/router';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import { TripDepsContext } from 'src/stores/trip-store';
import { makeEdit, makeTrip, sid } from '../../fixtures/builders';
import { createHeldLocks } from '../../fixtures/fake-locks';

const PID = 'testtrip0001';
const KEY = storageKey(PID);
const NOW_MS = 1759460000000;
const NOW_ISO = '2026-10-03T02:00:00.000Z';
const OLD = '2026-10-03T00:30:00.000Z';
const LATER = '2026-10-03T01:00:00.000Z';
const NEWER_DATA = '2026-10-04T00:00:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';

const trip = makeTrip({ days: { [D1]: ['A', 'B'], [D2]: ['C'] } });
const ROUTER_STATE = { usr: null, key: 'k1', idx: 3 };
const baseHash = hashDayStops(trip.days[0]!.stops);
const stopA = trip.days[0]!.stops[0]!;
const stopB = trip.days[0]!.stops[1]!;

const CHANGED_NOTICE = '다른 탭에서 편집이 바뀌어 미리보기를 새로 만들었어요';

const saved = (storage: Storage): EditLayer => JSON.parse(storage.getItem(KEY)!) as EditLayer;

function incomingEdit(overrides: Partial<EditLayer> = {}): EditLayer {
  return makeEdit({
    authorId: 'a-remote',
    authors: { 'a-remote': { nickname: '친구', updatedAt: OLD } },
    places: { 'n:2': { memos: { 'a-remote': { text: '받은 메모', updatedAt: OLD } } } },
    ...overrides,
  });
}

/** L1: 저장소에만 있는 최신 로컬 — p1(n:1) 메모와 태그. */
function withP1(edit: EditLayer): EditLayer {
  return {
    ...edit,
    places: {
      ...edit.places,
      'n:1': {
        memos: { 'a-local': { text: 'p1 메모', updatedAt: OLD } },
        tags: { value: ['L1태그'], updatedAt: OLD },
      },
    },
  };
}

function renderPage(
  opts: {
    storage?: Storage;
    hash?: string;
    refetchTrip?: TripData;
    locks?: LockManager;
  } = {},
) {
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  const storage = opts.storage ?? createMemoryStorage();
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const body = init?.cache === 'no-cache' ? (opts.refetchTrip ?? trip) : trip;
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  // react-router(BrowserRouter)가 history.state에 두는 값을 흉내 낸다. 해시를 지워도 남아야 한다.
  if (opts.hash !== undefined)
    window.history.replaceState(ROUTER_STATE, '', `/t/${PID}${opts.hash}`);
  const router = createMemoryRouter(routes, { initialEntries: [`/t/${PID}`] });
  render(
    <TripDepsContext
      value={{
        storage,
        fetchFn,
        now: () => NOW_MS,
        nowIso: () => NOW_ISO,
        randomId: () => 'a-new',
        jotaiStore: createStore(),
        ...(opts.locks ? { locks: opts.locks } : {}),
      }}
    >
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </TripDepsContext>,
  );
  return { storage, fetchFn };
}

function storageWith(edit: EditLayer): Storage {
  const storage = createMemoryStorage();
  storage.setItem(KEY, JSON.stringify(edit));
  return storage;
}

const linkHash = async (edit: EditLayer) => `#e=${await encodeEditLayer(edit)}`;

const importDialog = () => screen.findByRole('dialog', { name: '편집 가져오기' });

async function enterNickname(user: ReturnType<typeof userEvent.setup>, nickname: string) {
  const dialog = await screen.findByRole('dialog', { name: '닉네임 입력' });
  await user.type(within(dialog).getByLabelText('닉네임'), nickname);
  await user.click(within(dialog).getByRole('button', { name: '저장' }));
}

// 라우트가 TripPage를 지연 로드하므로, 부하가 큰 전체 실행에서 첫 테스트가 findBy 시간을 넘지 않게 미리 불러 둔다.
beforeAll(async () => {
  await import('src/pages/TripPage');
}, 20_000);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('잠금 대기 중 취소(§5.3)', () => {
  it('확인 후 다른 탭이 잠금을 쥔 동안 취소하면, 잠금이 풀려도 저장하지 않고 오류도 띄우지 않는다', async () => {
    const user = userEvent.setup();
    const storage = storageWith(makeEdit());
    const before = storage.getItem(KEY);
    const held = createHeldLocks();
    renderPage({ storage, locks: held.locks, hash: await linkHash(incomingEdit()) });

    const dialog = await importDialog();
    const confirmButton = await within(dialog).findByRole('button', { name: '가져오기' });
    held.hold();
    const requestsBefore = held.requested.length;
    await user.click(confirmButton);
    await vi.waitFor(() => expect(held.requested.length).toBe(requestsBefore + 1));

    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '편집 가져오기' })).toBeNull(),
    );
    held.release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(storage.getItem(KEY)).toBe(before);
    expect(screen.queryByText('편집을 가져왔어요')).toBeNull();
    expect(screen.queryByText('가져온 편집을 저장하지 못했어요')).toBeNull();
    expect(screen.queryByRole('dialog', { name: '편집 가져오기' })).toBeNull();
  });
});

describe('#e= 링크 진입', () => {
  it('대화상자가 열리고 해시는 바로 지워지며, 취소해도 저장소는 그대로', async () => {
    const user = userEvent.setup();
    const local = makeEdit();
    const storage = storageWith(local);
    const before = storage.getItem(KEY);
    renderPage({ storage, hash: await linkHash(incomingEdit()) });

    const dialog = await importDialog();
    expect(await within(dialog).findByText('메모 추가 1 · 변경 0 · 삭제 0')).toBeInTheDocument();
    expect(location.hash).toBe('');
    expect(location.pathname).toBe(`/t/${PID}`);
    expect(window.history.state).toEqual(ROUTER_STATE);

    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '편집 가져오기' })).toBeNull(),
    );
    expect(location.hash).toBe('');
    expect(storage.getItem(KEY)).toBe(before);
  });

  it('확인하면 병합 결과를 저장하고 화면 atom도 새로 읽는다', async () => {
    const user = userEvent.setup();
    const storage = storageWith(makeEdit());
    renderPage({ storage, hash: await linkHash(incomingEdit()) });

    const dialog = await importDialog();
    await user.click(await within(dialog).findByRole('button', { name: '가져오기' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '편집 가져오기' })).toBeNull(),
    );
    expect(saved(storage).places['n:2']?.memos['a-remote']?.text).toBe('받은 메모');
    expect(saved(storage).authors['a-remote']?.nickname).toBe('친구');
    expect(await screen.findByText('편집을 가져왔어요')).toBeInTheDocument();
  });
});

describe('충돌 선택', () => {
  const localDays: EditLayer['days'] = {
    [D1]: { mode: 'override', stops: [stopB, stopA], baseDayHash: baseHash, updatedAt: OLD },
  };
  const incomingDays: EditLayer['days'] = {
    [D1]: { mode: 'override', stops: [stopB], baseDayHash: baseHash, updatedAt: LATER },
  };

  it('기본값은 defaultSide, 반대쪽을 고르면 그 상태에 현재 시각을 찍는다', async () => {
    const user = userEvent.setup();
    const storage = storageWith(makeEdit({ days: localDays }));
    renderPage({ storage, hash: await linkHash(incomingEdit({ days: incomingDays })) });

    const dialog = await importDialog();
    const group = await within(dialog).findByRole('radiogroup', { name: 'Day 1' });
    expect(within(group).getByRole('radio', { name: '받은 것' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: '내 것' })).not.toBeChecked();

    await user.click(within(group).getByRole('radio', { name: '내 것' }));
    await user.click(within(dialog).getByRole('button', { name: '가져오기' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '편집 가져오기' })).toBeNull(),
    );
    expect(saved(storage).days[D1]).toEqual({
      mode: 'override',
      stops: [stopB, stopA],
      baseDayHash: baseHash,
      updatedAt: NOW_ISO,
    });
  });

  it('기본값 그대로 확인하면 원래 updatedAt을 유지한다', async () => {
    const user = userEvent.setup();
    const storage = storageWith(makeEdit({ days: localDays }));
    renderPage({ storage, hash: await linkHash(incomingEdit({ days: incomingDays })) });

    const dialog = await importDialog();
    await user.click(await within(dialog).findByRole('button', { name: '가져오기' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '편집 가져오기' })).toBeNull(),
    );
    expect(saved(storage).days[D1]).toEqual(incomingDays[D1]);
  });

  it('여행 기간 밖 날짜의 충돌은 그렇게 표시한다', async () => {
    const out = '2026-12-01';
    const local = makeEdit({
      days: { [out]: { mode: 'override', stops: [], baseDayHash: 'x', updatedAt: OLD } },
    });
    const incoming = incomingEdit({
      days: { [out]: { mode: 'reset', updatedAt: LATER } },
    });
    renderPage({ storage: storageWith(local), hash: await linkHash(incoming) });
    const dialog = await importDialog();
    expect(
      await within(dialog).findByRole('radiogroup', { name: `여행 기간 밖 날짜(${out})` }),
    ).toBeInTheDocument();
  });
});

describe('미리보기 내용', () => {
  it('태그·숨김 from → to와 정리 내역(제거될 방문·표시되지 않을 날짜)을 보여 준다', async () => {
    const local = makeEdit({
      places: { 'n:1': { memos: {}, tags: { value: ['원래'], updatedAt: OLD } } },
    });
    const incoming = incomingEdit({
      places: {
        'n:1': {
          memos: {},
          tags: { value: ['새것'], updatedAt: LATER },
          hidden: { value: true, updatedAt: LATER },
        },
      },
      days: {
        [D2]: {
          mode: 'override',
          stops: [trip.days[1]!.stops[0]!, { id: sid('Z'), placeKey: 'n:99' }],
          baseDayHash: hashDayStops(trip.days[1]!.stops),
          updatedAt: LATER,
        },
        '2026-12-25': { mode: 'reset', updatedAt: LATER },
      },
    });
    renderPage({ storage: storageWith(local), hash: await linkHash(incoming) });
    const dialog = await importDialog();
    expect(await within(dialog).findByText('A: 태그 원래 → 새것')).toBeInTheDocument();
    expect(within(dialog).getByText('A: 숨김 없음 → 숨김')).toBeInTheDocument();
    expect(within(dialog).getByText('제거될 방문: n:99 (Day 2)')).toBeInTheDocument();
    expect(within(dialog).getByText('표시되지 않을 날짜: 2026-12-25')).toBeInTheDocument();
  });

  it('원본이 바뀐 날을 보여 준다', async () => {
    const incoming = incomingEdit({
      days: {
        [D1]: { mode: 'override', stops: [stopB, stopA], baseDayHash: 'old', updatedAt: LATER },
      },
    });
    renderPage({ storage: storageWith(makeEdit()), hash: await linkHash(incoming) });
    const dialog = await importDialog();
    expect(await within(dialog).findByText('원본이 바뀐 날: Day 1')).toBeInTheDocument();
  });
});

describe('실패', () => {
  it('trip-stale → 문구, 저장소 미변경', async () => {
    const storage = storageWith(makeEdit());
    const before = storage.getItem(KEY);
    const { fetchFn } = renderPage({
      storage,
      hash: await linkHash(incomingEdit({ baseDataVersion: NEWER_DATA })),
    });
    const dialog = await importDialog();
    expect(
      await within(dialog).findByText(
        '최신 여행 데이터가 아직 반영되지 않았어요. 잠시 후 다시 시도하세요.',
      ),
    ).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledWith(`/data/${PID}.json`, { cache: 'no-cache' });
    expect(storage.getItem(KEY)).toBe(before);
    expect(within(dialog).queryByRole('button', { name: '가져오기' })).toBeNull();
  });

  it('다른 여행 → 문구', async () => {
    renderPage({
      storage: storageWith(makeEdit()),
      hash: await linkHash(incomingEdit({ publicId: 'othertrip001' })),
    });
    expect(
      await within(await importDialog()).findByText('다른 여행의 편집이에요'),
    ).toBeInTheDocument();
  });

  it('병합 검증 실패(ok: false) → 사유를 보여 주고 미리보기와 저장소를 유지', async () => {
    const user = userEvent.setup();
    const authors = (prefix: string, self: string, nick: string) => {
      const out: EditLayer['authors'] = { [self]: { nickname: nick, updatedAt: OLD } };
      for (let i = 0; i < 25; i++)
        out[`${prefix}${i}`] = { nickname: `${prefix}${i}`, updatedAt: OLD };
      return out;
    };
    const storage = storageWith(makeEdit({ authors: authors('l', 'a-local', '나') }));
    const before = storage.getItem(KEY);
    renderPage({
      storage,
      hash: await linkHash(incomingEdit({ authors: authors('r', 'a-remote', '친구') })),
    });
    const dialog = await importDialog();
    await user.click(await within(dialog).findByRole('button', { name: '가져오기' }));
    expect(await within(dialog).findByText(/병합 결과가 유효하지 않아요/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '가져오기' })).toBeInTheDocument();
    expect(storage.getItem(KEY)).toBe(before);
  });
});

describe('저장소 최신성', () => {
  it('atom은 오래되고 저장소는 최신(이벤트 없음) → 미리보기·결과가 저장소 기준', async () => {
    const user = userEvent.setup();
    const l0 = makeEdit();
    const storage = storageWith(l0);
    renderPage({ storage });
    expect(await screen.findByRole('heading', { name: '테스트 여행' })).toBeInTheDocument();
    storage.setItem(KEY, JSON.stringify(withP1(l0)));

    const incoming = incomingEdit({
      places: {
        'n:1': { memos: {}, tags: { value: ['받은태그'], updatedAt: LATER } },
        'n:2': { memos: { 'a-remote': { text: '받은 메모', updatedAt: OLD } } },
      },
    });
    const file = new File([JSON.stringify(incoming)], 'x.tripedit.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('편집 파일 선택'), file);

    const dialog = await importDialog();
    expect(await within(dialog).findByText('A: 태그 L1태그 → 받은태그')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '가져오기' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '편집 가져오기' })).toBeNull(),
    );
    const result = saved(storage);
    expect(result.places['n:1']?.memos['a-local']?.text).toBe('p1 메모');
    expect(result.places['n:1']?.tags?.value).toEqual(['받은태그']);
    expect(result.places['n:2']?.memos['a-remote']?.text).toBe('받은 메모');
  });

  it('원본을 다시 받은 가져오기 성공 → tripAtom이 새 원본', async () => {
    const user = userEvent.setup();
    const storage = storageWith(makeEdit());
    const fresh: TripData = { ...trip, title: '새 원본 여행', dataVersion: NEWER_DATA };
    renderPage({
      storage,
      refetchTrip: fresh,
      hash: await linkHash(incomingEdit({ baseDataVersion: NEWER_DATA })),
    });
    const dialog = await importDialog();
    expect(screen.getByRole('heading', { name: '테스트 여행', hidden: true })).toBeInTheDocument();
    await user.click(await within(dialog).findByRole('button', { name: '가져오기' }));
    expect(await screen.findByRole('heading', { name: '새 원본 여행' })).toBeInTheDocument();
    expect(saved(storage).baseDataVersion).toBe(NEWER_DATA);
  });

  it('미리보기 중 다른 탭 편집 → 안내와 새 미리보기(선택 초기화), 다시 확인하면 둘 다 보존', async () => {
    const user = userEvent.setup();
    const l0 = makeEdit({
      days: {
        [D1]: { mode: 'override', stops: [stopB, stopA], baseDayHash: baseHash, updatedAt: OLD },
      },
    });
    const storage = storageWith(l0);
    const incomingDay = {
      mode: 'override' as const,
      stops: [stopB],
      baseDayHash: baseHash,
      updatedAt: LATER,
    };
    renderPage({ storage, hash: await linkHash(incomingEdit({ days: { [D1]: incomingDay } })) });

    const dialog = await importDialog();
    const group = await within(dialog).findByRole('radiogroup', { name: 'Day 1' });
    await user.click(within(group).getByRole('radio', { name: '내 것' }));

    const l1 = JSON.stringify(withP1(l0));
    storage.setItem(KEY, l1);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });

    await user.click(within(dialog).getByRole('button', { name: '가져오기' }));
    expect(await within(dialog).findByText(CHANGED_NOTICE)).toBeInTheDocument();
    expect(storage.getItem(KEY)).toBe(l1);
    const fresh = within(dialog).getByRole('radiogroup', { name: 'Day 1' });
    expect(within(fresh).getByRole('radio', { name: '받은 것' })).toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: '가져오기' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '편집 가져오기' })).toBeNull(),
    );
    const result = saved(storage);
    expect(result.places['n:1']?.memos['a-local']?.text).toBe('p1 메모');
    expect(result.places['n:2']?.memos['a-remote']?.text).toBe('받은 메모');
    expect(result.days[D1]).toEqual(incomingDay);
  });
});

describe('첫 방문 브라우저(local = null)', () => {
  it('닉네임 취소 → 대화상자 닫힘, 저장 없음', async () => {
    const user = userEvent.setup();
    const { storage } = renderPage({ hash: await linkHash(incomingEdit()) });
    const nick = await screen.findByRole('dialog', { name: '닉네임 입력' });
    await user.click(within(nick).getByRole('button', { name: '취소' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '편집 가져오기' })).toBeNull(),
    );
    expect(storage.getItem(KEY)).toBeNull();
    expect(location.hash).toBe('');
  });

  it('손상 링크 → 오류 문구, 저장 없음', async () => {
    const user = userEvent.setup();
    const { storage } = renderPage({ hash: '#e=!!!' });
    await enterNickname(user, '새 사람');
    expect(
      await within(await importDialog()).findByText('가져오기 데이터가 손상됐어요'),
    ).toBeInTheDocument();
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('정상 링크 미리보기 후 취소 → 저장 없음', async () => {
    const user = userEvent.setup();
    const { storage } = renderPage({ hash: await linkHash(incomingEdit()) });
    await enterNickname(user, '새 사람');
    const dialog = await importDialog();
    await within(dialog).findByText('메모 추가 1 · 변경 0 · 삭제 0');
    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '편집 가져오기' })).toBeNull(),
    );
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('확인할 때만 레이어를 저장한다(닉네임·authorId 포함)', async () => {
    const user = userEvent.setup();
    const { storage } = renderPage({ hash: await linkHash(incomingEdit()) });
    await enterNickname(user, '새 사람');
    const dialog = await importDialog();
    await within(dialog).findByText('메모 추가 1 · 변경 0 · 삭제 0');
    expect(storage.getItem(KEY)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: '가져오기' }));
    await vi.waitFor(() => expect(storage.getItem(KEY)).not.toBeNull());
    const result = saved(storage);
    expect(result.authorId).toBe('a-new');
    expect(result.authors['a-new']?.nickname).toBe('새 사람');
    expect(result.places['n:2']?.memos['a-remote']?.text).toBe('받은 메모');
  });
});
