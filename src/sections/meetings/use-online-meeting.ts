import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { finalFromMeeting, inviteFromMeeting } from 'src/domain/meeting/link';
import { docFromMeeting, type MeetingDoc, type OnlineState } from 'src/domain/meeting/online-doc';
import { mergeOnline } from 'src/domain/meeting/online-merge';
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
  const inFlight = useRef(false);
  const creating = useRef(false);
  const hydrated = useRef(false);
  const retry = useRef(false);
  const deferred = useRef(false);
  const baseline = useRef<string | null>(null);
  const mode: OnlineMeetingMode = record?.ended
    ? 'ended'
    : isLinkMeeting(meeting, record)
      ? 'link'
      : record?.hostToken
        ? 'online'
        : 'local';
  const json = JSON.stringify(docFromMeeting(meeting, compute.times, compute.unit));

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
    if (notify || error.code === 'unauthorized') toast.error(errorMessage(error));
  }
  function markOk() {
    if (active.current) setStatus({ lastOkAt: Date.now(), failing: false });
  }
  async function merge(state: OnlineState): Promise<Meeting | null> {
    let merged: Meeting | null = null;
    const result = await latest.current.run((lib, ctx) => {
      const out = mergeOnline(lib, meeting.id, state, ctx, currentRecord()?.syncedAt ?? null);
      if (out.ok) merged = out.lib.meetings![meeting.id]!;
      return out;
    });
    if (!result.ok) return null;
    const current = currentRecord();
    if (current && !current.ended) save({ ...current, lastRev: state.rev, docRev: state.docRev });
    hydrated.current = true;
    baseline.current = JSON.stringify(state.doc);
    if (active.current) setReplyState(state);
    return merged;
  }
  async function upload(): Promise<boolean> {
    let current = currentRecord();
    const input = latest.current;
    if (!current?.hostToken || current.ended || input.compute.pending) return true;
    let doc = docFromMeeting(input.meeting, input.compute.times, input.compute.unit);
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
      doc = docFromMeeting(merged, latest.current.compute.times, latest.current.compute.unit);
    }
    // 응답을 기다리는 사이 고친 필드는 이 시각보다 새로워 다음 확인에서도 보존된다.
    let sentAt = new Date().toISOString();
    let response = await meetApi.update(meeting.id, doc, current.docRev!, current.hostToken!);
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
  async function tick(full = false): Promise<'ok' | 'error'> {
    const current = currentRecord();
    if (!current?.hostToken || current.ended || inFlight.current) return 'ok';
    inFlight.current = true;
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
      markOk();
      return 'ok';
    } finally {
      inFlight.current = false;
    }
  }
  const initialCheck = useEffectEvent(() => tick(true));
  const autoUpload = useEffectEvent(async () => {
    if (deferred.current) return;
    if (inFlight.current) {
      retry.current = true;
      return;
    }
    inFlight.current = true;
    try {
      if (!(await upload())) deferred.current = true;
    } finally {
      inFlight.current = false;
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

  async function share() {
    const current = currentRecord();
    if (current?.ended) return;
    const input = latest.current;
    if (isLinkMeeting(input.meeting, current)) {
      await shareMeetingDoc(
        inviteFromMeeting(
          input.meeting,
          input.compute.times,
          input.compute.unit,
          new Date().toISOString(),
        ),
        input.meeting.title.value,
      );
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
            await shareMeetingDoc(
              inviteFromMeeting(fresh.meeting, fresh.compute.times, fresh.compute.unit, sentAt),
              fresh.meeting.title.value,
            );
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
      } finally {
        creating.current = false;
      }
    }
    await shareLink(onlineMeetingUrl(meeting.id), latest.current.meeting.title.value);
  }
  async function shareFinal() {
    if (mode === 'online' || mode === 'local') {
      await share();
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
