import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { HelpButton } from 'src/components/HelpButton';
import { collabInviteLink, normalizeInviteLabel } from 'src/domain/trip-collab/constants';
import { importLiveTrip } from 'src/domain/trip-live/import-live';
import { paths } from 'src/routes/paths';
import { shareLink } from 'src/sections/meetings/share-link';
import { kakaoUrlFits, sendAppKakao, useKakao } from 'src/sections/share-export/kakao';
import {
  tripCollabApi,
  type CollabDevice,
  type CollabInvite,
  type TripCollabError,
} from 'src/services/trip-collab/client';
import { tripCollabStore } from 'src/services/trip-collab/store';
import { useTripLiveRecord } from 'src/services/trip-live/store';
import { newLiveToken } from 'src/services/trip-live/tokens';
import { useLibraryAction } from 'src/stores/library-state';
import { LIVE_EMPTY, LIVE_TOO_BIG } from '../live/texts';
import { enableCollabAsOwner } from './owner-join';
import { useCollabDeps, useTripCollab } from './use-trip-collab';
const NOTICE =
  '편집 초대 링크를 받은 사람이 수락하면 그 기기에서 이 여행을 함께 고칠 수 있어요. 초대 링크는 한 번만 쓸 수 있고 7일 뒤 닫혀요. 보기 링크와 달리 일정을 바꿀 수 있으니 함께 갈 사람에게만 보내세요';
const errorText = (e: TripCollabError) =>
  e === 'offline' || e === 'unavailable'
    ? '인터넷 연결을 확인해 주세요'
    : e === 'switched-off'
      ? '지금은 편집 초대를 만들 수 없어요'
      : e === 'rate-limited'
        ? '오늘은 더 만들 수 없어요'
        : e === 'full'
          ? '기다리는 초대가 많아요. 쓰지 않는 초대를 취소해 주세요'
          : '편집 초대를 만들지 못했어요. 잠시 뒤 다시 해 주세요';
