import { importCollabTrip } from 'src/domain/trip-collab/apply';
import { planFromDoc } from 'src/domain/trip-collab/plan';
import { tripCollabStore } from 'src/services/trip-collab/store';
import { OWNER_LABEL } from 'src/domain/trip-collab/constants';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useStore } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  buildLiveTripDoc,
  ESTIMATE_ONLY,
  liveEditKey,
  livePlanKey,
} from 'src/domain/trip-live/build-live-doc';
import { importLiveTrip } from 'src/domain/trip-live/import-live';
import { LIVE_ID_PATTERN, readOwnerHash } from 'src/domain/trip-live/live-doc';
import { paths } from 'src/routes/paths';
import { periodLabel } from 'src/sections/trips/trip-dates';
import { tripLiveApi, type LiveState } from 'src/services/trip-live/client';
import { tripLiveStore } from 'src/services/trip-live/store';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';
import { LIVE_IMPORT_HINT } from './texts';
const REVOKED = '이 관리 링크는 더 쓸 수 없어요. 다른 기기에서 다시 만들었거나 지웠어요';
const UNAVAILABLE = '지금은 열 수 없어요. 잠시 뒤 다시 열어 주세요';
export function TripLiveLinkPage() {
  const { id = '' } = useParams(),
    navigate = useNavigate(),
    store = useStore(),
    { run } = useLibraryAction();
  const [state, setState] = useState<LiveState | null>(null),
    [message, setMessage] = useState(''),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false);
  const secret = useRef<{ id: string; token: string | null } | null>(null);
  useEffect(() => {
    if (secret.current?.id !== id) secret.current = { id, token: readOwnerHash(location.hash) };
    if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
    const token = secret.current.token;
    let stale = false;
    void Promise.resolve().then(async () => {
      if (stale) return;
      if (!LIVE_ID_PATTERN.test(id)) {
        setMessage('링크를 읽지 못했어요');
        return;
      }
      const existing = tripLiveStore.byLiveId(id),
        lib = store.get(libraryAtom);
      if (
        existing &&
        existing.status === 'live' &&
        (!token || existing.ownerToken === token) &&
        lib.trips[existing.tripId]?.deletedAt === null
      ) {
        navigate(paths.trip(existing.tripId), { replace: true });
        return;
      }
      if (!token) {
        setMessage('관리 링크가 아니에요. 보낸 사람에게 보기 링크를 받아 주세요');
        return;
      }
      setMessage('');
      setState(null);
      const result = await tripLiveApi.get(id, null, token);
      if (stale) return;
      if (!result.ok) {
        setMessage(
          result.error === 'unauthorized'
            ? REVOKED
            : result.error === 'ended' || result.error === 'not-found'
              ? '공유가 끝난 일정이에요'
              : UNAVAILABLE,
        );
        return;
      }
      if (
        result.value === 'unchanged' ||
        result.value.role !== 'owner' ||
        !result.value.viewToken ||
        !result.value.sourceTripId
      ) {
        setMessage(REVOKED);
        return;
      }
      setState(result.value);
    });
    return () => {
      stale = true;
    };
  }, [id, retry, navigate, store]);
  async function adopt() {
    const token = secret.current?.token;
    if (!state || !token || busy) return;
    setBusy(true);
    try {
      const linked: { value: Extract<ReturnType<typeof importCollabTrip>, { ok: true }> | null } = {
        value: null,
      };
      const imported = await run((lib, ctx) => {
        if (state.doc.v === 2) {
          const r = importCollabTrip(lib, state.doc, ctx);
          if (!r.ok) return r;
          linked.value = r;
          return { ok: true, lib: r.lib, createdId: r.tripId };
        }
        return importLiveTrip(lib, state.doc, { preferredTripId: state.sourceTripId! }, ctx);
      });
      if (!imported.ok || !imported.createdId) {
        toast.error('여행을 담지 못했어요. 다시 해 주세요');
        return;
      }
      const tripId = imported.createdId,
        options = { title: state.doc.share.title, ...state.doc.options },
        dayIds = [...state.doc.ids.days],
        createdAt = state.doc.share.createdAt;
      const doc = buildLiveTripDoc(store.get(libraryAtom), tripId, ESTIMATE_ONLY, {
        title: options.title,
        options,
        dayIds,
        createdAt,
      });
      if (!doc) {
        toast.error('여행을 담지 못했어요. 다시 해 주세요');
        return;
      }
      const [publishedKey, planKey] = await Promise.all([liveEditKey(doc), livePlanKey(doc)]);
      const previous = tripLiveStore.byLiveId(id);
      if (previous && previous.tripId !== tripId) tripLiveStore.remove(previous.tripId);
      tripLiveStore.put({
        tripId,
        liveId: id,
        status: 'live',
        ownerToken: token,
        viewToken: state.viewToken!,
        rev: state.rev,
        dayIds,
        options,
        createdAt,
        publishedKey,
        planKey,
        publishedAt: state.updatedAt,
        expiresAt: state.expiresAt,
      });
      if (linked.value) {
        tripCollabStore.put({
          tripId,
          liveId: id,
          role: 'owner',
          token: null,
          deviceId: null,
          label: OWNER_LABEL,
          status: 'live',
          rev: state.rev,
          prev: 0,
          dayIds: linked.value.dayIds,
          placeMap: linked.value.placeMap,
          syncedAt: new Date().toISOString(),
          title: state.doc.share.title,
          pendingProgress: [],
        });
        tripCollabStore.writeBase(id, {
          rev: state.rev,
          plan: planFromDoc(state.doc),
          progress: null,
        });
      }
      toast('이 기기에서 갱신 링크를 관리해요');
      navigate(paths.trip(tripId), { replace: true });
    } catch {
      toast.error('여행을 담지 못했어요. 다시 해 주세요');
    } finally {
      setBusy(false);
    }
  }
  const trip = state?.doc.share.trips[0];
  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {state && trip ? (
        <>
          <Typography component="h1" variant="h5">
            {state.doc.share.title}
          </Typography>
          <Typography>{periodLabel(trip.startDate, trip.endDate)}</Typography>
          <Typography>{`일정 ${trip.days.reduce((n, d) => n + d.stops.length, 0)}곳`}</Typography>
          <Typography>{LIVE_IMPORT_HINT}</Typography>
          <Button disabled={busy} variant="contained" onClick={() => void adopt()}>
            이 기기에서 관리하기
          </Button>
          <Button component={Link} to={paths.trips}>
            취소
          </Button>
        </>
      ) : message ? (
        <>
          <Typography role="alert">{message}</Typography>
          {message === UNAVAILABLE && (
            <Button onClick={() => setRetry((n) => n + 1)}>다시 시도</Button>
          )}
          <Button component={Link} to={paths.trips}>
            여행 목록
          </Button>
        </>
      ) : (
        <Typography role="status">갱신되는 일정을 불러오는 중이에요</Typography>
      )}
    </Box>
  );
}
