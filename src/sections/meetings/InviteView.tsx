import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import { useAtomValue } from 'jotai';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { MapView } from 'src/components/map/MapView';
import { replyFromDraft, type InviteDoc } from 'src/domain/meeting/link';
import { paths } from 'src/routes/paths';
import type { Origin, Participant } from 'src/schema/meeting';
import { libraryAtom } from 'src/stores/library-state';
import { OriginPicker } from './OriginPicker';
import { TimeCells } from './TimeCells';
import { loadMeetDraft, saveMeetDraft } from './meet-drafts';
import { shareMeetingDoc } from './share-link';
import { useMeetingCompute } from './use-meeting-compute';

type Form = { identity: string; name: string; origin?: Origin | null; likes: string[] };
const fresh = (): Form => ({ identity: '', name: '', likes: [] });
const MODE_LABEL = { transit: '대중교통', car: '자동차', straight: '직선거리' };
function restore(doc: InviteDoc): Form {
  const draft = loadMeetDraft(doc.meetingId);
  if (draft === null) return fresh();
  if (
    draft.participantId !== undefined &&
    !doc.participants.some((p) => p.id === draft.participantId)
  )
    return fresh();
  const candidates = new Set(doc.candidates.map((c) => c.id));
  return {
    identity: draft.participantId ?? 'new',
    name: draft.newName ?? '',
    likes: draft.likes.filter((cid) => candidates.has(cid)),
    ...(draft.origin === undefined ? {} : { origin: draft.origin }),
  };
}

