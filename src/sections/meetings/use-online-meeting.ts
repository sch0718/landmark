import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { finalFromMeeting, inviteFromMeeting } from 'src/domain/meeting/link';
import { docFromMeeting, type MeetingDoc, type OnlineState } from 'src/domain/meeting/online-doc';
import {
  hostEdits,
  mergeOnline,
  overriddenReplyOrigins,
  shouldAdoptRemoteDoc,
} from 'src/domain/meeting/online-merge';
import type { Meeting, Origin } from 'src/schema/meeting';
import { meetApi, type OnlineError } from 'src/services/meet-online/client';
import {
  isLinkMeeting,
  readOnline,
  rememberReplyOnly,
  subscribeOnline,
  updateOnline,
  sameHostConnection,
  sameOnlineSync,
  type OnlineRecord,
} from 'src/services/meet-online/store';
import { getTurnstileToken } from 'src/services/meet-online/turnstile-loader';
import { shareLink, shareMeetingDoc, onlineMeetingUrl } from './share-link';
import { useMeeting } from './use-meeting';
import type { MeetingTimes } from './use-meeting-compute';
import { useOnlinePoll } from './use-online-poll';

export type OnlineCompute = { times: MeetingTimes; unit: 'min' | 'm'; pending: boolean };
export type OnlineMeetingMode = 'link' | 'local' | 'online' | 'ended';
export type OnlineMeeting = ReturnType<typeof useOnlineMeeting>;

function newHostToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function removedReplyOnly(doc: MeetingDoc, record: OnlineRecord): string[] {
  const remaining = new Set(doc.participants.map((p) => p.id));
  return (record.seen ?? []).filter((id) => !remaining.has(id));
}

function computeConditions(meeting: Meeting): string {
  return JSON.stringify({
    origins: meeting.participants.value
      .filter((p) => p.origin !== null)
      .map((p) => [p.id, p.origin]),
    candidates: meeting.candidates.value,
    mode: meeting.mode.value,
    at: meeting.at.value,
  });
}

/** 비동기 준비로 사용자 동작이 끊기면 새 동작에서 같은 링크를 보낸다. */
async function shareOnlineLink(url: string, title: string) {
  if ((await shareLink(url, title, { quietFailure: true })) === 'failed')
    toast('링크가 준비됐어요', {
      duration: Infinity,
      action: {
        label: '링크 공유하기',
        onClick: () => void shareLink(url, title),
      },
    });
}

function errorMessage(error: OnlineError, creating = false) {
  switch (error.code) {
    case 'full':
      return '참석자는 10명까지예요';
    case 'turnstile':
      return '확인에 실패했어요. 다시 해 주세요';
    case 'rate-limited':
      return creating
        ? '오늘은 더 만들 수 없어요'
        : '오늘은 더 고칠 수 없어요. 내일 다시 해 주세요';
    case 'unauthorized':
      return '이 기기의 주최자 연결이 끊겼어요. 주최자 링크로 다시 연결하세요';
    case 'ended':
    case 'not-found':
      return '끝난 약속이에요';
    default:
      return '지금은 보낼 수 없어요. 잠시 뒤 다시 해 주세요';
  }
}

