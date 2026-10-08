import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeEditLayer, encodeEditLayer } from 'src/domain/codec';
import { hashDayStops } from 'src/domain/day-hash';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import type { EditLayer } from 'src/schema/legacy/edit-layer';
import type { TripData } from 'src/schema/legacy/trip-data';
import { createTripStore, type TripStore } from 'src/stores/trip-store';
import { makeEdit, makeTrip } from '../../fixtures/builders';

const toastMock = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & Record<string, ReturnType<typeof vi.fn>>;
  fn.error = vi.fn();
  fn.warning = vi.fn();
  fn.success = vi.fn();
  return fn;
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));

const PID = 'testtrip0001';
const KEY = storageKey(PID);
const NOW_MS = 1759460000000;
const NOW_ISO = '2026-10-03T02:00:00.000Z';
const T1 = '2026-10-03T00:10:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';

const trip = makeTrip({ days: { [D1]: ['A', 'B'], [D2]: ['C'] } });

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const withMemo = (edit: EditLayer, placeKey: string, text: string): EditLayer => ({
  ...edit,
  places: {
    ...edit.places,
    [placeKey]: { memos: { [edit.authorId]: { text, updatedAt: T1 } } },
  },
});

function setup(
  opts: { storage?: Storage; locks?: LockManager; trip?: TripData; nickname?: string | null } = {},
) {
  const storage = opts.storage ?? createMemoryStorage();
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => jsonResponse(opts.trip ?? trip));
  const ts = createTripStore(PID, {
    storage,
    locks: opts.locks,
    now: () => NOW_MS,
    nowIso: () => NOW_ISO,
    fetchFn,
    randomId: () => 'a-new',
  });
  const store = createStore();
  return { storage, ts, store };
}

/** 닉네임 요청이 오면 바로 답한다(null이면 취소). */
function answerNickname(
  store: ReturnType<typeof createStore>,
  ts: TripStore,
  value: string | null,
) {
  const asked: number[] = [];
  store.sub(ts.nicknameRequestAtom, () => {
    const req = store.get(ts.nicknameRequestAtom);
    if (req) {
      asked.push(1);
      req.resolve(value);
    }
  });
  return asked;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createTripStore 초기값과 다른 탭 동기화', () => {
  it('스키마 위반 JSON은 백업 키로 옮기고 atom은 null', () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, '{"schemaVersion":1}');
    const { ts, store } = setup({ storage });
    expect(store.get(ts.editLayerAtom)).toBeNull();
    expect(storage.getItem(`${KEY}:corrupt:${NOW_MS}`)).toBe('{"schemaVersion":1}');
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('같은 키의 storage 이벤트만 반영하고, 무효 값이면 백업 뒤 저장소의 현재 값(null)으로 맞춘다', () => {
    const storage = createMemoryStorage();
    const first = makeEdit();
    storage.setItem(KEY, JSON.stringify(first));
    const { ts, store } = setup({ storage });
    const unsub = store.sub(ts.editLayerAtom, () => {});
    expect(store.get(ts.editLayerAtom)).toEqual(first);

    const second = withMemo(first, 'n:1', '다른 탭');
    storage.setItem(KEY, JSON.stringify(second));
    window.dispatchEvent(new StorageEvent('storage', { key: 'tripmap:edit:other00000' }));
    expect(store.get(ts.editLayerAtom)).toEqual(first);
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(store.get(ts.editLayerAtom)).toEqual(second);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.setItem(KEY, '{"schemaVersion":1}');
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(storage.getItem(`${KEY}:corrupt:${NOW_MS}`)).toBe('{"schemaVersion":1}');
    expect(storage.getItem(KEY)).toBeNull();
    expect(store.get(ts.editLayerAtom)).toBeNull();
    expect(warn).toHaveBeenCalled();
    unsub();
  });

  it('무효 storage 이벤트 뒤 update는 새 레이어를 만들고 atom은 저장소와 같다', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    const { ts, store } = setup({ storage });
    await store.set(ts.loadAtom);
    store.sub(ts.editLayerAtom, () => {});
    answerNickname(store, ts, '나');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.setItem(KEY, '{"schemaVersion":1}');
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    await store.set(ts.updateAtom, (e) => withMemo(e, 'n:1', '다시'));
    expect(store.get(ts.editLayerAtom)).toEqual(JSON.parse(storage.getItem(KEY)!));
    expect(store.get(ts.editLayerAtom)?.places['n:1']?.memos['a-new']?.text).toBe('다시');
  });

  it('update가 실패해도 atom을 저장소와 다시 맞추고, 다음 update는 성공한다', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    const { ts, store } = setup({ storage });
    await store.set(ts.loadAtom);
    answerNickname(store, ts, '나');
    storage.removeItem(KEY); // 이벤트 없이 사라짐 → atom은 낡은 값
    expect(store.get(ts.editLayerAtom)).not.toBeNull();

    await expect(store.set(ts.updateAtom, (e) => withMemo(e, 'n:1', 'x'))).rejects.toThrow(
      'edit layer missing',
    );
    expect(store.get(ts.editLayerAtom)).toBeNull();

    await store.set(ts.updateAtom, (e) => withMemo(e, 'n:1', '둘째'));
    const saved = JSON.parse(storage.getItem(KEY)!) as EditLayer;
    expect(saved.places['n:1']?.memos['a-new']?.text).toBe('둘째');
    expect(store.get(ts.editLayerAtom)).toEqual(saved);
  });

  it('key가 null인 storage 이벤트(다른 탭의 clear)도 다시 읽는다', () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    const { ts, store } = setup({ storage });
    store.sub(ts.editLayerAtom, () => {});
    expect(store.get(ts.editLayerAtom)).not.toBeNull();
    storage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(store.get(ts.editLayerAtom)).toBeNull();
  });

  it('구독 시작 시 저장소를 한 번 읽어 그사이 쓰인 값을 반영한다', () => {
    const storage = createMemoryStorage();
    const { ts, store } = setup({ storage });
    expect(store.get(ts.editLayerAtom)).toBeNull();
    const written = makeEdit();
    storage.setItem(KEY, JSON.stringify(written));
    store.sub(ts.editLayerAtom, () => {});
    expect(store.get(ts.editLayerAtom)).toEqual(written);
  });
});

