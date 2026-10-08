import {
  atom,
  useSetAtom,
  type Atom,
  type PrimitiveAtom,
  type Setter,
  type Store,
  type WritableAtom,
} from 'jotai';
import { createContext, useContext, useMemo } from 'react';
import { toast } from 'sonner';
import { overlay, type EffectiveTrip } from 'src/domain/overlay';
import { applyCategoryEdits } from 'src/domain/place-category';
import { keepMine, reconcile, type ReconcileReport } from 'src/domain/reconcile';
import { applyRevert } from 'src/domain/revert';
import {
  createMemoryStorage,
  isStorageAvailable,
  readEditLayer,
  storageKey,
  updateEditLayer,
  withEditLock,
  writeEditLayer,
} from 'src/repositories/edit-layer-repo';
import { loadTrip, type TripLoadResult } from 'src/repositories/trip-repo';
import { newEditLayer, type EditLayer } from 'src/schema/legacy/edit-layer';
import type { TripData } from 'src/schema/legacy/trip-data';

export type TripStoreDeps = {
  /** 기본값 `window.localStorage`. 쓸 수 없으면 메모리 저장소로 대체한다. */
  storage?: Storage;
  /** 기본값 `navigator.locks`(없으면 잠금 없이 실행). */
  locks?: LockManager;
  now?: () => number;
  nowIso?: () => string;
  fetchFn?: typeof fetch;
  randomId?: () => string;
};

export type LoadState =
  | { status: 'idle' | 'loading' | 'ready' }
  | {
      status: 'error';
      kind: 'not-found' | 'invalid';
      message: string;
      schemaVersion?: unknown;
    };

export type NicknameRequest = {
  initial?: string;
  resolve: (nickname: string | null) => void;
};

export type ImportContext = { local: EditLayer; localSnapshot: string | null };

type Action<Args extends unknown[], Result> = WritableAtom<null, Args, Result>;

export type TripStore = {
  publicId: string;
  tripAtom: PrimitiveAtom<TripData | null>;
  /** 저장을 일으키지 않는 메모리 atom. 저장은 `updateAtom`(→ `updateEditLayer`)으로만 한다. */
  editLayerAtom: PrimitiveAtom<EditLayer | null>;
  effectiveTripAtom: Atom<EffectiveTrip | null>;
  /** 편집 레이어의 분류를 적용한 장소들. 분류를 보여 주는 곳은 원본 `trip.places` 대신 이 값을 쓴다. */
  effectivePlacesAtom: Atom<TripData['places'] | null>;
  reconcileReportAtom: Atom<ReconcileReport | null>;
  storageUnavailableAtom: Atom<boolean>;
  loadStateAtom: Atom<LoadState>;
  nicknameRequestAtom: Atom<NicknameRequest | null>;
  /** 지도를 쓸 수 없는 사유. 값이 있으면 목록 전용 모드(§6). 여행(store)마다 따로다. */
  mapUnavailableAtom: PrimitiveAtom<string | null>;
  loadAtom: Action<[], Promise<TripLoadResult | null>>;
  refreshEditLayerAtom: Action<[], void>;
  ensureAuthorAtom: Action<[], Promise<boolean>>;
  prepareImportContextAtom: Action<[], Promise<ImportContext | null>>;
  updateAtom: Action<[fn: (edit: EditLayer) => EditLayer], Promise<void>>;
  keepMineAtom: Action<[dates: string[]], Promise<void>>;
  revertGroupAtom: Action<[dates: string[]], Promise<void>>;
  renameNicknameAtom: Action<[nickname: string], Promise<void>>;
  /** 잠금 경로 밖에서 쓰면 안 되므로 가져오기(T19) 등 저장소 경로가 필요한 곳에만 쓴다. */
  repoDeps: { storage: Storage; locks?: LockManager; now: () => number };
  nowIso: () => string;
  fetchFn?: typeof fetch;
};

const EMPTY_REPORT: ReconcileReport = {
  removedStops: [],
  orphanPlaceKeys: [],
  hiddenEditDates: [],
  autoResetDates: [],
  unresolvedGroups: [],
};

export const STORAGE_UNAVAILABLE_MESSAGE =
  '이 브라우저에서는 저장되지 않아요. 내보내기를 이용하세요';

function defaultStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** 라우트 `Provider`에 쓰는 여행별 atom 묶음을 만든다. */
export function createTripStore(publicId: string, deps: TripStoreDeps = {}): TripStore {
  const requested = deps.storage ?? defaultStorage();
  const storageUnavailable = !isStorageAvailable(requested);
  const storage = storageUnavailable || !requested ? createMemoryStorage() : requested;
  const locks = 'locks' in deps ? deps.locks : globalThis.navigator?.locks;
  const now = deps.now ?? (() => Date.now());
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const repoDeps = { storage, locks, now };
  const key = storageKey(publicId);

  let initialEdit: EditLayer | null = null;
  let initialCorrupt = false;
  try {
    const read = readEditLayer(storage, publicId, now());
    initialEdit = read.edit;
    initialCorrupt = read.corruptBackedUp;
  } catch (e) {
    console.warn('편집 데이터를 읽지 못했어요', e);
  }

  const tripAtom = atom<TripData | null>(null);
  const editLayerAtom = atom<EditLayer | null>(initialEdit);
  /**
   * 저장소가 지금 가진 레이어를 읽는다(읽기 실패 시 undefined). 무효 값이면 `readEditLayer`가
   * 백업·삭제하므로 한 번 더 읽어, 그사이 다른 탭이 쓴 값까지 포함한 현재 상태를 돌려준다.
   */
  const readCurrent = (context: string): EditLayer | null | undefined => {
    try {
      const read = readEditLayer(storage, publicId, now());
      if (!read.corruptBackedUp) return read.edit;
      console.warn(`${context}: 유효하지 않은 편집 데이터를 백업했어요`);
      return readEditLayer(storage, publicId, now()).edit;
    } catch (e) {
      console.warn(`${context}: 편집 데이터를 읽지 못했어요`, e);
      return undefined;
    }
  };

  editLayerAtom.onMount = (setEdit) => {
    const sync = (context: string) => {
      const edit = readCurrent(context);
      if (edit !== undefined) setEdit(edit);
    };
    // 로드와 구독 사이에 다른 탭이 쓴 값을 놓치지 않도록 마운트 시 한 번 읽는다(읽기 전용).
    sync('구독 시작');
    const onStorage = (event: StorageEvent) => {
      // key === null은 다른 탭의 localStorage.clear()다.
      if (event.key !== key && event.key !== null) return;
      sync('다른 탭 변경');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  };

  const loadStateAtom = atom<LoadState>({ status: 'idle' });
  /** 로드 시점 정리 결과. 저장본에서 이미 빠진 항목(제거 방문 등)은 이 값으로만 알 수 있다. */
  const loadReportAtom = atom<ReconcileReport | null>(null);
  const nicknameRequestAtom = atom<NicknameRequest | null>(null);
  const mapUnavailableAtom = atom<string | null>(null);
  const storageUnavailableAtom = atom(() => storageUnavailable);

  const effectiveTripAtom = atom((get) => {
    const trip = get(tripAtom);
    return trip ? overlay(trip, get(editLayerAtom)) : null;
  });

  const effectivePlacesAtom = atom((get) => {
    const trip = get(tripAtom);
    return trip ? applyCategoryEdits(trip, get(editLayerAtom)) : null;
  });

  const reconcileReportAtom = atom((get): ReconcileReport | null => {
    const trip = get(tripAtom);
    if (!trip) return null;
    const edit = get(editLayerAtom);
    const live = edit ? reconcile(trip, edit).report : EMPTY_REPORT;
    const atLoad = get(loadReportAtom);
    return {
      ...live,
      removedStops: [...(atLoad?.removedStops ?? []), ...live.removedStops],
      autoResetDates: [...(atLoad?.autoResetDates ?? []), ...live.autoResetDates],
    };
  });

  const refreshEditLayerAtom = atom(null, (_get, set) => {
    const edit = readCurrent('다시 읽기');
    if (edit !== undefined) set(editLayerAtom, edit);
  });

  let pendingNickname: Promise<string | null> | null = null;
  const requestNickname = (set: Setter, initial?: string): Promise<string | null> => {
    pendingNickname ??= new Promise<string | null>((resolve) => {
      set(nicknameRequestAtom, {
        initial,
        resolve: (nickname) => {
          pendingNickname = null;
          set(nicknameRequestAtom, null);
          resolve(nickname);
        },
      });
    });
    return pendingNickname;
  };

  const newDraft = (trip: TripData, nickname: string): EditLayer =>
    newEditLayer({
      publicId,
      baseDataVersion: trip.dataVersion,
      authorId: randomId(),
      nickname,
      now: nowIso(),
    });

  const loadAtom = atom(null, async (get, set): Promise<TripLoadResult | null> => {
    if (get(loadStateAtom).status !== 'idle') return null;
    set(loadStateAtom, { status: 'loading' });
    const result = await loadTrip(publicId, { fetchFn: deps.fetchFn });
    if (!result.ok) {
      const { kind, message, schemaVersion } = result;
      set(loadStateAtom, { status: 'error', kind, message, schemaVersion });
      return result;
    }
    const trip = result.trip;
    if (initialCorrupt) toast.warning('저장된 편집 데이터가 손상되어 백업해 두었어요');

    let edit: EditLayer | null = null;
    let report: ReconcileReport | null = null;
    try {
      await withEditLock(publicId, { locks }, () => {
        const stored = readEditLayer(storage, publicId, now());
        if (stored.corruptBackedUp) {
          toast.warning('저장된 편집 데이터가 손상되어 백업해 두었어요');
        }
        if (!stored.edit) return;
        const reconciled = reconcile(trip, stored.edit);
        edit = reconciled.edit;
        report = reconciled.report;
        if (JSON.stringify(reconciled.edit) !== JSON.stringify(stored.edit)) {
          try {
            writeEditLayer(storage, reconciled.edit);
          } catch (e) {
            console.warn('정리한 편집을 저장하지 못했어요', e);
            toast.error('정리한 편집을 저장하지 못했어요');
          }
        }
      });
    } catch (e) {
      console.warn('편집 데이터를 읽지 못했어요', e);
      toast.error('편집 데이터를 읽지 못했어요');
      edit = null;
      report = null;
    }

    set(tripAtom, trip);
    set(editLayerAtom, edit);
    set(loadReportAtom, report);
    set(loadStateAtom, { status: 'ready' });
    return result;
  });

  const ensureAuthorAtom = atom(null, async (get, set): Promise<boolean> => {
    if (get(editLayerAtom)) return true;
    const trip = get(tripAtom);
    if (!trip) return false;
    const nickname = await requestNickname(set);
    if (nickname === null) return false;
    const draft = newDraft(trip, nickname);
    // 닉네임 입력 중 다른 탭이 레이어를 만들었다면 그것을 보존한다.
    await updateEditLayer(publicId, (current) => current ?? draft, repoDeps);
    set(refreshEditLayerAtom);
    return true;
  });

  const prepareImportContextAtom = atom(null, async (get, set): Promise<ImportContext | null> => {
    const { edit, raw } = readEditLayer(storage, publicId, now());
    if (edit) return { local: edit, localSnapshot: raw };
    const trip = get(tripAtom);
    if (!trip) return null;
    const nickname = await requestNickname(set);
    if (nickname === null) return null;
    return { local: newDraft(trip, nickname), localSnapshot: null };
  });

  let storageToastShown = false;
  const updateAtom = atom(
    null,
    async (_get, set, fn: (edit: EditLayer) => EditLayer): Promise<void> => {
      if (!(await set(ensureAuthorAtom))) return;
      if (storageUnavailable && !storageToastShown) {
        storageToastShown = true;
        toast(STORAGE_UNAVAILABLE_MESSAGE);
      }
      try {
        await updateEditLayer(
          publicId,
          (current) => {
            if (!current) throw new Error('edit layer missing');
            return fn(current);
          },
          repoDeps,
        );
      } finally {
        // 반환값이 아니라 저장소를 다시 읽는다 — 잠금 해제 직후 다른 탭이 쓴 값까지 보이게.
        // 실패해도 다시 읽어 atom이 저장소와 어긋난 채 남지 않게 한다(오류는 호출자에게 전달).
        set(refreshEditLayerAtom);
      }
    },
  );

  const keepMineAtom = atom(null, async (get, set, dates: string[]) => {
    const trip = get(tripAtom);
    if (!trip) return;
    await set(updateAtom, (edit) => {
      const kept = keepMine(trip, edit, dates, nowIso());
      if (!kept) throw new Error('내 편집을 유지할 수 없어요');
      return kept;
    });
  });

  const revertGroupAtom = atom(null, async (_get, set, dates: string[]) => {
    await set(updateAtom, (edit) => applyRevert(edit, dates, nowIso()));
  });

  const renameNicknameAtom = atom(null, async (_get, set, nickname: string) => {
    await set(updateAtom, (edit) => ({
      ...edit,
      authors: { ...edit.authors, [edit.authorId]: { nickname, updatedAt: nowIso() } },
    }));
  });

  return {
    publicId,
    tripAtom,
    editLayerAtom,
    effectiveTripAtom,
    effectivePlacesAtom,
    reconcileReportAtom,
    storageUnavailableAtom,
    loadStateAtom,
    nicknameRequestAtom,
    mapUnavailableAtom,
    loadAtom,
    refreshEditLayerAtom,
    ensureAuthorAtom,
    prepareImportContextAtom,
    updateAtom,
    keepMineAtom,
    revertGroupAtom,
    renameNicknameAtom,
    repoDeps,
    nowIso,
    fetchFn: deps.fetchFn,
  };
}

/** 앱 의존성 주입(테스트용). `jotaiStore`를 주면 라우트 Provider가 그 store를 쓴다. */
export type TripPageDeps = TripStoreDeps & { jotaiStore?: Store };
export const TripDepsContext = createContext<TripPageDeps>({});

export const TripStoreContext = createContext<TripStore | null>(null);

export function useTripStore(): TripStore {
  const ts = useContext(TripStoreContext);
  if (!ts) throw new Error('TripStoreContext가 없습니다');
  return ts;
}

export type EditActions = {
  ensureAuthor(): Promise<boolean>;
  prepareImportContext(): Promise<ImportContext | null>;
  update(fn: (e: EditLayer) => EditLayer): Promise<void>;
};

export function useEditActions(): EditActions {
  const ts = useTripStore();
  const ensureAuthor = useSetAtom(ts.ensureAuthorAtom);
  const prepareImportContext = useSetAtom(ts.prepareImportContextAtom);
  const update = useSetAtom(ts.updateAtom);
  return useMemo(
    () => ({ ensureAuthor, prepareImportContext, update }),
    [ensureAuthor, prepareImportContext, update],
  );
}
