import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { MapView } from 'src/components/map/MapView';
import type { OnlineState, ReplyInput } from 'src/domain/meeting/online-doc';
import { paths } from 'src/routes/paths';
import type { Meeting, Origin, Participant } from 'src/schema/meeting';
import { meetApi, type OnlineError } from 'src/services/meet-online/client';
import { readOnline, writeOnline } from 'src/services/meet-online/store';
import { CandidateTally } from './CandidateTally';
import { FinalView } from './FinalView';
import { OriginPicker } from './OriginPicker';
import { loadMeetDraft, removeMeetDraft, saveMeetDraft, type MeetDraft } from './meet-drafts';
import { useMeetingCompute, type MeetingTimes } from './use-meeting-compute';
import { useOnlinePoll } from './use-online-poll';

const MODE_LABEL = { transit: '대중교통', car: '자동차', straight: '직선거리' };
function message(error: OnlineError) {
  switch (error.code) {
    case 'taken':
      return '다른 기기에서 이미 답했어요. 주최자에게 풀어 달라고 하세요';
    case 'full':
      return '참석자가 가득 찼어요';
    default:
      return '지금은 보낼 수 없어요. 잠시 뒤 다시 해 주세요';
  }
}

/** 참석자 토큰과 미전송 초안만 저장하고 보관함 약속은 바꾸지 않는다. */
export function OnlineInviteView({ id }: { id: string }) {
  const [guest, setGuest] = useState(() => readOnline(id)?.guest ?? null);
  const [state, setState] = useState<OnlineState | null>(null);
  const [draft, setDraft] = useState<MeetDraft | null>(() => {
    const saved = loadMeetDraft(id);
    return saved?.participantId === readOnline(id)?.guest?.participantId ? saved : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [newPerson, setNewPerson] = useState(false);
  const [name, setName] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [saved, setSaved] = useState(0);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const active = useRef(false);
  const inFlight = useRef(false);
  const needsFull = useRef(false);
  const needsSave = useRef(false);
  const deferred = useRef(false);
  const needsFreshDoc = useRef(false);
  const pid = guest?.participantId;
  const ownReply = state?.replies.find((r) => r.participantId === pid);
  const selected = state?.doc.participants.find((p) => p.id === pid);
  const origin = draft?.origin ?? ownReply?.origin ?? selected?.origin ?? null;
  const likes = (draft?.likes ?? ownReply?.likes ?? []).filter((cid) =>
    state?.doc.candidates.some((c) => c.id === cid),
  );
  const mine: Participant[] =
    pid && (draft?.origin ?? ownReply?.origin) != null
      ? [{ id: pid, name: selected?.name ?? ownReply?.name ?? name, origin }]
      : [];
  const compute = useMeetingCompute({
    participants: mine,
    targets: state?.doc.candidates ?? [],
    mode: state?.doc.mode ?? 'transit',
    at: state?.doc.at ?? null,
  });
  const computeKey = JSON.stringify([mine, state?.doc.candidates, state?.doc.mode, state?.doc.at]);
  const computeTimes = compute.compute;
  useEffect(() => {
    if (mine.length === 0) return;
    const controller = new AbortController();
    void computeTimes({ signal: controller.signal });
    return () => controller.abort();
    // 값이 같은 서버 응답으로 계산을 다시 시작하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computeKey, computeTimes]);
  const calculatedTimes = Object.fromEntries(
    (state?.doc.candidates ?? []).map((c) => [c.id, compute.times[c.id]?.[pid!] ?? null]),
  );
  const pending = mine.length > 0 && (compute.pending || compute.stale);
  const recalculated =
    mine.length > 0 &&
    !pending &&
    state?.doc.candidates.every((c) => Object.hasOwn(compute.times[c.id] ?? {}, pid!)) &&
    (ownReply?.times == null ||
      state.doc.candidates.some((c) => ownReply.times?.[c.id] !== calculatedTimes[c.id]));
  const input: ReplyInput | null =
    state && (draft || recalculated)
      ? {
          likes,
          ...(draft?.origin == null ? {} : { origin: draft.origin }),
          ...(mine.length > 0
            ? { times: calculatedTimes, docRev: state.docRev }
            : draft?.origin === undefined && draft?.times !== undefined
              ? {
                  times: draft.times,
                  ...(draft.docRev === undefined ? {} : { docRev: draft.docRev }),
                }
              : {}),
        }
      : null;
  const latest = useRef({ guest, state, draft, input, pending });
  useLayoutEffect(() => {
    latest.current = { guest, state, draft, input, pending };
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  function markError(failure: OnlineError, reading = false, failedToken: string | null = null) {
    if (!active.current) return;
    if (failure.code === 'unauthorized') {
      const record = readOnline(id);
      if (record?.guest && record.guest.token !== failedToken) {
        const savedDraft = loadMeetDraft(id);
        setGuest(record.guest);
        setDraft(savedDraft?.participantId === record.guest.participantId ? savedDraft : null);
        setState(null);
        deferred.current = false;
      } else {
        if (record?.guest?.token === failedToken) {
          delete record.guest;
          writeOnline(id, record);
        }
        removeMeetDraft(id);
        setGuest(null);
        setDraft(null);
      }
      setPicking(false);
      setError(null);
    } else {
      setError(message(failure));
      if (reading && (failure.code === 'ended' || failure.code === 'not-found')) setEnded(true);
    }
  }
  async function sendDraft(): Promise<boolean> {
    const current = latest.current;
    if (!current.guest || !current.input || current.pending || needsFreshDoc.current) return true;
    const sent = current.input;
    // 계산한 내 줄도 함께 남겨 새로고침 뒤 재시도할 수 있게 한다.
    saveMeetDraft(id, { participantId: current.guest.participantId, ...sent });
    const result = await meetApi.reply(id, sent, current.guest.token);
    if (!active.current || latest.current.guest?.token !== current.guest.token) return false;
    if (!result.ok) {
      deferred.current = true;
      markError(result.error, false, current.guest.token);
      return false;
    }
    const updatedAt = new Date().toISOString();
    setState((previous) => {
      if (!previous) return previous;
      const old = previous.replies.find((r) => r.participantId === current.guest!.participantId);
      const participant = previous.doc.participants.find(
        (p) => p.id === current.guest!.participantId,
      );
      return {
        ...previous,
        replies: [
          ...previous.replies.filter((r) => r.participantId !== current.guest!.participantId),
          {
            participantId: current.guest!.participantId,
            name: old?.name ?? participant?.name ?? name,
            origin: sent.origin === undefined ? (old?.origin ?? null) : sent.origin,
            likes: sent.likes,
            times: result.value.timesDropped
              ? null
              : sent.times === undefined
                ? (old?.times ?? null)
                : sent.times,
            updatedAt,
          },
        ],
      };
    });
    if (JSON.stringify(latest.current.input) === JSON.stringify(sent)) {
      removeMeetDraft(id);
      setDraft(null);
    }
    needsFreshDoc.current = result.value.timesDropped === true;
    deferred.current = needsFreshDoc.current;
    setSaved((count) => count + 1);
    setError(null);
    setLastOkAt(Date.now());
    return true;
  }
  function finishFlight() {
    inFlight.current = false;
    if (!active.current) return;
    if (needsFull.current) {
      needsFull.current = false;
      void refresh(true);
    } else if (needsSave.current) {
      needsSave.current = false;
      // 수신한 본문이 화면에 반영된 뒤 최신 입력으로 바로 저장한다.
      setSaveAttempt((count) => count + 1);
    }
  }
  async function refresh(full = false): Promise<'ok' | 'error'> {
    if (inFlight.current) {
      if (full) needsFull.current = true;
      return 'ok';
    }
    inFlight.current = true;
    try {
      const sent = full || (await sendDraft());
      const current = latest.current;
      const result = await meetApi.get(
        id,
        full || needsFreshDoc.current ? null : (current.state?.rev ?? null),
        current.guest?.token ?? null,
      );
      if (!active.current || current.guest?.token !== latest.current.guest?.token) return 'error';
      if (!result.ok) {
        markError(result.error, true, current.guest?.token ?? null);
        return 'error';
      }
      if (result.value !== 'unchanged') {
        needsFreshDoc.current = false;
        deferred.current = false;
        setState(result.value);
      }
      if (sent) setError(null);
      setLastOkAt(Date.now());
      return sent ? 'ok' : 'error';
    } finally {
      finishFlight();
    }
  }
  const initialCheck = useEffectEvent(() => refresh(true));
  useEffect(() => {
    if (navigator.onLine && document.visibilityState === 'visible') void initialCheck();
  }, [id, guest?.token]);
  useOnlinePoll({ enabled: !ended, tick: () => refresh() });
  const inputKey = JSON.stringify(input);
  const autoSave = useEffectEvent(async (retry = false) => {
    if (inFlight.current) {
      needsSave.current = true;
      return;
    }
    if ((!retry && deferred.current) || !navigator.onLine) return;
    inFlight.current = true;
    try {
      await sendDraft();
    } finally {
      finishFlight();
    }
  });
  useEffect(() => {
    if (saveAttempt > 0) void autoSave(true);
  }, [saveAttempt]);
  useEffect(() => {
    const flushHidden = () => {
      if (document.visibilityState === 'hidden') void autoSave(true);
    };
    document.addEventListener('visibilitychange', flushHidden);
    return () => document.removeEventListener('visibilitychange', flushHidden);
  }, []);
  useEffect(() => {
    if (!inputKey || inputKey === 'null' || pending) return;
    const timer = setTimeout(() => {
      void autoSave();
    }, 1000);
    return () => clearTimeout(timer);
  }, [inputKey, pending, saved]);

  function edit(patch: Partial<ReplyInput>) {
    if (!guest) return;
    const next: MeetDraft = { participantId: guest.participantId, ...draft, likes, ...patch };
    saveMeetDraft(id, next);
    setDraft(next);
    deferred.current = false;
  }
  async function claim(who: { participantId: string } | { newName: string }) {
    if (claiming) return;
    setClaiming(true);
    const result = await meetApi.claim(id, who);
    if (!active.current) return;
    if (!result.ok && (result.error.code === 'not-found' || result.error.code === 'ended')) {
      const refreshed = await meetApi.get(id, null, null);
      if (!active.current) return;
      setClaiming(false);
      if (!refreshed.ok) {
        markError(refreshed.error, true);
        return;
      }
      if (refreshed.value !== 'unchanged') {
        setState(refreshed.value);
      }
      setError('그 참석자는 이제 목록에 없어요. 다시 골라 주세요');
      return;
    }
    setClaiming(false);
    if (!result.ok) {
      markError(result.error);
      return;
    }
    const next = { participantId: result.value.participantId, token: result.value.guestToken };
    writeOnline(id, { ...readOnline(id), guest: next });
    setGuest(next);
    setDraft(null);
    setError(null);
  }
  if (ended)
    return (
      <Box role="alert" sx={{ p: 3 }}>
        <h1>끝난 약속이에요</h1>
        <Button component={Link} to={paths.meetings}>
          약속 목록으로
        </Button>
      </Box>
    );
  if (!state)
    return (
      <Box sx={{ p: 3 }}>
        {error ? <p role="alert">{error}</p> : <p role="status">약속을 읽는 중이에요</p>}
      </Box>
    );
  const { doc } = state;
  const age =
    lastOkAt === null
      ? '아직 확인하지 못했어요'
      : `${Math.max(0, Math.floor((clockNow - lastOkAt) / 60_000))}분 전 기준`;
  const identity = !guest ? (
    <Box component="section" aria-label="나는 누구?" sx={{ my: 2 }}>
      <h2>나는 누구?</h2>
      {doc.participants.slice(1).map((p) => (
        <Button
          key={p.id}
          disabled={claiming}
          onClick={() => void claim({ participantId: p.id })}
          sx={{ minHeight: 44 }}
        >
          {p.name}
        </Button>
      ))}
      <Button disabled={claiming} onClick={() => setNewPerson(true)} sx={{ minHeight: 44 }}>
        목록에 없어요
      </Button>
      {newPerson && (
        <Box>
          <TextField
            label="내 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            inputProps={{ maxLength: 20 }}
          />
          <Button
            disabled={claiming || !name.trim() || name.trim().length > 20}
            onClick={() => void claim({ newName: name.trim() })}
            sx={{ minHeight: 44 }}
          >
            참석하기
          </Button>
        </Box>
      )}
    </Box>
  ) : null;
  if (doc.decided !== null)
    return (
      <>
        {error && <p role="alert">{error}</p>}
        {identity}
        <FinalView state={state} participantId={pid ?? null} />
        <Box sx={{ p: 2 }}>{age}</Box>
      </>
    );
  const participants: Participant[] = doc.participants.map((p) => ({
    ...p,
    origin: p.id === pid ? origin : null,
  }));
  for (const reply of state.replies) {
    if (!participants.some((p) => p.id === reply.participantId))
      participants.push({
        id: reply.participantId,
        name: reply.name,
        origin: reply.participantId === pid ? origin : null,
      });
  }
  const times: MeetingTimes = Object.fromEntries(
    Object.entries(doc.times).map(([cid, row]) => [cid, { ...row }]),
  );
  for (const reply of state.replies) {
    if (reply.times === null) continue;
    for (const [cid, value] of Object.entries(reply.times))
      (times[cid] ??= {})[reply.participantId] = value;
  }
  if (pid && mine.length > 0)
    for (const c of doc.candidates) (times[c.id] ??= {})[pid] = compute.times[c.id]?.[pid] ?? null;
  const field = <T,>(value: T) => ({
    value,
    updatedAt: new Date(lastOkAt ?? 0).toISOString(),
  });
  const meeting: Meeting = {
    id,
    title: field(doc.title),
    at: field(doc.at),
    mode: field(doc.mode),
    rank: field('max'),
    participants: field(participants),
    candidates: field(doc.candidates),
    decided: field(doc.decided),
    replies: field({
      ...Object.fromEntries(
        state.replies.map((r) => [
          r.participantId,
          { likes: r.likes, sentAt: r.updatedAt, receivedAt: r.updatedAt },
        ]),
      ),
      ...(pid
        ? { [pid]: { likes, sentAt: field(null).updatedAt, receivedAt: field(null).updatedAt } }
        : {}),
    }),
    createdAt: field(null).updatedAt,
    deletedAt: null,
  };
  return (
    <Box sx={{ p: 2, maxWidth: 760, mx: 'auto' }}>
      <h1>{doc.title}</h1>
      <p>
        {doc.at ? `${doc.at.date.replaceAll('-', '.')} ${doc.at.time}` : '일시 미정'} ·{' '}
        {MODE_LABEL[doc.mode]}
      </p>
      {error && <p role="alert">{error}</p>}
      <Box component="section" aria-label="후보 지도" sx={{ height: 280, position: 'relative' }}>
        <MapView
          markers={doc.candidates.map((c, i) => ({
            id: c.id,
            lng: c.lng,
            lat: c.lat,
            label: `${i + 1} ${c.name}`,
            color: '#b64800',
            clusterable: false,
          }))}
          polylines={[]}
          onMarkerClick={() => {}}
          onUnavailable={setMapError}
        />
        {mapError && <Box role="status">{mapError}</Box>}
      </Box>
      {!guest ? (
        identity
      ) : (
        <Box component="section" aria-label="내 출발지">
          <h2>내 출발지</h2>
          <p>{origin?.name ?? '출발지 없음'}</p>
          <Button onClick={() => setPicking(true)} sx={{ minHeight: 44 }}>
            내 출발지 고르기
          </Button>
          {compute.pending && <p role="status">내 소요시간을 다시 찾는 중이에요</p>}
        </Box>
      )}
      <Box component="ul" aria-label="참석자 출발지">
        {participants.map((p) => (
          <li key={p.id}>
            {p.name} ·{' '}
            {p.id === pid
              ? (origin?.name ?? '출발지 없음')
              : (state.originNames?.[p.id] ?? '출발지 없음')}
          </li>
        ))}
      </Box>
      <CandidateTally
        meeting={meeting}
        participantId={pid ?? null}
        times={times}
        errors={compute.errors}
        unit={doc.unit}
        onLike={(cid) =>
          edit({ likes: likes.includes(cid) ? likes.filter((c) => c !== cid) : [...likes, cid] })
        }
        onRetry={(cid, who) => void compute.retry(cid, who)}
      />
      <OriginPicker
        open={picking}
        origin={origin}
        onClose={() => setPicking(false)}
        onPick={(next: Origin) => {
          edit({ origin: next });
          setPicking(false);
        }}
      />
      <p>{age}</p>
    </Box>
  );
}
