import { useTripCollabRecord } from 'src/services/trip-collab/store';
import { useCollabDeps } from '../collab/use-trip-collab';
import { joinCollabAsOwner } from '../collab/owner-join';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { alignDayIds } from 'src/domain/trip-live/live-doc';
import {
  buildLiveTripDoc,
  fitLiveDoc,
  liveEditKey,
  livePlanKey,
} from 'src/domain/trip-live/build-live-doc';
import { useTripLegs } from 'src/sections/share-export/use-trip-legs';
import { tripLiveApi } from 'src/services/trip-live/client';
import { tripLivePlanStore } from 'src/services/trip-live/plan-store';
import { rotateLiveOwner } from 'src/services/trip-live/rotate-owner';
import {
  tripLiveStore,
  useTripLiveRecord,
  type TripLiveRecord,
} from 'src/services/trip-live/store';
import { newDayId } from 'src/services/trip-live/tokens';
import { libraryAtom } from 'src/stores/library-state';
import { LIVE_CONFLICT, LIVE_OVERWRITE, LIVE_PAUSE, LIVE_DISCONNECTED, LIVE_ENDED } from './texts';
export const LIVE_DEBOUNCE_MS = 3000,
  LIVE_LEGS_WAIT_MS = 15000,
  LIVE_MIN_GAP_MS = 10000;
export const LIVE_RETRY_MS = [30000, 60000, 120000],
  LIVE_OFF_RETRY_MS = 300000,
  LIVE_LIMIT_RETRY_MS = 3600000;
export type LivePublishState =
  | 'collab'
  | 'idle'
  | 'pending'
  | 'publishing'
  | 'published'
  | 'conflict'
  | 'paused'
  | 'disconnected'
  | 'ended'
  | 'off'
  | 'limited'
  | 'too-big'
  | 'empty'
  | 'failed';
const locks = new Map<string, Promise<void>>();
const waits = new Map<
  string,
  { key: string; until: number; state: 'off' | 'limited' | 'failed' }