describe('로드(R14)', () => {
  it('reconcile 결과가 저장본과 다르면 잠금 경로로 저장하고 report를 남긴다', async () => {
    const storage = createMemoryStorage();
    const stale = makeEdit({
      baseDataVersion: '2026-10-01T00:00:00.000Z',
      days: {
        [D1]: {
          mode: 'override',
          stops: [...trip.days[0]!.stops, { id: 'zz00', placeKey: 'n:99' }],
          baseDayHash: hashDayStops(trip.days[0]!.stops),
          updatedAt: T1,
        },
      },
    });
    storage.setItem(KEY, JSON.stringify(stale));
    const { ts, store } = setup({ storage });
    const result = await store.set(ts.loadAtom);
    expect(result?.ok).toBe(true);
    const saved = JSON.parse(storage.getItem(KEY)!) as EditLayer;
    expect(saved.baseDataVersion).toBe(trip.dataVersion);
    expect(saved.days[D1]).toEqual({ mode: 'reset', updatedAt: T1 });
    expect(store.get(ts.editLayerAtom)).toEqual(saved);
    expect(store.get(ts.tripAtom)).toEqual(trip);
    expect(store.get(ts.reconcileReportAtom)?.removedStops).toEqual([
      { date: D1, stopId: 'zz00', placeKey: 'n:99' },
    ]);
    expect(store.get(ts.effectiveTripAtom)?.days.map((d) => d.source)).toEqual(['base', 'base']);
  });

  it('변경이 없으면 저장하지 않는다', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    const { ts, store } = setup({ storage });
    const spy = vi.spyOn(storage, 'setItem');
    await store.set(ts.loadAtom);
    expect(spy).not.toHaveBeenCalled();
  });

  it('편집 읽기가 throw하면 토스트하고 null로 계속한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createMemoryStorage();
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    const { ts, store } = setup({ storage });
    const result = await store.set(ts.loadAtom);
    expect(result?.ok).toBe(true);
    expect(store.get(ts.editLayerAtom)).toBeNull();
    expect(store.get(ts.tripAtom)).toEqual(trip);
    expect(toastMock.error).toHaveBeenCalledWith('편집 데이터를 읽지 못했어요');
  });

  it('원본과 메모만 다른 override는 로드 후에도 override로 남는다(해시 충돌 쌍)', async () => {
    const base = makeTrip({ days: { [D1]: ['X'] } });
    const noteTrip: TripData = {
      ...base,
      days: [{ ...base.days[0]!, stops: [{ id: 'x000', placeKey: 'n:1', note: '219449961' }] }],
    };
    const storage = createMemoryStorage();
    const local = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [{ id: 'x000', placeKey: 'n:1', note: '3478588219' }],
          baseDayHash: hashDayStops(noteTrip.days[0]!.stops),
          updatedAt: T1,
        },
      },
    });
    storage.setItem(KEY, JSON.stringify(local));
    const { ts, store } = setup({ storage, trip: noteTrip });
    const result = await store.set(ts.loadAtom);
    expect(result?.ok).toBe(true);
    const saved = JSON.parse(storage.getItem(KEY)!) as EditLayer;
    const day = saved.days[D1]!;
    expect(day.mode).toBe('override');
    expect(day.mode === 'override' && day.stops[0]!.note).toBe('3478588219');
    expect(store.get(ts.reconcileReportAtom)?.autoResetDates).toEqual([]);
  });
});

