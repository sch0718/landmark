import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { effectiveCategory } from 'src/domain/place-category';
import { naverPlaceUrl } from 'src/models/place';
import { LIMITS } from 'src/schema/common';
import {
  usePlaceActions,
  type PlaceActionResult,
} from 'src/sections/explore/store/use-place-actions';
import { detailAtom, memoDraftsAtom, tagDraftsAtom } from 'src/sections/views/store/view-session';
import { useTripStore } from 'src/stores/trip-store';

function reportSaveError(e: unknown) {
  console.warn('편집을 저장하지 못했어요', e);
  toast.error('편집을 저장하지 못했어요');
}

/** 장소 한 곳의 상세: 분류, 네이버 메모, 작성자별 메모, 태그, 숨김, 일정 추가. 모든 텍스트는 React 텍스트로만 그린다. */
export function PlaceCard({ placeKey }: { placeKey: string }) {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const effectivePlaces = useAtomValue(ts.effectivePlacesAtom);
  const actions = usePlaceActions(placeKey);
  const [editingCategory, setEditingCategory] = useState(false);
  const drafts = useAtomValue(memoDraftsAtom);
  const setDetail = useSetAtom(detailAtom);
  const place = trip && Object.hasOwn(trip.places, placeKey) ? trip.places[placeKey] : null;
  if (!trip || !place) return null;

  const pe = edit?.places[placeKey];
  const tags = pe?.tags?.value ?? [];
  const hidden = pe?.hidden?.value ?? false;
  const category = effectiveCategory(place, pe);
  const categoryOverridden = typeof pe?.category?.value === 'string';
  const categoryOptions = [
    ...new Set(
      [...Object.values(trip.places), ...Object.values(effectivePlaces ?? {})].flatMap((p) =>
        p.category === null ? [] : [p.category],
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ko'));
  const naverUrl = naverPlaceUrl(place);
  const folderName = (id: string) => trip.folders.find((f) => f.id === id)?.name ?? id;
  const myId = edit?.authorId ?? null;
  const memoEntries = Object.entries(pe?.memos ?? {}).flatMap(([authorId, m]) =>
    m.text === null ? [] : [{ authorId, text: m.text }],
  );
  const hasMine = myId !== null && memoEntries.some((m) => m.authorId === myId);

  const save = async (pending: Promise<PlaceActionResult>) => {
    try {
      return await pending;
    } catch (e) {
      reportSaveError(e);
      return undefined;
    }
  };
  const setMemo = (text: string) => actions.setMemo(text);
  const setTags = (tags: string[]) => save(actions.setTags(tags));
  const setHidden = (hidden: boolean) => save(actions.setHidden(hidden));
  const setCategory = (value: string | null) => save(actions.setCategory(value));

  return (
    <Stack spacing={1.5} sx={{ p: 1.5 }} data-testid={`place-card-${placeKey}`}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {place.name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {place.address}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary" data-testid="place-category">
            {[category ?? '미분류', ...place.folderIds.map(folderName)].join(' · ')}
          </Typography>
          {!editingCategory && (
            <Button size="small" onClick={() => setEditingCategory(true)}>
              분류 변경
            </Button>
          )}
        </Stack>
        {categoryOverridden && (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">
              {`원본: ${place.category ?? '미분류'}`}
            </Typography>
            <Button size="small" onClick={() => void setCategory(null)}>
              원본으로
            </Button>
          </Stack>
        )}
        {editingCategory && (
          <CategoryForm
            key={placeKey}
            initial={category ?? ''}
            options={categoryOptions}
            onSave={setCategory}
            onClose={() => setEditingCategory(false)}
          />
        )}
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
              draftKey={`${placeKey}:mine`}
              onSave={mine ? setMemo : undefined}
              onDelete={mine ? () => void save(actions.setMemo(null)) : undefined}
            />
          );
        })}
        {!hasMine && Object.hasOwn(drafts, `${placeKey}:mine`) && (
          <MemoRow draftKey={`${placeKey}:mine`} nickname="나" text="" mine onSave={setMemo} />
        )}
        {((!hasMine && !Object.hasOwn(drafts, `${placeKey}:mine`)) ||
          Object.hasOwn(drafts, `${placeKey}:new`)) && (
          <NewMemo draftKey={`${placeKey}:new`} onSave={setMemo} />
        )}
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
          placeKey={placeKey}
          disabled={tags.length >= LIMITS.tagsPerPlace}
          onAdd={(tag) => {
            if (tags.includes(tag)) return Promise.resolve(undefined);
            return setTags([...tags, tag]);
          }}
        />
      </Box>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button
          size="small"
          variant="contained"
          onClick={() => setDetail({ kind: 'add', placeKey })}
        >
          일정에 추가
        </Button>
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

function CategoryForm(props: {
  initial: string;
  options: string[];
  onSave(value: string): Promise<PlaceActionResult | undefined>;
  onClose(): void;
}) {
  const [value, setValue] = useState(props.initial);
  const [saving, setSaving] = useState(false);
  // 장소가 바뀌어 이 폼이 사라진 뒤 끝난 저장이 현재 장소의 폼을 닫지 않게 한다.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const trimmed = value.trim();
  const valid = trimmed.length > 0 && trimmed.length <= LIMITS.categoryChars;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      if ((await props.onSave(trimmed)) === 'saved' && mounted.current) props.onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Box component="form" onSubmit={submit} sx={{ py: 0.5 }}>
      <Autocomplete
        freeSolo
        size="small"
        options={props.options}
        inputValue={value}
        onInputChange={(_e, next) => setValue(next.slice(0, LIMITS.categoryChars))}
        renderInput={({ InputProps, InputLabelProps, inputProps, ...params }) => (
          <TextField
            {...params}
            label="분류"
            slotProps={{
              input: InputProps,
              inputLabel: InputLabelProps,
              htmlInput: { ...inputProps, maxLength: LIMITS.categoryChars },
            }}
          />
        )}
      />
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
        <Button size="small" type="submit" disabled={!valid || saving}>
          저장
        </Button>
        <Button size="small" onClick={props.onClose}>
          취소
        </Button>
      </Stack>
    </Box>
  );
}

function MemoRow(props: {
  draftKey: string;
  nickname: string;
  text: string;
  mine: boolean;
  onSave?: (text: string) => Promise<PlaceActionResult>;
  onDelete?: () => void;
}) {
  const [drafts, setDrafts] = useAtom(memoDraftsAtom);
  const clear = () =>
    setDrafts((all) => {
      const next = { ...all };
      delete next[props.draftKey];
      return next;
    });
  if (props.mine && props.onSave && Object.hasOwn(drafts, props.draftKey)) {
    return (
      <Box>
        {props.text && (
          <Box sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              현재 메모
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {props.text}
            </Typography>
          </Box>
        )}
        <MemoForm
          draftKey={props.draftKey}
          initial={props.text}
          onSave={props.onSave}
          onSaved={clear}
          onCancel={clear}
        />
      </Box>
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
          <Button
            size="small"
            onClick={() => setDrafts((all) => ({ ...all, [props.draftKey]: props.text }))}
            aria-label="메모 수정"
          >
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

function NewMemo({
  draftKey,
  onSave,
}: {
  draftKey: string;
  onSave(text: string): Promise<PlaceActionResult>;
}) {
  const [drafts, setDrafts] = useAtom(memoDraftsAtom);
  const clear = () =>
    setDrafts((all) => {
      const next = { ...all };
      delete next[draftKey];
      return next;
    });
  if (!Object.hasOwn(drafts, draftKey)) {
    return (
      <Box>
        <Button size="small" onClick={() => setDrafts((all) => ({ ...all, [draftKey]: '' }))}>
          메모 추가
        </Button>
      </Box>
    );
  }
  return (
    <MemoForm draftKey={draftKey} initial="" onSave={onSave} onSaved={clear} onCancel={clear} />
  );
}

function MemoForm(props: {
  draftKey: string;
  initial: string;
  onSave(text: string): Promise<PlaceActionResult>;
  onSaved(): void;
  onCancel(): void;
}) {
  const [drafts, setDrafts] = useAtom(memoDraftsAtom);
  const store = useStore();
  const value = drafts[props.draftKey] ?? props.initial;
  const [saving, setSaving] = useState(false);
  const valid = value.trim().length > 0 && value.length <= LIMITS.memoChars;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    const submitted = value;
    setSaving(true);
    try {
      const result = await props.onSave(submitted.trim());
      if (result === 'saved' && store.get(memoDraftsAtom)[props.draftKey] === submitted)
        props.onSaved();
    } catch (e) {
      reportSaveError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Box component="form" onSubmit={submit} sx={{ py: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        작성 중인 내용
      </Typography>
      <TextField
        size="small"
        fullWidth
        multiline
        minRows={2}
        label="내 메모"
        value={value}
        onChange={(e) => setDrafts((all) => ({ ...all, [props.draftKey]: e.target.value }))}
        slotProps={{ htmlInput: { maxLength: LIMITS.memoChars } }}
      />
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
        <Button size="small" type="submit" disabled={!valid || saving}>
          저장
        </Button>
        <Button size="small" onClick={props.onCancel}>
          취소
        </Button>
      </Stack>
    </Box>
  );
}

function TagInput(props: {
  placeKey: string;
  disabled: boolean;
  onAdd(tag: string): Promise<PlaceActionResult | undefined>;
}) {
  const [drafts, setDrafts] = useAtom(tagDraftsAtom);
  const value = drafts[props.placeKey] ?? '';
  const [saving, setSaving] = useState(false);
  return (
    <TextField
      size="small"
      variant="standard"
      placeholder="태그 추가 (Enter)"
      value={value}
      disabled={props.disabled}
      onChange={(e) => setDrafts((all) => ({ ...all, [props.placeKey]: e.target.value }))}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || saving) return;
        e.preventDefault();
        const tag = value.trim();
        if (tag && value.length <= LIMITS.tagChars) {
          const submitted = value;
          setSaving(true);
          props
            .onAdd(tag)
            .then((result) => {
              if (result === 'saved')
                setDrafts((all) => {
                  if (all[props.placeKey] !== submitted) return all;
                  const next = { ...all };
                  delete next[props.placeKey];
                  return next;
                });
            })
            .catch(reportSaveError)
            .finally(() => setSaving(false));
        }
      }}
      slotProps={{ htmlInput: { 'aria-label': '태그 추가', maxLength: LIMITS.tagChars } }}
      sx={{ mt: 0.5 }}
    />
  );
}