/** 친구의 답장은 초안 저장소에만 쓰고 보관함 문서는 읽기만 한다. */
export function InviteView({ doc }: { doc: InviteDoc }) {
  const library = useAtomValue(libraryAtom);
  const id = useId();
  const [form, setForm] = useState<Form>(() => restore(doc));
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const newName = form.name.trim();
  const valid =
    form.identity !== '' &&
    (form.identity !== 'new' || (newName.length > 0 && newName.length <= 20));
  const selected = doc.participants.find((p) => p.id === form.identity);
  const origin = form.origin === undefined ? (selected?.origin ?? null) : form.origin;
  const mine: Participant | null =
    form.identity === ''
      ? null
      : {
          id: selected?.id ?? 'new-participant',
          name: selected?.name ?? newName,
          origin,
        };
  const originChanged =
    form.origin !== undefined &&
    JSON.stringify(form.origin) !== JSON.stringify(selected?.origin ?? null);
  const changed = originChanged && mine !== null ? [mine] : [];
  const compute = useMeetingCompute({
    participants: changed,
    targets: doc.candidates,
    mode: doc.mode,
    at: doc.at,
  });
  const changedKey = JSON.stringify(changed.map((p) => [p.id, p.origin]));
  const computeTimes = compute.compute;
  useEffect(() => {
    if (changedKey !== '[]') void computeTimes();
  }, [changedKey, computeTimes]);
  useEffect(() => {
    if (!valid) return;
    saveMeetDraft(doc.meetingId, {
      ...(form.identity === 'new' ? { newName } : { participantId: form.identity }),
      ...(form.origin === undefined ? {} : { origin: form.origin }),
      likes: form.likes,
    });
  }, [doc.meetingId, form.identity, form.origin, form.likes, newName, valid]);
  const participants =
    form.identity === 'new' && valid && mine !== null
      ? [...doc.participants, mine]
      : doc.participants.map((p) => (p.id === mine?.id && originChanged ? mine : p));
  const send = async () => {
    if (!valid || sending) return;
    setSending(true);
    await shareMeetingDoc(
      replyFromDraft({
        meetingId: doc.meetingId,
        ...(form.identity === 'new' ? { newName } : { participantId: form.identity }),
        ...(form.origin === undefined ? {} : { origin: form.origin }),
        likes: form.likes,
        sentAt: new Date().toISOString(),
      }),
      doc.title,
    );
    setSending(false);
  };
  const owned = library.meetings?.[doc.meetingId];
  return (
    <Box sx={{ p: 2, maxWidth: 760, mx: 'auto' }}>
      <Box component="h1" sx={{ fontSize: 24, overflowWrap: 'anywhere' }}>
        {doc.title}
      </Box>
      <p>
        {doc.at === null ? '일시 미정' : `${doc.at.date.replaceAll('-', '.')} ${doc.at.time}`} ·{' '}
        {MODE_LABEL[doc.mode]}
      </p>
      {owned !== undefined && owned.deletedAt === null && (
        <Button component={Link} to={paths.meeting(doc.meetingId)} sx={{ minHeight: 44 }}>
          내 약속 열기
        </Button>
      )}
      <Box
        component="section"
        aria-label="후보 지도"
        sx={{ height: 280, position: 'relative', bgcolor: 'var(--tm-bg-raised)' }}
      >
        <MapView
          markers={doc.candidates.map((candidate, i) => ({
            id: candidate.id,
            lng: candidate.lng,
            lat: candidate.lat,
            label: `${i + 1} ${candidate.name}`,
            color: '#b64800',
            clusterable: false,
          }))}
          polylines={[]}
          onMarkerClick={() => {}}
          onUnavailable={setUnavailable}
        />
        {unavailable !== null && (
          <Box
            role="status"
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              p: 2,
            }}
          >
            {unavailable}
          </Box>
        )}
      </Box>
      <FormControl component="fieldset" sx={{ my: 2, width: '100%' }}>
        <FormLabel id={`${id}-identity`} component="legend">
          나는 누구?
        </FormLabel>
        <RadioGroup
          aria-labelledby={`${id}-identity`}
          value={form.identity}
          onChange={(event) => setForm({ ...fresh(), identity: event.target.value })}
        >
          {doc.participants.map((p) => (
            <FormControlLabel
              key={p.id}
              value={p.id}
              control={<Radio />}
              label={p.name}
              sx={{ minHeight: 44 }}
            />
          ))}
          <FormControlLabel
            value="new"
            control={<Radio />}
            label="목록에 없어요"
            sx={{ minHeight: 44 }}
          />
        </RadioGroup>
        {form.identity === 'new' && (
          <TextField
            label="내 이름"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            error={newName.length === 0 || newName.length > 20}
            helperText="이름은 1~20자로 넣어 주세요"
          />
        )}
      </FormControl>
      {form.identity !== '' && (
        <Box component="section" aria-label="내 출발지">
          <Box component="h2" sx={{ fontSize: 18 }}>
            내 출발지
          </Box>
          <Box>{origin?.name ?? '출발지 없음'}</Box>
          <Button onClick={() => setPicking(true)} sx={{ minHeight: 44 }}>
            내 출발지 고르기
          </Button>
          {origin !== null && (
            <Button
              onClick={() => setForm((prev) => ({ ...prev, origin: null }))}
              sx={{ minHeight: 44 }}
            >
              내 출발지 지우기
            </Button>
          )}
          {compute.pending && <Box role="status">내 소요시간을 다시 찾는 중이에요</Box>}
        </Box>
      )}
      <Box component="ul" aria-label="약속 후보" sx={{ p: 0, listStyle: 'none' }}>
        {doc.candidates.map((candidate) => {
          const values = {
            ...doc.times[candidate.id],
            ...(originChanged && mine !== null
              ? { [mine.id]: compute.times[candidate.id]?.[mine.id] ?? null }
              : {}),
          };
          return (
            <Box
              component="li"
              key={candidate.id}
              sx={{ py: 2, borderBottom: '1px solid var(--tm-border)' }}
            >
              <Box component="h2" sx={{ mt: 0, fontSize: 18 }}>
                {candidate.name}
              </Box>
              {candidate.address !== undefined && <p>{candidate.address}</p>}
              <TimeCells
                id={candidate.id}
                name={candidate.name}
                participants={participants}
                values={values}
                errors={originChanged ? compute.errors[candidate.id] : undefined}
                unit={doc.unit}
                onRetry={(cid, pid) => void compute.retry(cid, pid)}
              />
              <Button
                disabled={!valid}
                aria-label={`${candidate.name} 좋아요`}
                aria-pressed={form.likes.includes(candidate.id)}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    likes: prev.likes.includes(candidate.id)
                      ? prev.likes.filter((cid) => cid !== candidate.id)
                      : [...prev.likes, candidate.id],
                  }))
                }
                sx={{ minHeight: 44 }}
              >
                {form.likes.includes(candidate.id) ? '좋아요 취소' : '좋아요'}
              </Button>
            </Box>
          );
        })}
      </Box>
      <Button
        variant="contained"
        disabled={!valid || sending || compute.pending}
        onClick={() => void send()}
        sx={{ minHeight: 44 }}
      >
        답장 링크 보내기
      </Button>
      <OriginPicker
        open={picking}
        origin={origin}
        onClose={() => setPicking(false)}
        onPick={(next) => {
          setForm((prev) => ({ ...prev, origin: next }));
          setPicking(false);
        }}
      />
    </Box>
  );
}
