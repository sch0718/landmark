import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { finalFromMeeting, inviteFromMeeting } from 'src/domain/meeting/link';
import { docFromMeeting, type MeetingDoc, type OnlineState } from 'src/domain/meeting/online-doc';
import { mergeOnline, shouldAdoptRemoteDoc } from 'src/domain/meeting/online-merge';
import type { Meeting } from 'src/schema/meeting';
import { meetApi, type OnlineError } from 'src/services/meet-online/client';
import {
  isLinkMeeting,
  readOnline,
  writeOnline,
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
  const inFlight = useRef<Promise<void> | null>(null);
  const creating = useRef(false);
  const hydrated = useRef(false);
  const retry = useRef(false);
  const unauthorizedNotified = useRef(false);
  const deferred = useRef(false);
  const baseline = useRef<string | null>(null);
  const hostLikesBaseline = useRef('[]');
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
    (next: OnlineRecord) => {
      writeOnline(meeting.id, next);
      if (active.current) setRecord(next);
    },
    [meeting.id],
  );
  const currentRecord = () => readOnline(meeting.id);
  function markError(error: OnlineError, notify = false) {
    const current = currentRecord();
    if ((error.code === 'ended' || error.code === 'not-found') && current) {
      const ended = { ...current, ended: true as const };
      delete ended.hostToken;
      delete ended.guest;
      save(ended);
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
  async function sendHostLikes(): Promise<boolean> {
    const current = currentRecord();
    if (!current?.hostToken || current.ended || hostReplyInFlight.current) return true;
    const input = latest.current.meeting;
    const likes = input.replies.value[input.participants.value[0]!.id]?.likes ?? [];
    const sent = JSON.stringify(likes);
    if (sent === hostLikesBaseline.current) {
      hostReplyRetry.current = false;
      hostReplyDeferred.current = false;
      return true;
    }
    hostReplyInFlight.current = true;
    try {
      const response = await meetApi.reply(meeting.id, { likes }, current.hostToken);
      if (!response.ok) {
        hostReplyRetry.current = true;
        hostReplyDeferred.current = true;
        markError(response.error);
        return false;
      }
      hostLikesBaseline.current = sent;
      hostReplyRetry.current = false;
      hostReplyDeferred.current = false;
      if (active.current) setUploaded((count) => count + 1);
      markOk();
      return true;
    } finally {
      hostReplyInFlight.current = false;
    }
  }
  async function merge(state: OnlineState): Promise<Meeting | null> {
    if (state.originNames !== undefined) {
      markError({ code: 'unauthorized' });
      return null;
    }
    let merged: Meeting | null = null;
    let adoptedAt: string | null = null;
    const result = await latest.current.run((lib, ctx) => {
      const current = currentRecord();
      const sync = { syncedAt: current?.syncedAt ?? null, docRev: current?.docRev ?? null };
      const before = lib.meetings?.[meeting.id];
      if (before && shouldAdoptRemoteDoc(before, state, sync)) adoptedAt = ctx.now;
      const out = mergeOnline(lib, meeting.id, state, ctx, sync);
      if (out.ok) merged = out.lib.meetings![meeting.id]!;
      return out;
    });
    if (!result.ok) return null;
    const current = currentRecord();
    if (current && !current.ended)
      save({
        ...current,
        lastRev: state.rev,
        ...(adoptedAt === null ? {} : { docRev: state.docRev, syncedAt: adoptedAt }),
      });
    hydrated.current = true;
    if (adoptedAt !== null) baseline.current = JSON.stringify(state.doc);
    if (!hostReplyInFlight.current) {
      hostLikesBaseline.current = JSON.stringify(
        (
          state.replies.find(
            (r) => r.participantId === latest.current.meeting.participants.value[0]!.id,
          )?.likes ?? []
        ).filter((cid) => merged?.candidates.value.some((c) => c.id === cid)),
      );
    }
    if (active.current) setReplyState(state);
    return merged;
  }
  async function upload(): Promise<boolean> {
    let current = currentRecord();
    const input = latest.current;
    if (!current?.hostToken || current.ended || input.compute.pending) return true;
    let doc = docFromMeeting(input.meeting, input.compute.times, input.compute.unit);
    let baseDocRev = current.docRev;
    if (JSON.stringify(doc) === baseline.current) {
      retry.current = false;
      deferred.current = false;
      return true;
    }
    retry.current = true;
    if (current.docRev === undefined) {
      const response = await meetApi.get(meeting.id, null, current.hostToken);
      if (!response.ok) {
        markError(response.error);
        return false;
      }
      if (response.value === 'unchanged') return false;
      const merged = await merge(response.value);
      if (!merged) return false;
      current = currentRecord()!;
      baseDocRev = response.value.docRev;
      doc = docFromMeeting(merged, latest.current.compute.times, latest.current.compute.unit);
      if (JSON.stringify(doc) === baseline.current) {
        retry.current = false;
        deferred.current = false;
        return true;
      }
    }
    // 응답을 기다리는 사이 고친 필드는 이 시각보다 새로워 다음 확인에서도 보존된다.
    let sentAt = new Date().toISOString();
    let response = await meetApi.update(meeting.id, doc, baseDocRev!, current.hostToken!);
    if (
      !response.ok &&
      response.error.code === 'conflict' &&
      response.error.docRev !== undefined &&
      response.error.docRev !== current.docRev
    ) {
      const remote = await meetApi.get(meeting.id, null, current.hostToken!);
      if (!remote.ok) {
        retry.current = true;
        markError(remote.error);
        return false;
      }
      if (remote.value === 'unchanged') {
        retry.current = true;
        return false;
      }
      const merged = await merge(remote.value);
      if (!merged) {
        retry.current = true;
        return false;
      }
      current = currentRecord()!;
      doc = docFromMeeting(merged, latest.current.compute.times, latest.current.compute.unit);
      sentAt = new Date().toISOString();
      response = await meetApi.update(meeting.id, doc, remote.value.docRev, current.hostToken!);
    }
    if (!response.ok) {
      retry.current = true;
      markError(response.error);
      return false;
    }
    const fresh = currentRecord();
    if (fresh && !fresh.ended) save({ ...fresh, docRev: response.value.docRev, syncedAt: sentAt });
    baseline.current = JSON.stringify(doc);
    retry.current = false;
    deferred.current = false;
    if (active.current) setUploaded((count) => count + 1);
    markOk();
    return true;
  }
  function beginFlight() {
    let finish!: () => void;
    inFlight.current = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return () => {
      inFlight.current = null;
      finish();
    };
  }
  async function flushUpload(): Promise<boolean> {
    // 확인·자동 올리기가 끝나면 최신 본문을 다시 확인한다.
    while (inFlight.current) await inFlight.current;
    const finish = beginFlight();
    try {
      while (true) {
        const current = currentRecord();
        if (!current?.hostToken || current.ended) return false;
        const input = latest.current;
        if (input.compute.pending) return false;
        const doc = docFromMeeting(input.meeting, input.compute.times, input.compute.unit);
        if (JSON.stringify(doc) === baseline.current) return true;
        if (!(await upload())) {
          deferred.current = true;
          return false;
        }
      }
    } finally {
      finish();
    }
  }
  async function tick(full = false): Promise<'ok' | 'error'> {
    const current = currentRecord();
    if (!current?.hostToken || current.ended || inFlight.current) return 'ok';
    const finish = beginFlight();
    try {
      const response = await meetApi.get(
        meeting.id,
        full || !hydrated.current ? null : current.lastRev,
        current.hostToken,
      );
      if (!response.ok) {
        markError(response.error);
        return 'error';
      }
      if (response.value !== 'unchanged' && !(await merge(response.value))) return 'error';
      if (retry.current && !(await upload())) {
        deferred.current = true;
        return 'error';
      }
      if (hostReplyRetry.current && !(await sendHostLikes())) return 'error';
      markOk();
      return 'ok';
    } finally {
      finish();
    }
  }
  const initialCheck = useEffectEvent(() => tick(true));
  const autoUpload = useEffectEvent(async () => {
    if (deferred.current) return;
    if (inFlight.current) {
      retry.current = true;
      return;
    }
    const finish = beginFlight();
    try {
      if (!(await upload())) deferred.current = true;
    } finally {
      finish();
    }
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (mode !== 'online') return;
    if (baseline.current === null) {
      const syncedAt = readOnline(meeting.id)?.syncedAt;
      const dirty =
        !syncedAt ||
        [
          meeting.title,
          meeting.at,
          meeting.mode,
          meeting.participants,
          meeting.candidates,
          meeting.decided,
        ].some((field) => field.updatedAt > syncedAt);
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
        let turnstile: string;
        try {
          turnstile = await getTurnstileToken();
        } catch {
          toast.error(errorMessage({ code: 'turnstile' }));
          return;
        }
        const fresh = latest.current;
        const doc: MeetingDoc = docFromMeeting(
          fresh.meeting,
          fresh.compute.times,
          fresh.compute.unit,
        );
        const sentAt = new Date().toISOString();
        const response = await meetApi.create(doc, turnstile);
        if (!response.ok) {
          if (response.error.code === 'switched-off') {
            await shareFallback(fresh, sentAt);
          } else toast.error(errorMessage(response.error, true));
          return;
        }
        baseline.current = JSON.stringify(doc);
        save({
          hostToken: response.value.hostToken,
          lastRev: response.value.rev,
          docRev: response.value.docRev,
          syncedAt: sentAt,
        });
        markOk();
        await sendHostLikes();
      } finally {
        creating.current = false;
      }
    } else if (!(await flushUpload())) {
      toast.error('지금은 보낼 수 없어요. 잠시 뒤 다시 해 주세요');
      return;
    }
    await shareLink(onlineMeetingUrl(meeting.id), latest.current.meeting.title.value);
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
      await shareLink(
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
    if (!response.ok) markError(response.error, true);
  }
  async function reissueHostLink() {
    const current = currentRecord();
    if (
      !current?.hostToken ||
      current.ended ||
      !window.confirm('주최자 링크를 다시 발급할까요? 이전 링크는 쓸 수 없어요')
    )
      return;
    const response = await meetApi.release(meeting.id, { host: true }, current.hostToken);
    if (!response.ok) {
      markError(response.error, true);
      return;
    }
    if (response.value.hostToken) {
      save({ ...currentRecord()!, hostToken: response.value.hostToken });
      toast.success('이전 주최자 링크는 이제 쓸 수 없어요');
    }
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
      markError(response.error, true);
      return;
    }
    const ended = { ...currentRecord()!, ended: true as const };
    delete ended.hostToken;
    delete ended.guest;
    save(ended);
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
      const conditions = [
        meeting.mode.updatedAt,
        meeting.at.updatedAt,
        meeting.candidates.updatedAt,
      ];
      // 본문 출발지를 쓰는 답장은 그 뒤의 참석자 수정에도 예전 시간을 재사용하지 않는다.
      if (reply.origin === null) conditions.push(meeting.participants.updatedAt);
      if (conditions.some((at) => at > reply.updatedAt)) continue;
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
