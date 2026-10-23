import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useId, useState, type FormEvent } from 'react';
import { addParticipant, removeParticipant, updateParticipant } from 'src/domain/meeting/ops';
import type { Meeting, Participant } from 'src/schema/meeting';
import { OriginPicker } from 'src/sections/meetings/OriginPicker';
import { useMeeting } from 'src/sections/meetings/use-meeting';

const replyTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 올해 여부도 한국 시각으로 비교하고 초는 생략한다. */
function formatReplyTime(iso: string): string {
  const parts = (date: Date) =>
    Object.fromEntries(replyTimeFormat.formatToParts(date).map(({ type, value }) => [type, value]));
  const received = parts(new Date(iso));
  const prefix = received.year === parts(new Date()).year ? '' : `${received.year}.`;
  return `${prefix}${received.month}.${received.day} ${received.hour}:${received.minute}`;
}

type Editing = { participant: Participant | null; name: string; touched: boolean };

/** 참석자와 출발지. 이름과 삭제는 대화상자에서 확인한 뒤 저장한다. */
export function ParticipantList({ meeting }: { meeting: Meeting }) {
  const { run } = useMeeting(meeting.id);
  const id = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Participant | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = meeting.participants.value.find((p) => p.id === picking);
  const length = editing?.name.trim().length ?? 0;
  const valid = length > 0 && length <= 20;
  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    setEditing((current) => (current === null ? null : { ...current, touched: true }));
    if (!editing || !valid || busy) return;
    setBusy(true);
    const result = await run((lib, ctx) =>
      editing.participant === null
        ? addParticipant(lib, meeting.id, { name: editing.name, origin: null }, ctx)
        : updateParticipant(lib, meeting.id, editing.participant.id, { name: editing.name }, ctx),
    );
    setBusy(false);
    if (result.ok) setEditing(null);
  };
  const confirmDelete = async () => {
    if (deleting === null || busy) return;
    setBusy(true);
    const result = await run((lib, ctx) => removeParticipant(lib, meeting.id, deleting.id, ctx));
    setBusy(false);
    if (result.ok) setDeleting(null);
  };
  return (
    <Box component="section" aria-labelledby={`${id}-heading`} sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box component="h2" id={`${id}-heading`} sx={{ m: 0, fontSize: 18 }}>
          참석자
        </Box>
        <Button
          disabled={meeting.participants.value.length >= 10}
          onClick={() => setEditing({ participant: null, name: '', touched: false })}
          sx={{ minHeight: 44 }}
        >
          참석자 추가
        </Button>
      </Box>
      {meeting.participants.value.length >= 10 && (
        <Box sx={{ color: 'var(--tm-text-secondary)', fontSize: 13 }}>참석자는 10명까지예요</Box>
      )}
      <Box component="ul" aria-label="참석자 목록" sx={{ p: 0, m: 0, listStyle: 'none' }}>
        {meeting.participants.value.map((participant, index) => {
          const reply = meeting.replies.value[participant.id];
          return (
            <Box
              component="li"
              key={participant.id}
              sx={{ py: 1.5, borderBottom: '1px solid var(--tm-border)' }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box component="strong" sx={{ flex: 1, overflowWrap: 'anywhere' }}>
                  {participant.name}
                </Box>
                <Button
                  aria-label={`${participant.name} 이름 고치기`}
                  onClick={() =>
                    setEditing({ participant, name: participant.name, touched: false })
                  }
                  sx={{ minWidth: 44, minHeight: 44 }}
                >
                  이름 고치기
                </Button>
                {index > 0 && (
                  <Button
                    aria-label={`${participant.name} 삭제`}
                    onClick={() => setDeleting(participant)}
                    sx={{ minWidth: 44, minHeight: 44 }}
                  >
                    삭제
                  </Button>
                )}
              </Box>
              <Box sx={{ color: 'var(--tm-text-secondary)', overflowWrap: 'anywhere' }}>
                {participant.origin?.name ?? '출발지 없음'}
              </Box>
              {reply !== undefined && (
                <Box sx={{ fontSize: 12, mt: 0.5 }}>
                  답장 받음{' '}
                  <time dateTime={reply.receivedAt}>{formatReplyTime(reply.receivedAt)}</time>
                </Box>
              )}
              <Button
                aria-label={`${participant.name} 출발지 고르기`}
                onClick={() => setPicking(participant.id)}
                sx={{ minHeight: 44 }}
              >
                출발지 고르기
              </Button>
              {participant.origin !== null && (
                <Button
                  aria-label={`${participant.name} 출발지 지우기`}
                  onClick={() => {
                    void run((lib, ctx) =>
                      updateParticipant(lib, meeting.id, participant.id, { origin: null }, ctx),
                    );
                  }}
                  sx={{ minHeight: 44 }}
                >
                  출발지 지우기
                </Button>
              )}
            </Box>
          );
        })}
      </Box>
      <Dialog
        open={editing !== null}
        onClose={() => {
          if (!busy) setEditing(null);
        }}
        aria-labelledby={`${id}-name`}
        fullWidth
        maxWidth="xs"
      >
        <Box component="form" onSubmit={(event) => void saveName(event)}>
          <DialogTitle id={`${id}-name`}>
            {editing?.participant === null ? '참석자 추가' : '참석자 이름 고치기'}
          </DialogTitle>
          <DialogContent sx={{ pt: '8px !important' }}>
            <TextField
              autoFocus
              label="참석자 이름"
              value={editing?.name ?? ''}
              onChange={(event) =>
                setEditing((current) =>
                  current === null ? null : { ...current, name: event.target.value, touched: true },
                )
              }
              fullWidth
              error={editing?.touched === true && !valid}
              helperText={
                editing?.touched !== true
                  ? null
                  : length > 20
                    ? '이름은 20자까지예요'
                    : length === 0
                      ? '이름을 넣어 주세요'
                      : null
              }
            />
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setEditing(null)} sx={{ minHeight: 44 }}>
              취소
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={!valid || busy}
              sx={{ minHeight: 44 }}
            >
              {editing?.participant === null ? '추가' : '저장'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
        aria-labelledby={`${id}-delete`}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle id={`${id}-delete`}>참석자 지우기</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleting?.name}님을 지울까요? 받은 답장도 함께 지워져요.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setDeleting(null)} sx={{ minHeight: 44 }}>
            취소
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => void confirmDelete()}
            sx={{ minHeight: 44 }}
          >
            삭제
          </Button>
        </DialogActions>
      </Dialog>
      <OriginPicker
        open={selected !== undefined}
        origin={selected?.origin}
        onClose={() => setPicking(null)}
        onPick={(origin) => {
          if (selected === undefined) return;
          void run((lib, ctx) =>
            updateParticipant(lib, meeting.id, selected.id, { origin }, ctx),
          ).then((result) => {
            if (result.ok) setPicking(null);
          });
        }}
      />
    </Box>
  );
}
