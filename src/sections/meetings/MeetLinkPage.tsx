import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useEffect, useEffectEvent, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { mergeOnline, shouldAdoptRemoteDoc } from 'src/domain/meeting/online-merge';
import { meetingFailure, storeMeeting } from 'src/domain/meeting/ops';
import { LIBRARY_LIMITS } from 'src/schema/library';
import { MeetingId, type Meeting, type Origin } from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';
import { meetApi } from 'src/services/meet-online/client';
import {
  readOnline,
  rememberReplyOnly,
  sameOnlineSync,
  updateOnline,
} from 'src/services/meet-online/store';
import { OnlineInviteView } from './OnlineInviteView';
import { useMeeting } from './use-meeting';
import { readMeetHash } from 'src/domain/meeting/link';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import { FinalView } from './FinalView';
import { InviteView } from './InviteView';
import { ReplyImport } from './ReplyImport';

type ReadResult = Awaited<ReturnType<typeof readMeetHash>>;
/** 해시를 남겨 새로고침을 지원하고 이전 해시의 늦은 해석 결과는 버린다. */
function LegacyMeetLinkPage() {
  const { hash } = useLocation();
  const [state, setState] = useState<{ hash: string; result: ReadResult } | null>(null);
  useEffect(() => {
    let active = true;
    void readMeetHash(hash).then(
      (result) => {
        if (!active) return;
        if (!result.ok) console.warn('약속 링크를 읽지 못했어요', result.reason);
        setState({ hash, result });
      },
      (error: unknown) => {
        if (!active) return;
        console.warn('약속 링크를 읽지 못했어요', error);
        setState({ hash, result: { ok: false, reason: 'corrupt' } });
      },
    );
    return () => {
      active = false;
    };
  }, [hash]);
  if (state === null || state.hash !== hash)
    return (
      <Box role="status" sx={{ p: 3 }}>
        약속 링크를 읽는 중이에요
      </Box>
    );
  if (!state.result.ok)
    return (
      <Box role="alert" sx={{ p: 3, textAlign: 'center' }}>
        <Box component="h1" sx={{ fontSize: 20 }}>
          링크를 읽지 못했어요
        </Box>
        <Button component={Link} to={paths.meetings} variant="contained" sx={{ minHeight: 44 }}>
          약속 목록으로
        </Button>
      </Box>
    );
  const doc = state.result.doc;
  return doc.kind === 'd' ? (
    <InviteView key={hash} doc={doc} />
  ) : doc.kind === 'r' ? (
    <ReplyImport key={hash} doc={doc} />
  ) : (
    <FinalView key={hash} doc={doc} />
  );
}

function LinkError({
  message = '링크를 읽지 못했어요',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Box role="alert" sx={{ p: 3 }}>
      <h1>{message}</h1>
      {onRetry && <Button onClick={onRetry}>다시 시도</Button>}
      <Button component={Link} to={paths.meetings}>
        약속 목록으로
      </Button>
    </Box>
  );
}

const HOST_LINK_KEY = 'tripmap:meet-host-link:v1';
function readHostLinks(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(HOST_LINK_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([id, token]) =>
          safeParse(MeetingId, id).success && typeof token === 'string' && token.length > 0,
      ),
    );
  } catch {
    return {};
  }
}
function rememberHostLink(id: string, token: string): boolean {
  try {
    sessionStorage.setItem(HOST_LINK_KEY, JSON.stringify({ ...readHostLinks(), [id]: token }));
    return true;
  } catch {
    return false;
  }
}
function forgetHostLink(id: string, token: string) {
  try {
    const tokens = readHostLinks();
    if (tokens[id] !== token) return;
    delete tokens[id];
    if (Object.keys(tokens).length === 0) sessionStorage.removeItem(HOST_LINK_KEY);
    else sessionStorage.setItem(HOST_LINK_KEY, JSON.stringify(tokens));
  } catch {
    // 저장소가 막혀도 이번 화면의 담기는 마친다.
  }
}

