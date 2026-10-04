import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { overlay } from 'src/domain/overlay';
import { naverPlaceUrl } from 'src/models/place';
import { LIMITS } from 'src/schema/common';
import type { EditLayer, PlaceEdit } from 'src/schema/edit-layer';
import { addStopToDay } from 'src/sections/explore/store/add-stop';
import { useEditActions, useTripStore } from 'src/stores/trip-store';

function reportSaveError(e: unknown) {
  console.warn('편집을 저장하지 못했어요', e);
  toast.error('편집을 저장하지 못했어요');
}

const dayLabel = (index: number, date: string) =>
  `Day ${index + 1} (${date.slice(5).replace('-', '/')})`;

/** 장소 한 곳의 상세: 네이버 메모, 작성자별 메모, 태그, 숨김, 일정 추가. 모든 텍스트는 React 텍스트로만 그린다. */
export function PlaceCard({ placeKey }: { placeKey: string }) {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const { update } = useEditActions();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const place = trip?.places[placeKey];
  if (!trip || !place) return null;

  const pe = edit?.places[placeKey];
  const tags = pe?.tags?.value ?? [];
  const hidden = pe?.hidden?.value ?? false;
  const naverUrl = naverPlaceUrl(place);
  const folderName = (id: string) => trip.folders.find((f) => f.id === id)?.name ?? id;
  const myId = edit?.authorId ?? null;
  const memoEntries = Object.entries(pe?.memos ?? {}).flatMap(([authorId, m]) =>
    m.text === null ? [] : [{ authorId, text: m.text }],
  );
  const hasMine = myId !== null && memoEntries.some((m) => m.authorId === myId);

  const save = (fn: (e: EditLayer, now: string) => EditLayer) => {
    const now = ts.nowIso();
    update((e) => fn(e, now)).catch(reportSaveError);
  };
  const patchPlace = (e: EditLayer, patch: (p: PlaceEdit) => PlaceEdit): EditLayer => ({
    ...e,
    places: { ...e.places, [placeKey]: patch(e.places[placeKey] ?? { memos: {} }) },
  });
  const setMemo = (text: string | null) =>
    save((e, now) =>
      patchPlace(e, (p) => ({
        ...p,
        memos: { ...p.memos, [e.authorId]: { text, updatedAt: now } },
      })),
    );
  const setTags = (value: string[]) =>
    save((e, now) => patchPlace(e, (p) => ({ ...p, tags: { value, updatedAt: now } })));
  const setHidden = (value: boolean) =>
    save((e, now) => patchPlace(e, (p) => ({ ...p, hidden: { value, updatedAt: now } })));
  const addToDay = (date: string) => {
    setMenuAnchor(null);
    save((e, now) => {
      const count = overlay(trip, e).days.find((d) => d.date === date)?.stops.length ?? 0;
      if (count >= LIMITS.stopsPerDay) {
        toast.error(`하루에 ${LIMITS.stopsPerDay}곳까지 넣을 수 있어요`);
        return e;
      }
      return addStopToDay(trip, e, date, placeKey, now);
    });
  };

  return (
    <Stack spacing={1.5} sx={{ p: 1.5 }} data-testid={`place-card-${placeKey}`}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {place.name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {place.address}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {[place.category ?? '미분류', ...place.folderIds.map(folderName)].join(' · ')}
        </Typography>
      </Box>

      {place.naverMemos && place.naverMemos.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            네이버 메모
          </Typography>
          {place.naverMemos.map((m, i) => (
            <Typography key={i} variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              <Typography component="span" variant="caption" color="text.secondary">
                {folderName(m.folderId)}
              </Typography>{' '}
              {m.memo}
            </Typography>
          ))}
        </Box>
      )}

      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          메모
        </Typography>
        {memoEntries.map(({ authorId, text }) => {
          const mine = authorId === myId;
          return (
            <MemoRow
              key={authorId}
              nickname={mine ? '나' : (edit?.authors[authorId]?.nickname ?? '알 수 없음')}
              text={text}
              mine={mine}
              onSave={setMemo}
              onDelete={() => setMemo(null)}
            />
          );
        })}
        {!hasMine && <NewMemo onSave={setMemo} />}
      </Box>

      <Box>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          {tags.map((t) => (
            <Chip
              key={t}
              size="small"
              label={t}
              onDelete={() => setTags(tags.filter((x) => x !== t))}
              deleteIcon={
                <span aria-label={`태그 ${t} 삭제`} role="button">
                  ×
                </span>
              }
            />
          ))}
        </Stack>
        <TagInput
          disabled={tags.length >= LIMITS.tagsPerPlace}
          onAdd={(tag) => {
            if (tags.includes(tag)) return;
            setTags([...tags, tag]);
          }}
        />
      </Box>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button size="small" variant="contained" onClick={(e) => setMenuAnchor(e.currentTarget)}>
          일정에 추가
        </Button>
        <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
          {trip.days.map((d, i) => (
            <MenuItem key={d.date} onClick={() => addToDay(d.date)}>
              {dayLabel(i, d.date)}
            </MenuItem>
          ))}
        </Menu>
        <Button size="small" onClick={() => setHidden(!hidden)}>
          {hidden ? '숨김 해제' : '숨기기'}
        </Button>
        {naverUrl && (
          <Link
            href={naverUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            sx={{ alignSelf: 'center' }}
          >
            네이버에서 열기
          </Link>
        )}
      </Stack>
    </Stack>
  );
}

function MemoRow(props: {
  nickname: string;
  text: string;
  mine: boolean;
  onSave(text: string): void;
  onDelete(): void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <MemoForm
        initial={props.text}
        onSave={(t) => {
          setEditing(false);
          props.onSave(t);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <Box sx={{ py: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {props.nickname}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
        {props.text}
      </Typography>
      {props.mine && (
        <Stack direction="row" spacing={0.5}>
          <Button size="small" onClick={() => setEditing(true)} aria-label="메모 수정">
            수정
          </Button>
          <Button size="small" color="error" onClick={props.onDelete} aria-label="메모 삭제">
            삭제
          </Button>
        </Stack>
      )}
    </Box>
  );
}

function NewMemo({ onSave }: { onSave(text: string): void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Box>
        <Button size="small" onClick={() => setOpen(true)}>
          메모 추가
        </Button>
      </Box>
    );
  }
  return (
    <MemoForm
      initial=""
      onSave={(t) => {
        setOpen(false);
        onSave(t);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

function MemoForm(props: { initial: string; onSave(text: string): void; onCancel(): void }) {
  const [value, setValue] = useState(props.initial);
  const valid = value.trim().length > 0 && value.length <= LIMITS.memoChars;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) props.onSave(value.trim());
  };
  return (
    <Box component="form" onSubmit={submit} sx={{ py: 0.5 }}>
      <TextField
        size="small"
        fullWidth
        multiline
        minRows={2}
        label="내 메모"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        slotProps={{ htmlInput: { maxLength: LIMITS.memoChars } }}
      />
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
        <Button size="small" type="submit" disabled={!valid}>
          저장
        </Button>
        <Button size="small" onClick={props.onCancel}>
          취소
        </Button>
      </Stack>
    </Box>
  );
}

function TagInput(props: { disabled: boolean; onAdd(tag: string): void }) {
  const [value, setValue] = useState('');
  return (
    <TextField
      size="small"
      variant="standard"
      placeholder="태그 추가 (Enter)"
      value={value}
      disabled={props.disabled}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const tag = value.trim();
        setValue('');
        if (tag) props.onAdd(tag);
      }}
      slotProps={{ htmlInput: { 'aria-label': '태그 추가', maxLength: LIMITS.tagChars } }}
      sx={{ mt: 0.5 }}
    />
  );
}
