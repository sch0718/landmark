import { CollabDialogHost } from '../collab/CollabDialogHost';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Effect } from 'effect';
import { useAtomValue } from 'jotai';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { HelpButton } from 'src/components/HelpButton';
import { injectShareDoc, shareFileName } from 'src/domain/share/inject';
import { formatShortExpiry } from 'src/domain/share/short-link';
import { buildLiveTripDoc, fitLiveDoc, liveEditKey } from 'src/domain/trip-live/build-live-doc';
import { importLiveTrip } from 'src/domain/trip-live/import-live';
import { alignDayIds, liveExpiresAt, liveLinks } from 'src/domain/trip-live/live-doc';
import { visibleCandidates } from 'src/domain/trips/query';
import { downloadText } from 'src/lib/download-text';
import { startEffect } from 'src/lib/effect/runtime';
import { paths } from 'src/routes/paths';
import { shareLink } from 'src/sections/meetings/share-link';
import {
  useKakao,
  kakaoUrlFits,
  sendAppKakao,
  KAKAO_SEND_FAILED,
} from 'src/sections/share-export/kakao';
import { legStatus, useTripLegs } from 'src/sections/share-export/use-trip-legs';
import { getTurnstileToken } from 'src/services/meet-online/turnstile-loader';
import { ShareTemplate } from 'src/services/share-template';
import { tripLiveApi, type TripLiveError } from 'src/services/trip-live/client';
import {
  tripLiveStore,
  useTripLiveRecord,
  type TripLiveRecord,
} from 'src/services/trip-live/store';
import { newLiveId, newLiveToken, newDayId } from 'src/services/trip-live/tokens';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';
import {
  LIVE_CREATE_ERRORS,
  LIVE_DISCONNECTED,
  LIVE_ENDED,
  LIVE_OWNER_WARNING,
  LIVE_STATE_TEXT,
} from './texts';
import { useTripLivePublish } from './use-trip-live-publish';
const loadTemplate = Effect.gen(function* () {
  return yield* (yield* ShareTemplate).load;
});
const createError = (error: TripLiveError) =>
  LIVE_CREATE_ERRORS[error as keyof typeof LIVE_CREATE_ERRORS] ?? LIVE_CREATE_ERRORS.failed;
