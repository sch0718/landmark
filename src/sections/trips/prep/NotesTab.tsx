import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useRef, useState } from 'react';
import { isTruncated } from 'src/components/TruncatedText';
import { checkTripSize } from 'src/domain/trips/bookings';
import {
  filterNotes,
  noteRegions,
  prepCountMessage,
  putPrepNote,
  removePrepNote,
  sortNotes,
} from 'src/domain/trips/prep';
import { PREP_NOTES_MAX, type PrepNote, type Trip } from 'src/schema/trip';
import { useTripUndo } from 'src/sections/trips/planner/use-trip-undo';
import { NoteSheet } from './NoteSheet';
import { PrepChip } from './PrepChip';
import { TOPIC_ICONS, TOPIC_LABELS } from './prep-labels';

const LINES = 4;
const clamp = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: LINES,
  overflow: 'hidden',
};

function NoteCard({ note, onEdit }: { note: PrepNote; onEdit: () => void }) {
  const textId = useId();
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    const measure = () => setTruncated(isTruncated(el, LINES));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, note.text]);

  return (
    <Stack
      component="article"
      sx={{
        gap: 1,
        p: 2,
        border: '1px solid var(--tm-border)',
        borderRadius: 'var(--tm-radius-md)',
        bgcolor: 'var(--tm-bg-raised)',
        overflowWrap: 'anywhere',
      }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
      >
        <Typography component="h2" sx={{ fontWeight: 800 }}>
          <span aria-hidden="true">{TOPIC_ICONS[note.topic]}</span> {TOPIC_LABELS[note.topic]}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {note.region || '여행 전체'}
          {note.checkedOn && (
            <>
              {' '}
              ·{' '}
              <time dateTime={note.checkedOn}>
                {note.checkedOn.slice(5).split('-').map(Number).join('/')}
              </time>{' '}
              확인
            </>
          )}
          {note.unsure && (
            <>
              {' '}
              ·{' '}
              <Box component="span" sx={{ color: 'warning.main' }}>
                ⚠ 확인 필요
              </Box>
            </>
          )}
        </Typography>
      </Stack>
      <Typography
        ref={textRef}
        id={textId}
        sx={{ whiteSpace: 'pre-line', ...(!expanded && clamp) }}
      >
        {note.text}
      </Typography>
      {truncated && (
        <Button
          aria-controls={textId}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          sx={{ minHeight: 44, alignSelf: 'start' }}
        >
          {expanded ? '접기' : '더 보기'}
        </Button>
      )}
      {note.sources.length > 0 && (
        <Box
          component="details"
          sx={{ '& > summary': { minHeight: 44, alignContent: 'center', cursor: 'pointer' } }}
        >
          <summary>출처 {note.sources.length}</summary>
          {note.sources.map((url, index) => (
            <Button
              key={index}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                minHeight: 44,
                display: 'flex',
                justifyContent: 'start',
                textAlign: 'start',
                overflowWrap: 'anywhere',
              }}
            >
              {url}
            </Button>
          ))}
        </Box>
      )}
      <Button
        onClick={onEdit}
        aria-label={`${TOPIC_LABELS[note.topic]} 고치기`}
        sx={{ minHeight: 44, alignSelf: 'end' }}
      >
        고치기
      </Button>
    </Stack>
  );
}

export function NotesTab({ trip }: { trip: Trip }) {
  const [selectedRegion, setRegion] = useState<string | null>(null);
  const [onlyUnsure, setOnlyUnsure] = useState(false);
  const [editor, setEditor] = useState<{ note: PrepNote | null } | null>(null);
  const { run } = useTripUndo(trip.id, checkTripSize);
  const notes = trip.prepNotes?.value ?? [];
  const regions = noteRegions(notes);
  const count = notes.filter(({ unsure }) => unsure).length;
  const region =
    selectedRegion !== null && regions.includes(selectedRegion) ? selectedRegion : null;
  const unsure = count > 0 && onlyUnsure;
  const shown = sortNotes(filterNotes(notes, { region, unsure }));
  const full = notes.length >= PREP_NOTES_MAX;

  return (
    <Stack sx={{ gap: 1.5 }}>
      {(count > 0 || regions.length > 0) && (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          {count > 0 && (
            <PrepChip
              label={`확인 필요 ${count}`}
              selected={unsure}
              onClick={() => setOnlyUnsure(!unsure)}
            />
          )}
          {regions.length > 0 && (
            <Stack role="group" aria-label="지역" direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              <PrepChip label="전체" selected={region === null} onClick={() => setRegion(null)} />
              {regions.map((value) => (
                <PrepChip
                  key={value}
                  label={value}
                  selected={region === value}
                  onClick={() => setRegion(value)}
                />
              ))}
            </Stack>
          )}
        </Stack>
      )}
      {shown.length === 0 && (
        <Typography color="text.secondary">
          {notes.length === 0 ? '아직 적은 정보가 없어요' : '이 조건에 맞는 정보가 없어요'}
        </Typography>
      )}
      {shown.map((note) => (
        <NoteCard key={note.id} note={note} onEdit={() => setEditor({ note })} />
      ))}
      <Button
        variant="contained"
        disabled={full}
        onClick={() => setEditor({ note: null })}
        sx={{ minHeight: 44, alignSelf: { sm: 'end' } }}
      >
        ＋ 정보 더하기
      </Button>
      {full && <Typography variant="body2">{prepCountMessage('prepNotes')}</Typography>}
      {editor && (
        <NoteSheet
          initial={editor.note}
          notes={notes}
          onClose={() => setEditor(null)}
          onSave={(input) =>
            run(
              (lib, ctx) => putPrepNote(lib, trip.id, input, ctx),
              editor.note ? '정보를 고쳤어요' : '정보를 더했어요',
            )
          }
          onRemove={(id) =>
            run((lib, ctx) => removePrepNote(lib, trip.id, id, ctx), '정보를 지웠어요')
          }
        />
      )}
    </Stack>
  );
}