/** 보관함을 본문 주인으로 두고, 서버 답장과 아직 못 보낸 수정을 이어서 맞춘다. */
export function useOnlineMeeting(meeting: Meeting, compute: OnlineCompute) {
  const { run } = useMeeting(meeting.id);
  const [record, setRecord] = useState(() => readOnline(meeting.id));
  const [uploaded, setUploaded] = useState(0);
  const [replyState, setReplyState] = useState<OnlineState | null>(null);
  const [status, setStatus] = useState<{ lastOkAt: number | null; failing: boolean }>({
    lastOkAt: null,
    failing: false,
  });
  const latest = useRef({ meeting, compute, run });
  useLayoutEffect(() => {
    latest.current = { meeting, compute, run };
  });
  const active = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const creating = useRef(false);
  const reissuing = useRef<Promise<boolean> | null>(null);
  const hydrated = useRef(false);
  const retry = useRef(false);
  const unauthorizedNotified = useRef(false);
  const deferred = useRef(false);
  const awaitingCompute = useRef(false);
  const baseline = useRef<string | null>(null);
  const hostReplyInFlight = useRef(false);
  const hostReplyDeferred = useRef(false);
  const hostReplyRetry = useRef(false);
  const mode: OnlineMeetingMode = record?.ended
    ? 'ended'
    : isLinkMeeting(meeting, record)
      ? 'link'
      : record?.hostToken
        ? 'online'
        : 'local';
  const json = JSON.stringify(docFromMeeting(meeting, compute.times, compute.unit));
  const hostId = meeting.participants.value[0]!.id;
  const hostLikesJson = JSON.stringify(meeting.replies.value[hostId]?.likes ?? []);

  const save = useCallback(
    (update: (current: OnlineRecord | null) => OnlineRecord | null) => {
      const next = updateOnline(meeting.id, update);
      if (active.current) setRecord(next);
      return next;
    },
    [meeting.id],
  );
  const currentRecord = () => readOnline(meeting.id);
  function isCurrent(signal: AbortSignal | undefined): signal is AbortSignal {
    return (
      signal !== undefined &&
      active.current &&
      signal === lifecycle.current?.signal &&
      !signal.aborted
    );
  }
  function markError(error: OnlineError, notify = false, expected: OnlineRecord | null) {
    const current = currentRecord();
    if (!sameHostConnection(current, expected)) return;
    if ((error.code === 'ended' || error.code === 'not-found') && current) {
      save((fresh) => {
        if (
          !fresh ||
          !sameHostConnection(fresh, expected) ||
          JSON.stringify(fresh.guest) !== JSON.stringify(expected?.guest)
        )
          return fresh;
        const ended = { ...fresh, ended: true as const };
        delete ended.hostToken;
        delete ended.guest;
        return ended;
      });
    }
    if (active.current) setStatus((previous) => ({ ...previous, failing: true }));
    if (error.code === 'unauthorized') {
      if (unauthorizedNotified.current) return;
      unauthorizedNotified.current = true;
      toast.error(errorMessage(error));
    } else if (notify || error.code === 'full') toast.error(errorMessage(error));
  }
  function markOk() {
    if (active.current) setStatus({ lastOkAt: Date.now(), failing: false });
  }
  function needsUpload(doc: MeetingDoc, current: OnlineRecord): boolean {
    return (
      JSON.stringify(doc) !== baseline.current ||
      removedReplyOnly(doc, current).length > 0 ||
      overriddenReplyOrigins(doc.participants, current.replyOrigins).length > 0
    );
  }
  async function sendHostLikes(): Promise<boolean> {
    const signal = lifecycle.current?.signal;
    if (!isCurrent(signal)) return false;
    const current = currentRecord();
    if (!current?.hostToken || current.ended || hostReplyInFlight.current) return true;
    const input = latest.current.meeting;
    const likes = input.replies.value[input.participants.value[0]!.id]?.likes ?? [];
    const sent = JSON.stringify(likes);
    if (sent === JSON.stringify(current.hostLikes ?? [])) {
      hostReplyRetry.current = false;
      hostReplyDeferred.current = false;
      return true;
    }
    hostReplyInFlight.current = true;
    try {
      const response = await meetApi.reply(meeting.id, { likes }, current.hostToken);
      if (!isCurrent(signal)) return false;
      if (!response.ok) {
        hostReplyRetry.current = true;
        hostReplyDeferred.current = true;
        markError(response.error, false, current);
        return false;
      }
      let applied = false;
      save((fresh) => {
        if (
          !fresh ||
          fresh.ended ||
          !sameHostConnection(fresh, current) ||
          fresh.hostLikesAckRev !== current.hostLikesAckRev ||
          JSON.stringify(fresh.hostLikes) !== JSON.stringify(current.hostLikes)
        )
          return fresh;
        applied = true;
        return {
          ...fresh,
          hostLikes: [...likes],
          hostLikesAckRev: Math.max(fresh.hostLikesAckRev ?? 0, response.value.rev),
        };
      });
      if (!applied) return false;
      hostReplyRetry.current = false;
      hostReplyDeferred.current = false;
      if (active.current) setUploaded((count) => count + 1);
      markOk();
      return true;
    } finally {
      hostReplyInFlight.current = false;
    }
  }
  async function merge(
    state: OnlineState,
    signal: AbortSignal,
    expected: OnlineRecord,
  ): Promise<Meeting | null> {
    if (
      !sameOnlineSync(currentRecord(), expected) ||
      !isCurrent(signal) ||
      state.rev < (currentRecord()?.lastRev ?? 0)
    )
      return null;
    if (state.originNames !== undefined) {
      markError({ code: 'unauthorized' }, false, expected);
      return null;
    }
    const beforeMerge = currentRecord();
    const unchanged = (current: OnlineRecord | null) =>
      JSON.stringify(current) === JSON.stringify(beforeMerge);
    let merged: Meeting | null = null;
    let adopted = false;
    let addedReplyOnly: string[] = [];
    let seenNames: Record<string, string> = {};
    let hostLikes: string[] | undefined;
    let replyOrigins: Record<string, Origin> | undefined;
    const result = await latest.current.run((lib, ctx) => {
      const current = currentRecord();
      // 보관함 연산을 기다리는 동안 화면이 닫히거나 다른 화면이 더 새 상태를 합칠 수 있다.
      if (!isCurrent(signal) || !unchanged(current) || state.rev < (current?.lastRev ?? 0))
        return lib;
      const sync = {
        syncedDoc: current?.syncedDoc ?? null,
        docRev: current?.docRev ?? null,
        seen: current?.seen ?? [],
        seenNames: current?.seenNames,
        hostLikes: current?.hostLikes ?? null,
        hostLikesAckRev: current?.hostLikesAckRev ?? null,
        replyOrigins: current?.replyOrigins,
      };
      const before = lib.meetings?.[meeting.id];
      if (before && shouldAdoptRemoteDoc(before, state, sync)) adopted = true;
      const out = mergeOnline(lib, meeting.id, state, ctx, sync);
      if (out.ok) {
        merged = out.lib.meetings![meeting.id]!;
        addedReplyOnly = out.addedReplyOnly;
        seenNames = out.seenNames;
        hostLikes = out.hostLikes;
        replyOrigins = out.replyOrigins;
      }
      return out;
    });
    if (!result.ok || !merged || !isCurrent(signal)) return null;
    let applied = false;
    save((current) => {
      if (!current || current.ended || !unchanged(current) || state.rev < (current.lastRev ?? 0))
        return current;
      const seen =
        current?.seen === undefined && addedReplyOnly.length === 0
          ? undefined
          : rememberReplyOnly(current?.seen ?? [], addedReplyOnly, [
              ...state.doc.participants.map((p) => p.id),
              ...state.replies.map((r) => r.participantId),
            ]);
      applied = true;
      return {
        ...current,
        lastRev: state.rev,
        ...(replyOrigins === undefined ? {} : { replyOrigins }),
        ...(hostLikes === undefined || hostReplyInFlight.current ? {} : { hostLikes }),
        ...(seen === undefined
          ? {}
          : {
              seen,
              seenNames: Object.fromEntries(
                seen.filter((id) => seenNames[id] !== undefined).map((id) => [id, seenNames[id]!]),
              ),
            }),
        ...(!adopted || state.docRev < (current.docRev ?? 0)
          ? {}
          : { docRev: state.docRev, syncedDoc: state.doc }),
      };
    });
    if (!applied) return null;
    hydrated.current = true;
    if (adopted) baseline.current = JSON.stringify(state.doc);
    if (active.current) setReplyState(state);
    return merged;
  }
  async function upload(signal = lifecycle.current?.signal): Promise<boolean> {
    if (!isCurrent(signal)) return false;
    let current = currentRecord();
    const input = latest.current;
    if (!current?.hostToken || current.ended || input.compute.pending) return true;
    let doc = docFromMeeting(input.meeting, input.compute.times, input.compute.unit);
    let baseDocRev = current.docRev;
    if (!needsUpload(doc, current)) {
      retry.current = false;
      deferred.current = false;
      awaitingCompute.current = false;
      return true;
    }
    retry.current = true;
    if (current.docRev === undefined) {
      const response = await meetApi.get(meeting.id, null, current.hostToken, signal);
      if (!isCurrent(signal) || !sameHostConnection(currentRecord(), current)) return false;
      if (!response.ok) {
        markError(response.error, false, current);
        return false;
      }
      if (response.value === 'unchanged') return false;
      const merged = await merge(response.value, signal, current);
      if (!merged || !isCurrent(signal) || !sameHostConnection(currentRecord(), current))
        return false;
      current = currentRecord()!;
      baseDocRev = response.value.docRev;
      doc = docFromMeeting(merged, latest.current.compute.times, latest.current.compute.unit);
      if (!needsUpload(doc, current)) {
        retry.current = false;
        deferred.current = false;
        awaitingCompute.current = false;
        return true;
      }
    }
    let removed = removedReplyOnly(doc, current);
    let clearReplyOrigins = overriddenReplyOrigins(doc.participants, current.replyOrigins);
    let response = await meetApi.update(
      meeting.id,
      doc,
      baseDocRev!,
      current.hostToken!,
      removed,
      signal,
      clearReplyOrigins,
    );
    if (!isCurrent(signal) || !sameHostConnection(currentRecord(), current)) return false;
    if (
      !response.ok &&
      response.error.code === 'conflict' &&
      response.error.docRev !== undefined &&
      response.error.docRev !== current.docRev
    ) {
      const remote = await meetApi.get(meeting.id, null, current.hostToken!, signal);
      if (!isCurrent(signal) || !sameHostConnection(currentRecord(), current)) return false;
      if (!remote.ok) {
        retry.current = true;
        markError(remote.error, false, current);
        return false;
      }
      if (remote.value === 'unchanged') {
        retry.current = true;
        return false;
      }
      const merged = await merge(remote.value, signal, current);
      if (!isCurrent(signal) || !sameHostConnection(currentRecord(), current)) return false;
      if (!merged) {
        retry.current = true;
        return false;
      }
      current = currentRecord()!;
      if (computeConditions(input.meeting) !== computeConditions(merged)) {
        // 새 출발지의 계산이 끝난 뒤 받은 본문 버전으로 이어 올린다.
        const expected = current;
        const docRev = remote.value.docRev;
        save((fresh) =>
          fresh && sameHostConnection(fresh, expected) && fresh.docRev === expected.docRev
            ? { ...fresh, docRev: Math.max(fresh.docRev ?? 0, docRev) }
            : fresh,
        );
        awaitingCompute.current = true;
        retry.current = true;
        return false;
      }
      doc = docFromMeeting(merged, latest.current.compute.times, latest.current.compute.unit);
      removed = removedReplyOnly(doc, current);
      clearReplyOrigins = overriddenReplyOrigins(doc.participants, current.replyOrigins);
      response = await meetApi.update(
        meeting.id,
        doc,
        remote.value.docRev,
        current.hostToken!,
        removed,
        signal,
        clearReplyOrigins,
      );
      if (!isCurrent(signal) || !sameHostConnection(currentRecord(), current)) return false;
    }
    if (!response.ok) {
      retry.current = true;
      markError(response.error, false, current);
      return false;
    }
    const value = response.value;
    let applied = false;
    save((fresh) => {
      if (
        !fresh ||
        fresh.ended ||
        !sameHostConnection(fresh, current) ||
        fresh.docRev !== current.docRev ||
        JSON.stringify(fresh.syncedDoc) !== JSON.stringify(current.syncedDoc) ||
        (fresh.docRev ?? 0) > value.docRev
      )
        return fresh;
      applied = true;
      return {
        ...fresh,
        docRev: value.docRev,
        syncedDoc: doc,
        ...(fresh.replyOrigins === undefined
          ? {}
          : {
              replyOrigins: Object.fromEntries(
                Object.entries(fresh.replyOrigins).filter(
                  ([pid, origin]) =>
                    !clearReplyOrigins.some(
                      (sent) =>
                        sent.participantId === pid &&
                        JSON.stringify(origin) === JSON.stringify(sent.origin),
                    ),
                ),
              ),
            }),
        ...(fresh.seen === undefined
          ? {}
          : {
              seen: fresh.seen.filter(
                (id) =>
                  !removed.includes(id) ||
                  !current.seen?.includes(id) ||
                  fresh.seenNames?.[id] !== current.seenNames?.[id],
              ),
            }),
        ...(fresh.seenNames === undefined
          ? {}
          : {
              seenNames: Object.fromEntries(
                Object.entries(fresh.seenNames).filter(
                  ([id, name]) => !removed.includes(id) || current.seenNames?.[id] !== name,
                ),
              ),
            }),
      };
    });
    if (!applied) return false;
    baseline.current = JSON.stringify(doc);
    retry.current = false;
    deferred.current = false;
    awaitingCompute.current = false;
    if (active.current) setUploaded((count) => count + 1);
    markOk();
    return true;
  }
  function beginFlight() {
    let finish!: () => void;
    const flight = new Promise<void>((resolve) => {
      finish = resolve;
    });
    inFlight.current = flight;
    return () => {
      if (inFlight.current === flight) inFlight.current = null;
      finish();
    };
  }
  async function flushUpload(): Promise<boolean> {
    const signal = lifecycle.current?.signal;
    if (!isCurrent(signal)) return false;
    // 확인·자동 올리기가 끝나면 최신 본문을 다시 확인한다.
    while (inFlight.current) {
      await inFlight.current;
      if (!isCurrent(signal)) return false;
    }
    const finish = beginFlight();
    try {
      while (true) {
        if (!isCurrent(signal)) return false;
        const current = currentRecord();
        if (!current?.hostToken || current.ended) return false;
        const input = latest.current;
        if (input.compute.pending) return false;
        const doc = docFromMeeting(input.meeting, input.compute.times, input.compute.unit);
        if (!needsUpload(doc, current)) return true;
        if (!(await upload(signal))) {
          if (isCurrent(signal)) deferred.current = true;
          return false;
        }
      }
    } finally {
      finish();
    }
  }
  async function tick(full = false): Promise<'ok' | 'error'> {
    const signal = lifecycle.current?.signal;
    if (!isCurrent(signal)) return 'ok';
    let current = currentRecord();
    if (active.current && JSON.stringify(current) !== JSON.stringify(record)) setRecord(current);
    if (!current?.hostToken || current.ended || inFlight.current) return 'ok';
    const finish = beginFlight();
    try {
      let response = await meetApi.get(
        meeting.id,
        full || !hydrated.current ? null : (current.lastRev ?? null),
        current.hostToken,
        signal,
      );
      if (!isCurrent(signal) || !sameHostConnection(currentRecord(), current)) return 'ok';
      if (
        !response.ok &&
        response.error.code === 'unauthorized' &&
        currentRecord()?.pendingHostToken
      ) {
        if (!(await reissueToken())) return 'error';
        if (!isCurrent(signal)) return 'ok';
        current = currentRecord();
        if (!current?.hostToken || current.ended) return 'error';
        response = await meetApi.get(meeting.id, null, current.hostToken, signal);
        if (!isCurrent(signal) || !sameHostConnection(currentRecord(), current)) return 'ok';
      }
      if (!response.ok) {
        markError(response.error, false, current);
        return 'error';
      }
      if (response.value !== 'unchanged' && !(await merge(response.value, signal, current)))
        return 'error';
      if (!isCurrent(signal)) return 'ok';
      if (retry.current && !(await upload(signal))) {
        if (isCurrent(signal)) deferred.current = true;
        return 'error';
      }
      if (hostReplyRetry.current && !(await sendHostLikes())) return 'error';
      if (!isCurrent(signal)) return 'ok';
      markOk();
      return 'ok';
    } finally {
      finish();
    }
  }
  const initialCheck = useEffectEvent(() => tick(true));
  const autoUpload = useEffectEvent(async () => {
    const signal = lifecycle.current?.signal;
    if (!isCurrent(signal)) return;
    if (deferred.current) {
      if (!awaitingCompute.current || latest.current.compute.pending) return;
      awaitingCompute.current = false;
      deferred.current = false;
    }
    if (inFlight.current) {
      retry.current = true;
      return;
    }
    const finish = beginFlight();
    try {
      if (!(await upload(signal)) && isCurrent(signal)) deferred.current = true;
    } finally {
      finish();
    }
  });
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    active.current = true;
    return () => {
      active.current = false;
      controller.abort();
      inFlight.current = null;
    };
  }, []);
  useEffect(() => subscribeOnline(meeting.id, setRecord), [meeting.id]);
  useEffect(() => {
    if (mode !== 'online') return;
    if (baseline.current === null) {
      const current = readOnline(meeting.id);
      const dirty =
        current?.syncedDoc != null &&
        hostEdits(
          meeting,
          current.syncedDoc,
          current.seen,
          current.replyOrigins,
          current.seenNames,
        );
      baseline.current = dirty ? '' : json;
    }
    if (document.visibilityState === 'visible' && navigator.onLine) void initialCheck();
    // 화면을 열 때 한 번, 그 뒤에는 useOnlinePoll이 보임·연결 상태를 지킨다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, meeting.id]);
  useOnlinePoll({ enabled: mode === 'online', tick: () => tick() });
  useEffect(() => {
    if (mode !== 'online' || compute.pending) return;
    const timer = setTimeout(() => {
      void autoUpload();
    }, 1000);
    return () => clearTimeout(timer);
  }, [json, compute.pending, mode, uploaded]);

  const autoHostReply = useEffectEvent(() => {
    if (!hostReplyDeferred.current) void sendHostLikes();
  });
  useEffect(() => {
    if (mode !== 'online') return;
    const timer = setTimeout(() => autoHostReply(), 1000);
    return () => clearTimeout(timer);
  }, [hostLikesJson, mode, uploaded]);

  async function share(kind: 'invite' | 'final' = 'invite') {
    const current = currentRecord();
    if (current?.ended) return;
    const input = latest.current;
    const shareFallback = (fresh: typeof input, sentAt = new Date().toISOString()) =>
      shareMeetingDoc(
        (kind === 'final' ? finalFromMeeting(fresh.meeting) : null) ??
          inviteFromMeeting(fresh.meeting, fresh.compute.times, fresh.compute.unit, sentAt),
        fresh.meeting.title.value,
      );
    if (isLinkMeeting(input.meeting, current)) {
      await shareFallback(input);
      return;
    }
    if (!current?.hostToken) {
      if (creating.current) return;
      creating.current = true;
      try {
        const hostToken = current?.pendingHostToken ?? newHostToken();
        const pending = { ...current, pendingHostToken: hostToken };
        save((fresh) =>
          sameHostConnection(fresh, current) ? { ...fresh, pendingHostToken: hostToken } : fresh,
        );
        let turnstile: string;
        try {
          turnstile = await getTurnstileToken();
        } catch {
          toast.error(errorMessage({ code: 'turnstile' }));
          return;
        }
        if (!sameHostConnection(currentRecord(), pending)) return;
        const fresh = latest.current;
        const doc: MeetingDoc = docFromMeeting(
          fresh.meeting,
          fresh.compute.times,
          fresh.compute.unit,
        );
        const sentAt = new Date().toISOString();
        const beforeCreate = currentRecord();
        const syncedDoc = beforeCreate?.syncedDoc ?? doc;
        const prepared = { ...beforeCreate, lastRev: beforeCreate?.lastRev ?? 0, syncedDoc };
        save((record) =>
          sameOnlineSync(record, beforeCreate) ? { ...record, ...prepared } : record,
        );
        if (!sameOnlineSync(currentRecord(), prepared)) return;
        const response = await meetApi.create(doc, turnstile, hostToken);
        if (!sameOnlineSync(currentRecord(), prepared)) return;
        if (!response.ok) {
          if (response.error.code === 'switched-off') {
            await shareFallback(fresh, sentAt);
          } else toast.error(errorMessage(response.error, true));
          return;
        }
        let applied = false;
        save((record) => {
          if (
            !sameOnlineSync(record, prepared) ||
            JSON.stringify(record?.hostLikes) !== JSON.stringify(prepared.hostLikes) ||
            record?.hostLikesAckRev !== prepared.hostLikesAckRev
          )
            return record;
          applied = true;
          const next = {
            ...record,
            hostToken: response.value.hostToken,
            hostLikes: [],
            lastRev: response.value.rev,
            docRev: response.value.docRev,
            syncedDoc: response.value.created ? doc : syncedDoc,
          };
          delete next.pendingHostToken;
          return next;
        });
        if (!applied) return;
        // 재시도 성공은 처음 본문만 서버에 있다는 뜻이므로 이번 본문은 미전송으로 둔다.
        baseline.current = response.value.created ? JSON.stringify(doc) : '';
        markOk();
        await sendHostLikes();
      } finally {
        creating.current = false;
      }
    } else if (!(await flushUpload())) {
      toast.error('지금은 보낼 수 없어요. 잠시 뒤 다시 해 주세요');
      return;
    }
    await shareOnlineLink(onlineMeetingUrl(meeting.id), latest.current.meeting.title.value);
  }
  async function shareFinal() {
    if (mode === 'online' || mode === 'local') {
      await share('final');
      return;
    }
    if (mode === 'link') {
      const doc = finalFromMeeting(latest.current.meeting);
      if (doc) await shareMeetingDoc(doc, latest.current.meeting.title.value);
    }
  }
  async function openOnOtherDevice() {
    const current = currentRecord();
    if (current?.hostToken && !current.ended)
      await shareOnlineLink(
        onlineMeetingUrl(meeting.id, current.hostToken),
        latest.current.meeting.title.value,
      );
  }
  async function releaseParticipant(pid: string) {
    const current = currentRecord();
    if (
      !current?.hostToken ||
      current.ended ||
      !window.confirm('이 참석자의 차지를 풀까요? 다른 기기에서 다시 고를 수 있어요')
    )
      return;
    const response = await meetApi.release(meeting.id, { participantId: pid }, current.hostToken);
    if (!response.ok) markError(response.error, true, current);
  }
  async function reissueToken(): Promise<boolean> {
    const signal = lifecycle.current?.signal;
    if (!isCurrent(signal)) return false;
    if (reissuing.current) return reissuing.current;
    const current = currentRecord();
    if (!current?.hostToken || current.ended) return false;
    const hostToken = current.pendingHostToken ?? newHostToken();
    const pending = { ...current, pendingHostToken: hostToken };
    save((fresh) =>
      sameHostConnection(fresh, current) ? { ...fresh, pendingHostToken: hostToken } : fresh,
    );
    reissuing.current = (async () => {
      const response = await meetApi.release(
        meeting.id,
        { host: true, hostToken },
        current.hostToken!,
      );
      if (!isCurrent(signal)) return false;
      if (!response.ok) {
        markError(response.error, true, pending);
        return false;
      }
      let applied = false;
      save((fresh) => {
        if (!fresh || fresh.ended || !sameHostConnection(fresh, pending)) return fresh;
        const next = { ...fresh, hostToken };
        delete next.pendingHostToken;
        applied = true;
        return next;
      });
      if (!applied) return false;
      markOk();
      return true;
    })();
    try {
      return await reissuing.current;
    } finally {
      reissuing.current = null;
    }
  }
  async function reissueHostLink() {
    const current = currentRecord();
    if (
      !current?.hostToken ||
      current.ended ||
      !window.confirm('주최자 링크를 다시 발급할까요? 이전 링크는 쓸 수 없어요')
    )
      return;
    if (await reissueToken()) toast.success('이전 주최자 링크는 이제 쓸 수 없어요');
  }
  async function removeFromServer() {
    const current = currentRecord();
    if (
      !current?.hostToken ||
      current.ended ||
      !window.confirm('서버에서 지울까요? 보관함의 약속은 그대로 남아요')
    )
      return;
    const response = await meetApi.remove(meeting.id, current.hostToken);
    if (!response.ok) {
      markError(response.error, true, current);
      return;
    }
    save((fresh) => {
      if (
        !fresh ||
        !sameHostConnection(fresh, current) ||
        JSON.stringify(fresh.guest) !== JSON.stringify(current.guest)
      )
        return fresh;
      const ended = { ...fresh, ended: true as const };
      delete ended.hostToken;
      delete ended.guest;
      return ended;
    });
  }
  // 이동 조건이 달라지면 예전 답장의 소요시간 대신 새 계산을 쓴다.
  const replyTimes: MeetingTimes = {};
  if (
    replyState &&
    replyState.doc.unit === compute.unit &&
    replyState.doc.mode === meeting.mode.value &&
    JSON.stringify(replyState.doc.at) === JSON.stringify(meeting.at.value)
  ) {
    for (const reply of replyState.replies) {
      const origin =
        reply.origin ??
        replyState.doc.participants.find((p) => p.id === reply.participantId)?.origin;
      const currentOrigin = meeting.participants.value.find(
        (p) => p.id === reply.participantId,
      )?.origin;
      if (origin?.lng !== currentOrigin?.lng || origin?.lat !== currentOrigin?.lat) continue;
      for (const [cid, value] of Object.entries(reply.times ?? {})) {
        const candidate = meeting.candidates.value.find((c) => c.id === cid);
        const previous = replyState.doc.candidates.find((c) => c.id === cid);
        if (
          candidate &&
          previous &&
          candidate.lng === previous.lng &&
          candidate.lat === previous.lat
        ) {
          (replyTimes[cid] ??= {})[reply.participantId] = value;
        }
      }
    }
  }
  return {
    mode,
    replyTimes,
    share,
    shareFinal,
    openOnOtherDevice,
    releaseParticipant,
    removeFromServer,
    reissueHostLink,
    status,
  };
}