const expiry = (at: string) => {
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일까지`;
};
const seen = (at: string) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  const n = Math.max(0, Math.round((today.getTime() - day.getTime()) / 86_400_000));
  return n === 0 ? '오늘' : n === 1 ? '어제' : `${n}일 전`;
};
export function TripCollabDialog({
  open,
  onClose,
  tripId,
  onOpenLiveShare,
  onCompare,
}: {
  open: boolean;
  onClose(): void;
  tripId: string;
  onOpenLiveShare?(): void;
  onCompare(): void;
}) {
  const view = useTripCollab(tripId, open),
    live = useTripLiveRecord(tripId),
    deps = useCollabDeps(tripId, false),
    { run } = useLibraryAction(),
    navigate = useNavigate(),
    heading = useId(),
    kakao = useKakao(open);
  const owner = live?.status === 'live' && view.record?.role !== 'editor',
    editor = view.record?.role === 'editor';
  const [label, setLabel] = useState(''),
    [link, setLink] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [devices, setDevices] = useState<CollabDevice[]>([]),
    [invites, setInvites] = useState<CollabInvite[]>([]),
    [confirm, setConfirm] = useState<CollabDevice | 'leave' | null>(null);
  const pendingToken = useRef<string | null>(null);
  async function refresh() {
    if (!owner || !live) return;
    const r = await tripCollabApi.members(live.liveId, live.ownerToken);
    if (r.ok) {
      setDevices(r.value.devices);
      setInvites(r.value.invites);
    }
  }
  useEffect(() => {
    if (!open || !owner || !live) return;
    let stale = false;
    void tripCollabApi.members(live.liveId, live.ownerToken).then((r) => {
      if (!stale && r.ok) {
        setDevices(r.value.devices);
        setInvites(r.value.invites);
      }
    });
    return () => {
      stale = true;
    };
  }, [open, owner, live]);
  async function create() {
    if (!live || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const enabled = await enableCollabAsOwner(deps);
      if (!enabled.ok) {
        if (enabled.error === 'conflict') onCompare();
        setMessage(
          enabled.error === 'conflict'
            ? '공동 여행과 겹친 변경을 비교한 뒤 초대를 만들어 주세요'
            : enabled.error === 'too-big'
              ? LIVE_TOO_BIG
              : enabled.error === 'empty'
                ? LIVE_EMPTY
                : errorText(enabled.error),
        );
        return;
      }
      if (!pendingToken.current) pendingToken.current = newLiveToken();
      const token = pendingToken.current,
        r = await tripCollabApi.createInvite(live.liveId, live.ownerToken, {
          token,
          label: normalizeInviteLabel(label),
        });
      if (!r.ok) {
        setMessage(errorText(r.error));
        return;
      }
      setLink(collabInviteLink(location.origin, live.liveId, token));
      pendingToken.current = null;
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function manage() {
    if (!confirm || busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (confirm === 'leave') {
        const record = view.record;
        if (!record?.token) return;
        const r = await tripCollabApi.removeMember(record.liveId, record.token, 'me');
        if (!r.ok) {
          setConfirm(null);
          setMessage('인터넷 연결을 확인하고 다시 해 주세요');
          return;
        }
        tripCollabStore.remove(tripId);
        toast('함께 편집을 그만뒀어요');
        setConfirm(null);
        onClose();
      } else if (live) {
        const r = await tripCollabApi.removeMember(live.liveId, live.ownerToken, confirm.deviceId);
        if (!r.ok) {
          setConfirm(null);
          setMessage(errorText(r.error));
          return;
        }
        setConfirm(null);
        toast('편집 권한을 거뒀어요');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  async function cancel(key: string) {
    if (!live) return;
    const r = await tripCollabApi.cancelInvite(live.liveId, live.ownerToken, key);
    if (r.ok) await refresh();
    else setMessage(errorText(r.error));
  }
  async function copy() {
    const record = view.record,
      liveId = record?.liveId ?? live?.liveId,
      token = record?.role === 'editor' ? record.token : live?.ownerToken;
    if (!liveId || !token || busy) return;
    setBusy(true);
    try {
      const r = await tripCollabApi.state(liveId, token, { rev: null, prev: null });
      if (!r.ok || r.value === 'unchanged' || !r.value.doc) {
        setMessage('공동 여행을 저장하지 못했어요. 인터넷 연결을 확인해 주세요');
        return;
      }
      const doc = r.value.doc,
        result = await run((lib, ctx) => importLiveTrip(lib, doc, { preferredTripId: null }, ctx));
      if (!result.ok || !result.createdId) {
        toast.error('여행을 담지 못했어요. 다시 해 주세요');
        return;
      }
      const createdId = result.createdId;
      toast('공동 여행을 새 여행으로 저장했어요', {
        action: { label: '열기', onClick: () => void navigate(paths.trip(createdId)) },
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dialog
        sx={{ '& .MuiButton-root': { minHeight: 44 } }}
        open={open}
        onClose={onClose}
        aria-labelledby={heading}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle id={heading}>
          함께 편집 <HelpButton page="trips" />
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {!owner && !editor ? (
            <>
              <Typography>함께 편집하려면 먼저 갱신 링크를 만들어야 해요</Typography>
              {onOpenLiveShare && <Button onClick={onOpenLiveShare}>갱신 링크 만들기…</Button>}
            </>
          ) : owner ? (
            <>
              <Typography>{NOTICE}</Typography>
              <Typography>공동 여행은 서버에 암호화하지 않고 저장해요</Typography>
              <TextField
                label="누구에게 보내나요? (선택)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 30 } }}
              />
              <Button disabled={busy} variant="contained" onClick={() => void create()}>
                편집 초대 링크 만들기
              </Button>
              {link && (
                <>
                  <TextField
                    label="편집 초대 링크"
                    value={link}
                    slotProps={{ input: { readOnly: true } }}
                  />
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(link)
                          .then(() => toast('링크를 복사했어요'))
                          .catch(() => toast.error('링크를 복사하지 못했어요'));
                      }}
                    >
                      링크 복사
                    </Button>
                    {typeof navigator.share === 'function' && (
                      <Button
                        onClick={() =>
                          void shareLink(link, view.record?.title ?? live?.options.title ?? '여행')
                        }
                      >
                        링크 공유
                      </Button>
                    )}
                    {kakao.enabled && kakaoUrlFits(link) && (
                      <Button
                        onClick={() =>
                          sendAppKakao({
                            title: view.record?.title ?? '여행',
                            url: link,
                            description: '함께 고치는 여행 일정 · 랜드마크',
                            buttonTitle: '함께 편집하기',
                          })
                        }
                      >
                        카카오톡
                      </Button>
                    )}
                  </Box>
                  <Typography>
                    이 링크는 한 사람(기기 하나)만 쓸 수 있어요. 여러 명이면 사람마다 새로 만드세요
                  </Typography>
                </>
              )}
              <Typography component="h3">함께 고치는 기기</Typography>
              {!devices.length && <Typography>아직 함께 고치는 기기가 없어요</Typography>}
              {devices.map((d) => (
                <Box key={d.deviceId}>
                  <Typography>
                    {d.label} · {seen(d.seenAt)}
                  </Typography>
                  <Button onClick={() => setConfirm(d)}>편집 권한 거두기</Button>
                </Box>
              ))}
              <Typography component="h3">기다리는 초대</Typography>
              {!invites.length && <Typography>기다리는 초대가 없어요</Typography>}
              {invites.map((i) => (
                <Box key={i.key}>
                  <Typography>
                    {i.label ?? '이름 없는 초대'} · {expiry(i.expiresAt)}
                  </Typography>
                  <Button onClick={() => void cancel(i.key)}>초대 취소</Button>
                </Box>
              ))}
            </>
          ) : (
            <>
              <Typography>함께 편집 중이에요</Typography>
              <Typography>이 기기 이름 {view.record?.label}</Typography>
              <Typography>함께 고치는 기기 {view.members}대</Typography>
            </>
          )}
          {(owner || editor) && (
            <Button disabled={busy} onClick={() => void copy()}>
              내 여행으로 따로 저장
            </Button>
          )}
          {editor && (
            <Button disabled={busy} onClick={() => setConfirm('leave')}>
              편집 그만두기
            </Button>
          )}
          {message && <Typography role="alert">{message}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ minHeight: 44 }}>
            닫기
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        sx={{ '& .MuiButton-root': { minHeight: 44 } }}
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        aria-labelledby={`${heading}-confirm`}
      >
        <DialogTitle id={`${heading}-confirm`}>
          {confirm === 'leave'
            ? '이 기기에서 함께 편집을 그만둘까요?'
            : confirm
              ? `‘${confirm.label}’ 기기의 편집 권한을 거둘까요?`
              : ''}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {confirm === 'leave'
              ? '이 여행은 이 기기 보관함에 그대로 남지만 더 이상 다른 사람의 변경을 받지 않아요. 다시 참여하려면 새 초대 링크가 필요해요'
              : '그 기기는 더 이상 이 여행을 고치거나 새 내용을 받을 수 없어요. 그 기기 보관함에 담긴 여행은 그대로 남아요'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>취소</Button>
          <Button disabled={busy} onClick={() => void manage()}>
            {confirm === 'leave' ? '그만두기' : '거두기'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