>();
const watchers = new Map<string, number>();
// 계획 화면과 창이 늘어난 Day에 같은 id를 쓰도록, 성공 전에도 생성 결과를 함께 쓴다.
const plannedDays = new Map<string, { base: string; count: number; ids: string[] }>();
function publicationDayIds(record: TripLiveRecord, count: number): string[] {
  if (record.dayIds.length === count) return [...record.dayIds];
  const base = record.dayIds.join('.'),
    cached = plannedDays.get(record.liveId);
  if (cached?.base === base && cached.count === count) return cached.ids;
  const ids = alignDayIds(record.dayIds, count, newDayId);
  plannedDays.set(record.liveId, { base, count, ids });
  if (plannedDays.size > 100) plannedDays.delete(plannedDays.keys().next().value!);
  return ids;
}
export function useTripLivePublish(
  tripId: string,
  active: boolean,
): {
  state: LivePublishState;
  publishedAt: string | null;
  overwrite(): Promise<void>;
  pause(): void;
  resume(): void;
} {
  const library = useAtomValue(libraryAtom),
    record = useTripLiveRecord(tripId);
  const collab = useTripCollabRecord(tripId)?.status === 'live';
  const collabDeps = useCollabDeps(tripId, false);
  const versionJoined = useRef(false);
  const enabled = active && record?.status === 'live' && !record.paused && !collab;
  const legs = useTripLegs(tripId, enabled);
  const [state, setState] = useState<LivePublishState>('idle');
  const latest = useRef({ library, legs, enabled });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const overwriteChosen = useRef(false);

  const serverRev = useRef<number | null>(null),
    retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    failures = useRef(0);
  const pending = useRef<{ key: string; changed: number; due: number; dayIds: string[] } | null>(
    null,
  );
  useEffect(() => {
    latest.current = { library, legs, enabled };
  }, [library, legs, enabled]);
  const liveId = record?.liveId;
  useEffect(() => {
    if (!enabled || !liveId) return;
    watchers.set(liveId, (watchers.get(liveId) ?? 0) + 1);
    return () => {
      const remaining = (watchers.get(liveId) ?? 1) - 1;
      if (remaining > 0) watchers.set(liveId, remaining);
      else {
        watchers.delete(liveId);
        waits.delete(liveId);
      }
    };
  }, [enabled, liveId]);
  const pause = useCallback(() => {
    overwriteChosen.current = false;
    tripLiveStore.update(tripId, { paused: true });
    setState('paused');
  }, [tripId]);
  const resume = useCallback(() => {
    serverRev.current = null;
    overwriteChosen.current = false;
    waits.delete(tripLiveStore.get(tripId)?.liveId ?? '');
    failures.current = 0;
    tripLiveStore.update(tripId, { paused: undefined });
    setState('pending');
  }, [tripId]);
  const publish = useCallback(
    async function send(force = false): Promise<void> {
      const existing = locks.get(tripId);
      if (existing) {
        await existing;
        const record = tripLiveStore.get(tripId),
          waiting = record ? waits.get(record.liveId) : undefined;
        if (alive.current && latest.current.enabled && waiting) {
          setState(waiting.state);
          if (Number.isFinite(waiting.until)) {
            clearTimeout(retry.current);
            retry.current = setTimeout(
              () => void send(force),
              Math.max(0, waiting.until - Date.now()),
            );
          }
        }
        return;
      }
      const work = (async () => {
        const current = tripLiveStore.get(tripId),
          live = latest.current,
          trip = live.library.trips[tripId];
        if (
          !alive.current ||
          !live.enabled ||
          versionJoined.current ||
          !current ||
          current.status !== 'live' ||
          current.paused ||
          !trip ||
          trip.deletedAt !== null ||
          (serverRev.current !== null && !force)
        )
          return;
        const dayIds = publicationDayIds(current, trip.days.length);
        const built = buildLiveTripDoc(live.library, tripId, live.legs.routeOf, {
          title: current.options.title,
          options: current.options,
          dayIds,
          createdAt: current.createdAt,
        });
        if (!built) {
          setState('empty');
          return;
        }
        const doc = fitLiveDoc(built);
        if (!doc) {
          setState('too-big');
          return;
        }
        const [key, planKey] = await Promise.all([liveEditKey(doc), livePlanKey(doc)]);
        // 잠금 안에서 저장소를 다시 읽어 계획 화면과 공유 창이 같은 문서를 두 번 보내지 않게 한다.
        const fresh = tripLiveStore.get(tripId);
        if (
          !alive.current ||
          !fresh ||
          fresh.status !== 'live' ||
          fresh.paused ||
          !latest.current.enabled
        )
          return;
        if (!force && fresh.publishedKey === key) {
          setState('published');
          return;
        }
        const waiting = waits.get(fresh.liveId);
        if (!force && waiting?.key === key && waiting.until > Date.now()) {
          setState(waiting.state);
          if (Number.isFinite(waiting.until)) {
            clearTimeout(retry.current);
            retry.current = setTimeout(() => void send(), waiting.until - Date.now());
          }
          return;
        }
        const change = pending.current;
        const due = Math.max(
          fresh.publishedAt ? Date.parse(fresh.publishedAt) + LIVE_MIN_GAP_MS : 0,
          change?.key === key ? change.due : 0,
          live.legs.answered < live.legs.total && change ? change.changed + LIVE_LEGS_WAIT_MS : 0,
        );
        if (!force && due > Date.now()) {
          clearTimeout(retry.current);
          retry.current = setTimeout(() => void send(force), due - Date.now());
          return;
        }
        setState('publishing');
        let result = await tripLiveApi.update(
          fresh.liveId,
          doc,
          force && serverRev.current !== null ? serverRev.current : fresh.rev,
          fresh.ownerToken,
        );
        if (result.ok) {
          serverRev.current = null;
          overwriteChosen.current = false;
          waits.delete(tripLiveStore.get(tripId)?.liveId ?? '');
          failures.current = 0;
          tripLiveStore.update(tripId, {
            rev: result.value.rev,
            publishedKey: key,
            publishedAt: new Date().toISOString(),
            expiresAt: result.value.expiresAt,
            dayIds,
          });
          tripLivePlanStore.put(tripId, fresh.liveId, planKey);
          setState('published');
          return;
        }
        if (result.error === 'version') {
          const shared = await tripLiveApi.get(fresh.liveId, null, fresh.ownerToken);
          if (shared.ok && shared.value !== 'unchanged' && shared.value.doc.v === 2) {
            try {
              await joinCollabAsOwner(collabDeps, shared.value);
              versionJoined.current = true;
              setState('collab');
              return;
            } catch {
              result = { ok: false, error: 'unavailable' };
            }
          } else result = shared.ok ? { ok: false, error: 'unavailable' } : shared;
        }
        if (result.error === 'unauthorized') {
          const current = tripLiveStore.get(tripId);
          if (!current || current.liveId !== fresh.liveId) return;
          if (current.ownerToken !== fresh.ownerToken) {
            setState('pending');
            clearTimeout(retry.current);
            retry.current = setTimeout(() => void send(force), 0);
            return;
          }
          if (current?.nextOwnerToken) {
            const recovered = await rotateLiveOwner(current, current.nextOwnerToken);
            if (recovered.ok) {
              setState('pending');
              clearTimeout(retry.current);
              retry.current = setTimeout(() => void send(force), 0);
              return;
            }
            result = recovered;
          }
        }
        if (result.error === 'conflict') {
          overwriteChosen.current = false;
          clearTimeout(retry.current);
          serverRev.current = result.rev ?? fresh.rev;
          setState('conflict');
          toast(LIVE_CONFLICT, {
            id: `trip-live-conflict-${tripId}`,
            duration: Infinity,
            action: {
              label: LIVE_OVERWRITE,
              onClick: () => {
                overwriteChosen.current = true;
                void send(true);
              },
            },
            cancel: { label: LIVE_PAUSE, onClick: pause },
          });
          return;
        }
        if (result.error === 'unauthorized') {
          tripLiveStore.update(tripId, { status: 'disconnected' });
          setState('disconnected');
          toast.error(LIVE_DISCONNECTED);
          return;
        }
        if (result.error === 'ended' || result.error === 'not-found') {
          tripLiveStore.update(tripId, { status: 'ended' });
          setState('ended');
          toast(LIVE_ENDED);
          return;
        }
        if (result.error === 'too-big') {
          setState('too-big');
          return;
        }
        const off = result.error === 'switched-off',
          limited = result.error === 'rate-limited';
        setState(off ? 'off' : limited ? 'limited' : 'failed');
        const delay = off
          ? LIVE_OFF_RETRY_MS
          : limited
            ? LIVE_LIMIT_RETRY_MS
            : LIVE_RETRY_MS[failures.current++];
        if (watchers.has(fresh.liveId))
          waits.set(fresh.liveId, {
            key,
            until: delay === undefined ? Infinity : Date.now() + delay,
            state: off ? 'off' : limited ? 'limited' : 'failed',
          });
        if (delay !== undefined && alive.current && latest.current.enabled) {
          clearTimeout(retry.current);
          retry.current = setTimeout(() => void send(force), delay);
        }
      })();
      locks.set(tripId, work);
      try {
        await work;
      } finally {
        if (locks.get(tripId) === work) locks.delete(tripId);
      }
    },
    [tripId, pause, collabDeps],
  );
  const overwrite = useCallback(() => {
    overwriteChosen.current = true;
    return publish(true);
  }, [publish]);
  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    if (!enabled || !record || versionJoined.current) return;
    const trip = library.trips[tripId];
    if (!trip || trip.deletedAt !== null) return;
    const dayIds = publicationDayIds(record, trip.days.length);
    const built = buildLiveTripDoc(library, tripId, legs.routeOf, {
      title: record.options.title,
      options: record.options,
      dayIds,
      createdAt: record.createdAt,
    });
    void (async () => {
      if (disposed) return;
      if (!built) {
        setState('empty');
        return;
      }
      if (!fitLiveDoc(built)) {
        setState('too-big');
        return;
      }
      const key = await liveEditKey(built);
      if (disposed) return;
      if (key === tripLiveStore.get(tripId)?.publishedKey) {
        setState('published');
        return;
      }
      if (serverRev.current !== null) return;
      const now = Date.now();
      const waiting = waits.get(record.liveId);
      if (waiting?.key === key && waiting.until > now) {
        setState(waiting.state);
        if (Number.isFinite(waiting.until))
          timer = setTimeout(() => void publish(), waiting.until - now);
        return;
      }
      if (waiting?.key !== key) waits.delete(tripLiveStore.get(tripId)?.liveId ?? '');
      if (pending.current?.key !== key) {
        pending.current = { key, changed: now, due: now + LIVE_DEBOUNCE_MS, dayIds };
        failures.current = 0;
        clearTimeout(retry.current);
      }
      const change = pending.current!;
      setState('pending');
      const last = record.publishedAt ? Date.parse(record.publishedAt) : 0;
      const due = Math.max(
        change.due,
        legs.answered < legs.total ? change.changed + LIVE_LEGS_WAIT_MS : 0,
        last + LIVE_MIN_GAP_MS,
      );
      timer = setTimeout(() => void publish(), Math.max(0, due - now));
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled, library, record, tripId, legs, publish]);
  useEffect(() => {
    const online = () => {
      failures.current = 0;
      waits.delete(tripLiveStore.get(tripId)?.liveId ?? '');
      clearTimeout(retry.current);
      void publish(overwriteChosen.current);
    };
    if (enabled) window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      clearTimeout(retry.current);
    };
  }, [enabled, publish, tripId]);
  const shown: LivePublishState =
    collab || versionJoined.current
      ? 'collab'
      : record?.paused
        ? 'paused'
        : record?.status === 'disconnected'
          ? 'disconnected'
          : record?.status === 'ended'
            ? 'ended'
            : state;
  return { state: shown, publishedAt: record?.publishedAt ?? null, overwrite, pause, resume };
}
