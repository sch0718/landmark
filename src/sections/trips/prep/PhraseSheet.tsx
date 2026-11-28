import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useId, useState } from 'react';
import {
  PHRASE_SITUATION_ORDER,
  prepLimitsIssue,
  proposePrepItem,
  type PhraseInput,
} from 'src/domain/trips/prep';
import { safeParse } from 'src/schema/parse';
import {
  PHRASE_KO_CHARS,
  PHRASE_NOTE_CHARS,
  PHRASE_READING_CHARS,
  PHRASE_TEXT_CHARS,
  PhraseSchema,
  type Phrase,
} from 'src/schema/trip';
import type { LibraryActionResult } from 'src/stores/library-state';
import { PrepChip } from './PrepChip';
import { PrepSheet, selectOptions } from './PrepSheet';
import { SITUATION_LABELS, languageLabel } from './prep-labels';

const fields = [
  ['ko', '한국어', PHRASE_KO_CHARS],
  ['text', '현지어', PHRASE_TEXT_CHARS],
  ['lang', '언어', 12],
  ['reading', '한글 읽는 법', PHRASE_READING_CHARS],
  ['note', '메모', PHRASE_NOTE_CHARS],
] as const;

type Props = {
  initial: PhraseInput;
  langs: readonly string[];
  phrases: readonly Phrase[];
  onSave: (input: PhraseInput) => Promise<LibraryActionResult>;
  onClose: () => void;
};

/** `es-es`처럼 적어도 `es-ES`로 저장해 언어 칩이 둘로 갈리지 않게 한다. */
function canonicalLang(lang: string) {
  try {
    return Intl.getCanonicalLocales(lang)[0] ?? lang;
  } catch {
    return lang;
  }
}

export function PhraseSheet({ initial, langs, phrases, onSave, onClose }: Props) {
  const situationId = useId();
  const [draft, setDraft] = useState(initial);
  const input = {
    ...draft,
    ko: draft.ko.trim(),
    text: draft.text.trim() === '' ? '' : draft.text,
    lang: canonicalLang(draft.lang.trim()),
  };
  const parsed = safeParse(PhraseSchema, { ...input, id: input.id ?? '00000000' });
  const validation = parsed.success
    ? prepLimitsIssue(
        'phrases',
        input.id === undefined ? [...phrases, parsed.data] : proposePrepItem(phrases, parsed.data),
      )
    : parsed.issues.some(({ path }) => path === 'lang' && input.lang !== '')
      ? '언어를 es-ES처럼 적어 주세요'
      : parsed.issues.some(({ path }) => path !== 'ko' && path !== 'text' && path !== 'lang')
        ? '문장을 다시 확인해 주세요'
        : null;

  function change<K extends keyof PhraseInput>(key: K, value: PhraseInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <PrepSheet
      title={initial.id ? '문장 편집' : '문장 더하기'}
      draft={draft}
      validation={validation}
      canSave={parsed.success && validation === null}
      onSave={() => onSave(input)}
      onClose={onClose}
    >
      <TextField
        id={situationId}
        label="상황"
        select
        value={draft.situation}
        slotProps={selectOptions}
        onChange={(event) => change('situation', event.target.value as Phrase['situation'])}
      >
        {PHRASE_SITUATION_ORDER.map((value) => (
          <MenuItem key={value} value={value}>
            {SITUATION_LABELS[value]}
          </MenuItem>
        ))}
      </TextField>
      {fields.map(([key, label, maxLength]) => (
        <Stack key={key} sx={{ gap: 1 }}>
          <TextField
            label={label}
            value={draft[key]}
            multiline={key === 'text'}
            minRows={key === 'text' ? 3 : undefined}
            placeholder={key === 'lang' ? 'es-ES' : undefined}
            slotProps={{ htmlInput: { maxLength } }}
            onChange={(event) => change(key, event.target.value)}
          />
          {key === 'lang' && langs.length > 0 && (
            <Stack
              role="group"
              aria-label="기존 언어"
              direction="row"
              sx={{ flexWrap: 'wrap', gap: 1 }}
            >
              {langs.map((lang) => (
                <PrepChip
                  key={lang}
                  label={languageLabel(lang)}
                  selected={draft.lang === lang}
                  onClick={() => change('lang', lang)}
                />
              ))}
            </Stack>
          )}
        </Stack>
      ))}
    </PrepSheet>
  );
}