describe('편집 쓰기', () => {
  it('update 1회는 setItem 1회, 메모리 atom 직접 변경은 setItem 0회', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    const { ts, store } = setup({ storage });
    await store.set(ts.loadAtom);
    const spy = vi.spyOn(storage, 'setItem');

    await store.set(ts.updateAtom, (e) => withMemo(e, 'n:1', '첫 메모'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.get(ts.editLayerAtom)?.places['n:1']?.memos['a-local']?.text).toBe('첫 메모');

    spy.mockClear();
    store.set(ts.editLayerAtom, makeEdit());
    expect(spy).not.toHaveBeenCalled();
  });

  it('끼어들기: 잠금 해제 뒤 refresh 전에 다른 탭이 쓴 값이 atom에 보인다', async () => {
    let release!: () => void;
    let released!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const unlocked = new Promise<void>((r) => (released = r));
    let armed = false;
    const locks = {
      request: async (_name: string, cb: () => unknown) => {
        const value = await cb();
        if (armed) {
          released();
          await gate;
        }
        return value;
      },
    } as unknown as LockManager;

    const storage = createMemoryStorage();
    const base = makeEdit();
    storage.setItem(KEY, JSON.stringify(base));
    const { ts, store } = setup({ storage, locks });
    await store.set(ts.loadAtom);
    armed = true;

    const pending = store.set(ts.updateAtom, (e) => withMemo(e, 'n:1', 'A'));
    await unlocked;
    const fromB = withMemo(withMemo(base, 'n:1', 'A'), 'n:2', 'B');
    storage.setItem(KEY, JSON.stringify(fromB));
    release();
    await pending;

    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(fromB);
    expect(store.get(ts.editLayerAtom)).toEqual(fromB);
  });

  it('레이어가 없으면 닉네임을 받아 만들고, 입력 중 다른 탭이 만든 레이어는 보존한다', async () => {
    const storage = createMemoryStorage();
    const { ts, store } = setup({ storage });
    await store.set(ts.loadAtom);
    const other = makeEdit({ authorId: 'a-other' });
    store.sub(ts.nicknameRequestAtom, () => {
      const req = store.get(ts.nicknameRequestAtom);
      if (req) {
        storage.setItem(KEY, JSON.stringify(other));
        req.resolve('나');
      }
    });
    await expect(store.set(ts.ensureAuthorAtom)).resolves.toBe(true);
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(other);
    expect(store.get(ts.editLayerAtom)).toEqual(other);
  });

  it('닉네임으로 새 레이어를 만든다(authorId는 randomId)', async () => {
    const { ts, store, storage } = setup();
    await store.set(ts.loadAtom);
    answerNickname(store, ts, '여행자');
    await store.set(ts.updateAtom, (e) => withMemo(e, 'n:1', '메모'));
    const saved = JSON.parse(storage.getItem(KEY)!) as EditLayer;
    expect(saved.authorId).toBe('a-new');
    expect(saved.authors['a-new']).toEqual({ nickname: '여행자', updatedAt: NOW_ISO });
    expect(saved.places['n:1']?.memos['a-new']?.text).toBe('메모');
  });

  it('닉네임 취소면 false이고 저장소는 그대로', async () => {
    const { ts, store, storage } = setup();
    await store.set(ts.loadAtom);
    answerNickname(store, ts, null);
    const spy = vi.spyOn(storage, 'setItem');
    await expect(store.set(ts.ensureAuthorAtom)).resolves.toBe(false);
    await store.set(ts.updateAtom, (e) => withMemo(e, 'n:1', 'x'));
    expect(spy).not.toHaveBeenCalled();
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('닉네임 변경은 authors[authorId]를 지금 시각으로 갱신한다', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    const { ts, store } = setup({ storage });
    await store.set(ts.loadAtom);
    await store.set(ts.renameNicknameAtom, '새이름');
    const saved = JSON.parse(storage.getItem(KEY)!) as EditLayer;
    expect(saved.authors['a-local']).toEqual({ nickname: '새이름', updatedAt: NOW_ISO });
  });
});

describe('prepareImportContext', () => {
  it('레이어가 있으면 readEditLayer 한 번의 edit·raw 쌍', async () => {
    const storage = createMemoryStorage();
    const raw = JSON.stringify(makeEdit());
    storage.setItem(KEY, raw);
    const { ts, store } = setup({ storage });
    await store.set(ts.loadAtom);
    store.set(ts.editLayerAtom, null);
    const ctx = await store.set(ts.prepareImportContextAtom);
    expect(ctx).toEqual({ local: makeEdit(), localSnapshot: raw });
  });

  it('레이어가 없으면 저장하지 않은 draft, 취소면 null', async () => {
    const { ts, store, storage } = setup();
    await store.set(ts.loadAtom);
    const answer = { value: '나' as string | null };
    store.sub(ts.nicknameRequestAtom, () =>
      store.get(ts.nicknameRequestAtom)?.resolve(answer.value),
    );
    const ctx = await store.set(ts.prepareImportContextAtom);
    expect(ctx?.localSnapshot).toBeNull();
    expect(ctx?.local.authors['a-new']?.nickname).toBe('나');
    expect(storage.getItem(KEY)).toBeNull();
    answer.value = null;
    await expect(store.set(ts.prepareImportContextAtom)).resolves.toBeNull();
  });
});

describe('저장소 불가', () => {
  it('메모리 저장소로 대체해 두 메모를 유지하고 내보내기에 담긴다', async () => {
    const broken = createMemoryStorage();
    broken.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const { ts, store } = setup({ storage: broken });
    await store.set(ts.loadAtom);
    expect(store.get(ts.storageUnavailableAtom)).toBe(true);
    const asked = answerNickname(store, ts, '나');

    await store.set(ts.updateAtom, (e) => withMemo(e, 'n:1', '하나'));
    await store.set(ts.updateAtom, (e) => withMemo(e, 'n:2', '둘'));
    expect(asked).toHaveLength(1);

    const edit = store.get(ts.editLayerAtom)!;
    expect(edit.places['n:1']?.memos['a-new']?.text).toBe('하나');
    expect(edit.places['n:2']?.memos['a-new']?.text).toBe('둘');
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      '이 브라우저에서는 저장되지 않아요. 내보내기를 이용하세요',
    );

    const decoded = (await decodeEditLayer(await encodeEditLayer(edit))) as EditLayer;
    expect(Object.keys(decoded.places).sort()).toEqual(['n:1', 'n:2']);
    expect(window.localStorage.length).toBe(0);
  });

  it('저장소가 되면 storageUnavailableAtom은 false', () => {
    const { ts, store } = setup();
    expect(store.get(ts.storageUnavailableAtom)).toBe(false);
  });
});