export function TripLiveShareDialog({
  open,
  onClose,
  tripId,
}: {
  open: boolean;
  onClose(): void;
  tripId: string;
}) {
  const library = useAtomValue(libraryAtom),
    record = useTripLiveRecord(tripId),
    trip = library.trips[tripId];
  const publish = useTripLivePublish(tripId, open),
    legs = useTripLegs(tripId, open),
    kakao = useKakao(open);
  const { run } = useLibraryAction(),
    navigate = useNavigate(),
    heading = useId();
  const [title, setTitle] = useState(record?.options.title ?? trip?.title.value ?? ''),
    [includeMemo, setMemo] = useState(record?.options.includeMemo ?? false),
    [includeCandidates, setCandidates] = useState(record?.options.includeCandidates ?? true);
  const [collabOpen, setCollabOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [otherDevice, setOtherDevice] = useState(false),
    [collaborative, setCollaborative] = useState(false);
  const [confirm, setConfirm] = useState<{
    kind: 'view' | 'owner' | 'delete';
    token: string;
  } | null>(null);
  const candidateCount = trip ? visibleCandidates(library, trip).length : 0;
  const validTitle = title.trim().length > 0 && title.trim().length <= 60;
  const live = record?.status === 'live';
  const links = record ? liveLinks(location.origin, record.liveId, record) : null;
  function statusError(error: TripLiveError) {
    if (error === 'unauthorized') {
      tripLiveStore.update(tripId, { status: 'disconnected' });
      setMessage(LIVE_DISCONNECTED);
    } else if (error === 'ended' || error === 'not-found') {
      tripLiveStore.update(tripId, { status: 'ended' });
      setMessage(LIVE_ENDED);
    } else setMessage(createError(error));
  }
  useEffect(() => {
    if (!open) return;
    const current = tripLiveStore.get(tripId);
    if (current?.status !== 'live') return;
    let stale = false;
    void tripLiveApi.get(current.liveId, null, current.ownerToken).then((result) => {
      if (stale) return;
      if (!result.ok) {
        if (result.error === 'unauthorized')
          tripLiveStore.update(tripId, { status: 'disconnected' });
        if (result.error === 'ended' || result.error === 'not-found')
          tripLiveStore.update(tripId, { status: 'ended' });
        return;
      }
      if (result.value === 'unchanged') return;
      const state = result.value;
      setCollaborative(state.doc.v === 2);
      if (state.viewToken && state.viewToken !== current.viewToken)
        tripLiveStore.update(tripId, { viewToken: state.viewToken });
      setOtherDevice(state.rev > current.rev);
    });
    return () => {
      stale = true;
    };
  }, [open, tripId]);
  const options = { title: title.trim(), includeMemo, includeCandidates };
  function changeOptions(next: typeof options) {
    if (live && next.title.length > 0 && next.title.length <= 60)
      tripLiveStore.update(tripId, { options: next });
  }
  function pendingRecord(): TripLiveRecord {
    return {
      tripId,
      liveId: newLiveId(),
      status: 'pending',
      ownerToken: newLiveToken(),
      viewToken: newLiveToken(),
      rev: 0,
      dayIds: alignDayIds([], trip?.days.length ?? 0, newDayId),
      options,
      createdAt: new Date().toISOString(),
    };
  }
  async function create() {
    if (busy || !trip || !validTitle) return;
    setBusy(true);
    setMessage('');
    let current = tripLiveStore.get(tripId);
    let uncertain = current?.status === 'pending';
    if (current?.status !== 'pending') {
      current = pendingRecord();
      tripLiveStore.put(current);
    }
    try {
      const turnstile = await getTurnstileToken();
      for (let attempt = 0; attempt < 2; attempt++) {
        const dayIds = alignDayIds(current.dayIds, trip.days.length, newDayId);
        current = { ...current, options, dayIds };
        tripLiveStore.put(current);
        const built = buildLiveTripDoc(library, tripId, legs.routeOf, {
          title: options.title,
          options,
          dayIds,
          createdAt: current.createdAt,
        });
        if (!built) {
          if (!uncertain) tripLiveStore.remove(tripId);
          setMessage('일정에 넣은 장소가 없어요');
          return;
        }
        const doc = fitLiveDoc(built);
        if (!doc) {
          if (!uncertain) tripLiveStore.remove(tripId);
          setMessage(LIVE_CREATE_ERRORS['too-big']);
          return;
        }
        const result = await tripLiveApi.create({
          id: current.liveId,
          sourceTripId: tripId,
          ownerToken: current.ownerToken,
          viewToken: current.viewToken,
          doc,
          turnstile,
        });
        if (result.ok) {
          let publishedDoc = doc,
            rev = result.value.rev,
            expiresAt = result.value.expiresAt,
            viewToken = current.viewToken;
          // 재시도는 서버의 처음 문서를 유지하므로 실제 공개본의 지문을 기준으로 삼는다.
          if (!result.value.created) {
            uncertain = true;
            const saved = await tripLiveApi.get(current.liveId, null, current.ownerToken);
            if (!saved.ok) {
              setMessage(createError(saved.error));
              return;
            }
            if (saved.value === 'unchanged' || saved.value.role !== 'owner') {
              setMessage(LIVE_CREATE_ERRORS.failed);
              return;
            }
            publishedDoc = saved.value.doc;
            rev = saved.value.rev;
            expiresAt = saved.value.expiresAt;
            viewToken = saved.value.viewToken!;
          }
          tripLiveStore.put({
            ...current,
            status: 'live',
            rev,
            expiresAt,
            viewToken,
            publishedAt: new Date().toISOString(),
            publishedKey: await liveEditKey(publishedDoc),
          });
          return;
        }
        if (result.error === 'taken' && attempt === 0) {
          current = pendingRecord();
          uncertain = false;
          tripLiveStore.put(current);
          continue;
        }
        if (!uncertain && result.error !== 'offline' && result.error !== 'unavailable')
          tripLiveStore.remove(tripId);
        setMessage(createError(result.error));
        return;
      }
    } catch {
      if (!uncertain) tripLiveStore.remove(tripId);
      setMessage(LIVE_CREATE_ERRORS.turnstile);
    } finally {
      setBusy(false);
    }
  }
  async function manage() {
    if (!record || !confirm || busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (confirm.kind === 'delete') {
        const result = await tripLiveApi.remove(record.liveId, record.ownerToken);
        if (result.ok) {
          tripLiveStore.remove(tripId);
          setConfirm(null);
          toast('갱신 링크를 지웠어요');
        } else setMessage(createError(result.error));
      } else {
        const result = await tripLiveApi.rotate(
          record.liveId,
          confirm.kind === 'view' ? { view: confirm.token } : { owner: confirm.token },
          record.ownerToken,
        );
        if (result.ok) {
          tripLiveStore.update(
            tripId,
            confirm.kind === 'view' ? { viewToken: confirm.token } : { ownerToken: confirm.token },
          );
          if (confirm.kind === 'view') toast('새 보기 링크를 만들었어요');
          setConfirm(null);
        } else statusError(result.error);
      }
    } finally {
      setBusy(false);
    }
  }
  async function publicDoc(mode: 'save' | 'import') {
    if (!record || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await tripLiveApi.get(record.liveId, null, record.ownerToken);
      if (!result.ok) {
        statusError(result.error);
        return;
      }
      if (result.value === 'unchanged') return;
      const doc = result.value.doc;
      if (mode === 'save') {
        const template = await startEffect(loadTemplate);
        downloadText(
          injectShareDoc(template, doc.share),
          shareFileName(doc.share.title, new Date()),
          'text/html',
        );
      } else {
        const imported = await run((lib, ctx) =>
          importLiveTrip(lib, doc, { preferredTripId: null }, ctx),
        );
        if (imported.ok && imported.createdId) navigate(paths.trip(imported.createdId));
        else toast.error('여행을 담지 못했어요. 다시 해 주세요');
      }
    } catch {
      setMessage('파일을 만들지 못했어요. 잠시 뒤 다시 해 주세요');
    } finally {
      setBusy(false);
    }
  }
  const expires = record?.expiresAt
    ? new Date(record.expiresAt)
    : liveExpiresAt(trip?.endDate.value ?? '', new Date());
  const expiry = formatShortExpiry(expires, new Date()),
    routeStatus = legStatus(legs);
  const canMake = !record || record.status === 'pending';
  const confirmTitle =
    confirm?.kind === 'delete'
      ? '서버에서 지우기'
      : confirm?.kind === 'view'
        ? '보기 링크 다시 만들기'
        : '소유자 링크 다시 만들기';
  return (
    <>
      <CollabDialogHost open={collabOpen} onClose={() => setCollabOpen(false)} tripId={tripId} />
      <Dialog open={open} onClose={onClose} aria-labelledby={heading} fullWidth maxWidth="sm">
        <DialogTitle id={heading}>
          갱신 링크 <HelpButton page="share" />
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {(canMake || live) && (
            <>
              {collaborative ? (
                <Typography>함께 편집 중에는 여행 이름을 따라요</Typography>
              ) : (
                <TextField
                  label="제목"
                  value={title}
                  slotProps={{ htmlInput: { maxLength: 60 } }}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    changeOptions({ ...options, title: e.target.value.trim() });
                  }}
                />
              )}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={includeMemo}
                    onChange={(e) => {
                      setMemo(e.target.checked);
                      changeOptions({ ...options, includeMemo: e.target.checked });
                    }}
                  />
                }
                label="메모 포함"
              />
              {candidateCount > 0 && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={includeCandidates}
                      onChange={(e) => {
                        setCandidates(e.target.checked);
                        changeOptions({ ...options, includeCandidates: e.target.checked });
                      }}
                    />
                  }
                  label={`후보 ${candidateCount}곳도 넣기`}
                />
              )}
              {includeMemo && (
                <Typography variant="body2">
                  링크를 받은 사람은 누구나 메모를 볼 수 있어요
                </Typography>
              )}
            </>
          )}
          {canMake && (
            <>
              <Typography variant="body2">{`갱신 링크를 만들면 이 일정의 사본을 Landmark 서버에 ${expiry}까지 둬요. 서버에는 암호화하지 않고 저장해요. 링크를 받은 사람은 누구나 볼 수 있어요`}</Typography>
              {routeStatus && <Typography role="status">{routeStatus}</Typography>}
              <Button disabled={busy || !validTitle || !trip} onClick={() => void create()}>
                갱신 링크 만들기
              </Button>
            </>
          )}
          {live && links && (
            <>
              <Typography variant="body2">{`마지막 반영 ${record.publishedAt ? new Date(record.publishedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '확인 중'} · ${expiry}까지 보관`}</Typography>
              {LIVE_STATE_TEXT[publish.state] && (
                <Typography role="status">{LIVE_STATE_TEXT[publish.state]}</Typography>
              )}
              {otherDevice && <Typography>다른 기기에서 마지막으로 반영했어요</Typography>}
              <TextField
                label="보기 링크"
                value={links.view}
                slotProps={{ input: { readOnly: true } }}
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Button
                  onClick={() =>
                    void navigator.clipboard.writeText(links.view).then(
                      () => toast('링크를 복사했어요'),
                      () => toast.error('링크를 복사하지 못했어요'),
                    )
                  }
                >
                  링크 복사
                </Button>
                {typeof navigator.share === 'function' && (
                  <Button onClick={() => void shareLink(links.view, title)}>링크 공유</Button>
                )}
                {kakao.enabled && kakaoUrlFits(links.view) && (
                  <Button
                    disabled={!kakao.ready}
                    onClick={() => {
                      if (
                        !sendAppKakao({
                          title,
                          url: links.view,
                          description: '갱신되는 여행 일정 · 랜드마크',
                          buttonTitle: '일정 보기',
                        })
                      )
                        toast.error(KAKAO_SEND_FAILED);
                    }}
                  >
                    카카오톡
                  </Button>
                )}
              </Box>
              <Typography variant="body2">{LIVE_OWNER_WARNING}</Typography>
              <Typography>
                보기 링크는 누구나 볼 수만 있고, 편집 초대 링크는 받은 한 사람이 함께 고칠 수 있어요
              </Typography>
              <Button onClick={() => setCollabOpen(true)}>함께 편집…</Button>
              <Button onClick={() => void shareLink(links.owner!, title)}>
                다른 기기에서 관리
              </Button>
              <Button
                disabled={busy}
                onClick={() => setConfirm({ kind: 'view', token: newLiveToken() })}
              >
                보기 링크 다시 만들기
              </Button>
              <Button
                disabled={busy}
                onClick={() => setConfirm({ kind: 'owner', token: newLiveToken() })}
              >
                소유자 링크 다시 만들기
              </Button>
              <Button disabled={busy} onClick={() => void publicDoc('save')}>
                공개본 파일 저장
              </Button>
              <Button
                color="error"
                disabled={busy}
                onClick={() => setConfirm({ kind: 'delete', token: '' })}
              >
                서버에서 지우기
              </Button>
              {record.paused && (
                <>
                  <Button onClick={publish.resume}>다시 반영하기</Button>
                  <Button disabled={busy} onClick={() => void publicDoc('import')}>
                    공개본을 새 여행으로 가져오기
                  </Button>
                </>
              )}
            </>
          )}
          {record?.status === 'disconnected' && (
            <>
              <Typography>{LIVE_DISCONNECTED}</Typography>
              <Button onClick={() => tripLiveStore.remove(tripId)}>기록 지우기</Button>
            </>
          )}
          {record?.status === 'ended' && (
            <>
              <Typography>{LIVE_ENDED}</Typography>
              <Button
                onClick={() => {
                  tripLiveStore.remove(tripId);
                  setMessage('');
                }}
              >
                새 갱신 링크 만들기
              </Button>
            </>
          )}
          {message && <Typography role="alert">{message}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>닫기</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={open && confirm !== null}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        aria-labelledby={`${heading}-confirm`}
      >
        <DialogTitle id={`${heading}-confirm`}>{confirmTitle}</DialogTitle>
        <DialogContent>
          <Typography>
            {confirm?.kind === 'view'
              ? '지금 링크를 받은 사람은 더 볼 수 없어요'
              : confirm?.kind === 'owner'
                ? '다른 기기의 관리 연결이 끊겨요'
                : '서버 사본을 지우면 받은 사람도 더는 볼 수 없어요. 보관함의 여행은 그대로예요'}
          </Typography>
          {message && <Typography role="alert">{message}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirm(null)}>
            취소
          </Button>
          <Button disabled={busy} onClick={() => void manage()}>
            {confirm?.kind === 'delete' ? '지우기' : '다시 만들기'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
