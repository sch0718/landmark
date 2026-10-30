import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useStore } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { importCollabTrip } from 'src/domain/trip-collab/apply';
import { normalizeDeviceLabel, readInviteHash } from 'src/domain/trip-collab/constants';
import { planFromDoc } from 'src/domain/trip-collab/plan';
import { LIVE_ID_PATTERN } from 'src/domain/trip-live/live-doc';
import { paths } from 'src/routes/paths';
import { periodLabel } from 'src/sections/trips/trip-dates';
import { tripCollabApi, type TripCollabError } from 'src/services/trip-collab/client';
import { tripCollabStore } from 'src/services/trip-collab/store';
import { newLiveToken } from 'src/services/trip-live/tokens';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';
const OFFLINE = '인터넷 연결을 확인하고 다시 해 주세요';
const INVALID = '초대 링크를 읽지 못했어요. 보낸 사람에게 다시 받아 주세요';
const errorText = (e: TripCollabError) =>
  e === 'invite' || e === 'unauthorized'
    ? '이미 쓴 초대이거나 닫힌 초대예요. 보낸 사람에게 새 초대 링크를 받아 주세요'
    : e === 'ended' || e === 'not-found'
      ? '공유가 끝난 여행이에요'
      : e === 'full'
        ? '함께 고칠 수 있는 기기 수(20대)를 넘었어요'
        : e === 'switched-off'
          ? '지금은 함께 편집을 시작할 수 없어요. 잠시 뒤 다시 해 주세요'
          : OFFLINE;
type Preview = { title: string; startDate: string; endDate: string; expiresAt: string };
export function TripCollabJoinPage() {
  const { id = '' } = useParams();
  return <JoinPage key={id} id={id} />;
}
function JoinPage({ id }: { id: string }) {
  const store = useStore(),
    { run } = useLibraryAction(),
    navigate = useNavigate(),
    coarse = useMediaQuery('(pointer: coarse)');
  const token = useRef<{ value: string | null } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null),
    [message, setMessage] = useState(''),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false),
    [label, setLabel] = useState(coarse ? '내 휴대폰' : '내 컴퓨터'),
    [labelError, setLabelError] = useState(false),
    [deviceToken, setDeviceToken] = useState<string | null>(null);
  useEffect(() => {
    if (!token.current) token.current = { value: readInviteHash(location.hash) };
    if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
    let stale = false;
    void Promise.resolve().then(async () => {
      if (stale) return;
      if (!LIVE_ID_PATTERN.test(id)) {
        setMessage(INVALID);
        return;
      }
      const existing = tripCollabStore.byLiveId(id);
      if (existing && store.get(libraryAtom).trips[existing.tripId]?.deletedAt === null) {
        navigate(paths.trip(existing.tripId), { replace: true });
        return;
      }
      const invitation = token.current?.value;
      if (!invitation) {
        setMessage(INVALID);
        return;
      }
      setMessage('');
      setPreview(null);
      const r = await tripCollabApi.previewInvite(id, invitation);
      if (stale) return;
      if (!r.ok) setMessage(errorText(r.error));
      else setPreview(r.value);
    });
    return () => {
      stale = true;
    };
  }, [id, retry, store, navigate]);
  async function accept() {
    const invitation = token.current?.value;
    if (!invitation || busy) return;
    const normalized = normalizeDeviceLabel(label);
    if (!normalized) {
      setLabelError(true);
      return;
    }
    const editing = deviceToken ?? newLiveToken();
    if (!deviceToken) setDeviceToken(editing);
    setBusy(true);
    setMessage('');
    try {
      const accepted = await tripCollabApi.accept(id, invitation, {
        deviceToken: editing,
        label: normalized,
      });
      if (!accepted.ok) {
        setMessage(errorText(accepted.error));
        return;
      }
      const state = await tripCollabApi.state(id, editing, { rev: null, prev: null });
      if (!state.ok) {
        setMessage(errorText(state.error));
        return;
      }
      if (state.value === 'unchanged' || !state.value.doc) {
        setMessage(OFFLINE);
        return;
      }
      const live = state.value,
        doc = state.value.doc;
      const imported: { value: Extract<ReturnType<typeof importCollabTrip>, { ok: true }> | null } =
        { value: null };
      const result = await run((lib, ctx) => {
        const r = importCollabTrip(lib, doc, ctx);
        if (!r.ok) return r;
        imported.value = r;
        return { ok: true, lib: r.lib, createdId: r.tripId };
      });
      if (!result.ok || !imported.value) {
        toast.error('여행을 담지 못했어요. 다시 해 주세요');
        return;
      }
      const trip = imported.value;
      tripCollabStore.put({
        tripId: trip.tripId,
        liveId: id,
        role: 'editor',
        token: editing,
        deviceId: accepted.value.deviceId,
        label: normalized,
        status: 'live',
        rev: live.rev,
        prev: live.progress?.prev ?? 0,
        dayIds: trip.dayIds,
        placeMap: trip.placeMap,
        syncedAt: new Date().toISOString(),
        title: doc.share.title,
        pendingProgress: [],
      });
      tripCollabStore.writeBase(id, {
        rev: live.rev,
        plan: planFromDoc(doc),
        progress: live.progress ?? null,
      });
      toast('함께 편집을 시작했어요');
      navigate(paths.trip(trip.tripId), { replace: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box
      sx={{
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        '& .MuiButton-root': { minHeight: 44 },
      }}
    >
      <Typography component="h1" variant="h5">
        함께 편집 초대
      </Typography>
      {preview ? (
        <>
          <Typography component="h2" variant="h6">
            {preview.title}
          </Typography>
          <Typography>{periodLabel(preview.startDate, preview.endDate)}</Typography>
          <Typography>
            수락하면 이 기기 보관함에 이 여행을 담고, 여기서 고친 내용과 다른 사람이 고친 내용을
            서로 맞춰요. 공동 여행은 Landmark 서버에 암호화하지 않고 저장돼요
          </Typography>
          <TextField
            label="이 기기 이름"
            value={label}
            error={labelError}
            helperText={labelError ? '1~30자로 입력하세요' : undefined}
            onChange={(e) => {
              setLabel(e.target.value);
              setLabelError(false);
            }}
            slotProps={{ htmlInput: { maxLength: 30 } }}
          />
          <Button disabled={busy} variant="contained" onClick={() => void accept()}>
            수락하고 함께 편집하기
          </Button>
          <Button disabled={busy} component={Link} to={paths.trips}>
            취소
          </Button>
        </>
      ) : (
        !message && <Typography role="status">초대를 확인하는 중이에요</Typography>
      )}
      {message && <Typography role="alert">{message}</Typography>}
      {!preview && message === OFFLINE && (
        <Button onClick={() => setRetry((n) => n + 1)}>다시 시도</Button>
      )}
      {!preview && message && (
        <Button component={Link} to={paths.trips}>
          여행 목록
        </Button>
      )}
    </Box>
  );
}
