import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useId, useState } from 'react';
import {
  PREP_TOPIC_ORDER,
  prepLimitsIssue,
  proposePrepItem,
  type PrepNoteInput,
} from 'src/domain/trips/prep';
import { safeParse } from 'src/schema/parse';
import {
  PREP_REGION_CHARS,
  PREP_SOURCES_MAX,
  PREP_TEXT_CHARS,
  PREP_URL_CHARS,
  PrepNoteSchema,
  type PrepNote,
} from 'src/schema/trip';
import type { LibraryActionResult } from 'src/stores/library-state';
import { PrepSheet, selectOptions } from './PrepSheet';
import { TOPIC_LABELS } from './prep-labels';

const empty: PrepNoteInput = {
  topic: 'other',
  region: '',
  text: '',
  sources: [],
  checkedOn: null,
  unsure: false,
};

type Props = {
  initial: PrepNote | null;
  notes: readonly PrepNote[];
  onSave: (input: PrepNoteInput) => Promise<LibraryActionResult>;
  onRemove: (id: string) => Promise<LibraryActionResult>;
  onClose: () => void;
};

export function NoteSheet({ initial, notes, onSave, onRemove, onClose }: Props) {
  const topicId = useId();
  const [draft, setDraft] = useState<PrepNoteInput>(initial ?? empty);
  const input = {
    ...draft,
    region: draft.region.trim(),
    text: draft.text.trim() === '' ? '' : draft.text,
    sources: draft.sources.map((url) => url.trim()).filter(Boolean),
  };
  const parsed = safeParse(PrepNoteSchema, { ...input, id: input.id ?? '00000000' });
  const validation = parsed.success
    ? prepLimitsIssue(
        'prepNotes',
        input.id === undefined ? [...notes, parsed.data] : proposePrepItem(notes, parsed.data),
      )
    : parsed.issues.some(({ path }) => path.startsWith('sources'))
      ? '출처는 https://로 시작하는 주소로 적어 주세요'
      : parsed.issues.some(({ path }) => path !== 'text' || input.text !== '')
        ? '정보를 다시 확인해 주세요'
        : null;

  function change<K extends keyof PrepNoteInput>(key: K, value: PrepNoteInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <PrepSheet
      title={initial ? '정보 편집' : '정보 더하기'}
      draft={draft}
      validation={validation}
      canSave={parsed.success && validation === null}
      onSave={() => onSave(input)}
      onRemove={initial ? () => onRemove(initial.id) : undefined}
      onClose={onClose}
    >
      <TextField
        id={topicId}
        select
        label="주제"
        value={draft.topic}
        slotProps={selectOptions}
        onChange={(event) => change('topic', event.target.value as PrepNote['topic'])}
      >
        {PREP_TOPIC_ORDER.map((topic) => (
          <MenuItem key={topic} value={topic}>
            {TOPIC_LABELS[topic]}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="지역"
        value={draft.region}
        slotProps={{ htmlInput: { maxLength: PREP_REGION_CHARS } }}
        onChange={(event) => change('region', event.target.value)}
      />
      <TextField
        label="내용"
        multiline
        minRows={3}
        value={draft.text}
        helperText={`${PREP_TEXT_CHARS - draft.text.length}자 남았어요`}
        slotProps={{ htmlInput: { maxLength: PREP_TEXT_CHARS } }}
        onChange={(event) => change('text', event.target.value)}
      />
      {Array.from({ length: PREP_SOURCES_MAX }, (_, index) => (
        <TextField
          key={index}
          label={`출처 링크 ${index + 1}`}
          type="url"
          value={draft.sources[index] ?? ''}
          slotProps={{ htmlInput: { maxLength: PREP_URL_CHARS } }}
          onChange={(event) => {
            const sources = Array.from(
              { length: PREP_SOURCES_MAX },
              (_, i) => draft.sources[i] ?? '',
            );
            sources[index] = event.target.value;
            change('sources', sources);
          }}
        />
      ))}
      <TextField
        label="확인한 날"
        type="date"
        value={draft.checkedOn ?? ''}
        slotProps={{ inputLabel: { shrink: true } }}
        onChange={(event) => change('checkedOn', event.target.value || null)}
      />
      <FormControlLabel
        label="확인 필요"
        control={
          <Checkbox
            checked={draft.unsure}
            onChange={(_, checked) => change('unsure', checked)}
            sx={{ minWidth: 44, minHeight: 44 }}
          />
        }
      />
    </PrepSheet>
  );
}