/** 이 탭에 토큰을 보관한 뒤 해시를 지우고, 담기에 성공하면 토큰도 지운다. */
function HostLink({ id, token }: { id: string; token: string }) {
  const { run } = useMeeting(id);
  const importMeeting = useEffectEvent((op: Parameters<typeof run>[0]) => run(op));
  const navigate = useNavigate();
  const { search } = useLocation();
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    // 세션 저장이 막히면 새로고침으로 토큰을 잃지 않도록 해시를 남긴다.
    if (rememberHostLink(id, token))
      window.history.replaceState(window.history.state, '', `${paths.meetOnline(id)}${search}`);
    const expected = readOnline(id);
    void (async () => {
      const response = await meetApi.get(id, null, token);
      if (!active) return;
      if (!response.ok || response.value === 'unchanged') {
        const terminal =
          !response.ok && ['unauthorized', 'ended', 'not-found'].includes(response.error.code);
        if (terminal) forgetHostLink(id, token);
        setError({
          message:
            !response.ok && response.error.code === 'unauthorized'
              ? '주최자 링크가 더 이상 쓸 수 없어요'
              : terminal
                ? '끝난 약속이에요'
                : '지금은 열 수 없어요. 잠시 뒤 다시 해 주세요',
          retry: !terminal,
        });
        return;
      }
      const state = response.value;
      // 가려진 본문이 돌아와도 보관함의 출발지를 덮지 않는다.
      if (state.originNames !== undefined) {
        forgetHostLink(id, token);
        setError({ message: '주최자 링크가 더 이상 쓸 수 없어요', retry: false });
        return;
      }
      const outdated = (current = readOnline(id)) =>
        !sameOnlineSync(current, expected) ||
        state.rev < (current?.lastRev ?? 0) ||
        (current?.hostToken !== undefined &&
          current.hostToken !== token &&
          (current.lastRev ?? 0) >= state.rev);
      if (outdated()) {
        forgetHostLink(id, token);
        void navigate(paths.meeting(id), { replace: true });
        return;
      }
      let mergedRecord = readOnline(id);
      let adopted = false;
      let skipped = false;
      let addedReplyOnly: string[] = [];
      let seenNames: Record<string, string> = {};
      let hostLikes: string[] | undefined;
      let replyOrigins: Record<string, Origin> | undefined;
      const result = await importMeeting((lib, ctx) => {
        const current = readOnline(id);
        // 보관함 연산을 기다리는 동안 갱신된 기록과 새 토큰도 지킨다.
        if (!active || outdated(current)) {
          skipped = true;
          return lib;
        }
        mergedRecord = current;
        const before = lib.meetings?.[id];
        if (!before && Object.keys(lib.meetings ?? {}).length >= LIBRARY_LIMITS.meetingsMax)
          return meetingFailure('meetings-full');
        const field = <T,>(value: T) => ({ value, updatedAt: ctx.now });
        const restored = before?.deletedAt != null;
        const meeting: Meeting = (restored ? { ...before, deletedAt: null } : before) ?? {
          id,
          title: field(state.doc.title),
          at: field(state.doc.at),
          mode: field(state.doc.mode),
          rank: field('max'),
          participants: field(state.doc.participants),
          candidates: field(state.doc.candidates),
          replies: field({}),
          decided: field(state.doc.decided),
          createdAt: ctx.now,
          deletedAt: null,
        };
        const stored = storeMeeting(lib, meeting);
        if (!stored.ok) return stored;
        const sync = restored
          ? { syncedDoc: null, docRev: null, seen: [], hostLikes: null, hostLikesAckRev: null }
          : {
              syncedDoc: current?.syncedDoc ?? null,
              docRev: current?.docRev ?? null,
              seen: current?.seen ?? [],
              seenNames: current?.seenNames,
              hostLikes: current?.hostLikes ?? null,
              hostLikesAckRev: current?.hostLikesAckRev ?? null,
              replyOrigins: current?.replyOrigins,
            };
        if (shouldAdoptRemoteDoc(meeting, state, sync)) adopted = true;
        const out = mergeOnline(stored.lib, id, state, ctx, sync);
        if (out.ok) {
          addedReplyOnly = out.addedReplyOnly;
          seenNames = out.seenNames;
          hostLikes = out.hostLikes;
          replyOrigins = out.replyOrigins;
        }
        return out;
      });
      if (!active) return;
      if (!result.ok) {
        setError({ message: '저장하지 못했어요. 다시 시도해 주세요', retry: true });
        return;
      }
      if (
        skipped ||
        outdated() ||
        JSON.stringify(readOnline(id)) !== JSON.stringify(mergedRecord)
      ) {
        forgetHostLink(id, token);
        void navigate(paths.meeting(id), { replace: true });
        return;
      }
      await updateOnline(id, (current) => {
        if (
          !active ||
          outdated(current) ||
          JSON.stringify(current) !== JSON.stringify(mergedRecord)
        )
          return current;
        const seen =
          current?.seen === undefined && addedReplyOnly.length === 0
            ? undefined
            : rememberReplyOnly(current?.seen ?? [], addedReplyOnly, [
                ...state.doc.participants.map((p) => p.id),
                ...state.replies.map((r) => r.participantId),
              ]);
        const record = {
          ...current,
          hostToken: token,
          lastRev: state.rev,
          ...(replyOrigins === undefined ? {} : { replyOrigins }),
          hostLikes: [
            ...(hostLikes ??
              (state.rev < (current?.hostLikesAckRev ?? 0)
                ? (current?.hostLikes ?? [])
                : undefined) ??
              state.replies.find((reply) => reply.participantId === state.doc.participants[0]!.id)
                ?.likes ??
              []),
          ],
          ...(seen === undefined
            ? {}
            : {
                seen,
                seenNames: Object.fromEntries(
                  seen
                    .filter((id) => seenNames[id] !== undefined)
                    .map((id) => [id, seenNames[id]!]),
                ),
              }),
          ...(!adopted || state.docRev < (current?.docRev ?? 0)
            ? {}
            : { docRev: state.docRev, syncedDoc: state.doc }),
        };
        delete record.ended;
        return record;
      });
      if (!active) return;
      forgetHostLink(id, token);
      void navigate(paths.meeting(id), { replace: true });
    })();
    return () => {
      active = false;
    };
  }, [id, token, navigate, search, attempt]);
  return error ? (
    <LinkError
      message={error.message}
      onRetry={
        error.retry
          ? () => {
              setError(null);
              setAttempt((count) => count + 1);
            }
          : undefined
      }
    />
  ) : (
    <Box role="status" sx={{ p: 3 }}>
      주최자 약속을 담는 중이에요
    </Box>
  );
}

export function MeetLinkPage() {
  const { id } = useParams();
  const { hash } = useLocation();
  useDocumentTitle('약속 링크');
  if (id === undefined) return <LegacyMeetLinkPage />;
  if (!safeParse(MeetingId, id).success) return <LinkError />;
  if (hash.startsWith('#h=')) {
    let token: string;
    try {
      token = decodeURIComponent(hash.slice(3));
    } catch {
      return <LinkError />;
    }
    return <HostLink key={`${id}:${token}`} id={id} token={token} />;
  }
  const token = readHostLinks()[id];
  if (token) return <HostLink key={`${id}:${token}`} id={id} token={token} />;
  return <OnlineInviteView key={id} id={id} />;
}
