import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import { useId } from 'react';
import type { MemoDecision } from 'src/domain/library/legacy-import';
import { downloadText } from 'src/lib/download-text';
import { LIBRARY_LIMITS } from 'src/schema/library';
import type { LabelDraft, LabelItem, MemoItem } from 'src/sections/settings/import-decisions';

const clip = (text: string, count: number): string => Array.from(text).slice(0, count).join('');

const ITEM_SX = {
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  p: 1.5,
  border: '1px solid var(--tm-border)',
  borderRadius: 'var(--tm-radius-md)',
  bgcolor: 'var(--tm-bg-raised)',
} as const;

const REASON = {
  empty: '이름이 비어 있어요',
  'too-long': `이름이 ${LIBRARY_LIMITS.labelNameChars}자를 넘어요`,
} as const;

type LabelProps = {
  item: LabelItem;
  draft: LabelDraft;
  error: string | null;
  onChange(draft: LabelDraft): void;
};

/** 라벨 이름 확인: 입력란(제안값)과 "이 라벨 제외". 이름을 고치거나 "이 이름 사용"을 눌러야 결정이 된다. */
export function LabelNameItem({ item, draft, error, onChange }: LabelProps) {
  const errorId = useId();
  return (
    <Box component="li" aria-label={`라벨 이름 확인 - ${clip(item.rawName, 20)}`} sx={ITEM_SX}>
      <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
        {`${REASON[item.reason]}. 이름을 확인하거나 이 라벨을 제외하세요.`}
      </Typography>
      <Typography
        variant="caption"
        sx={{ color: 'var(--tm-text-muted)', overflowWrap: 'anywhere' }}
      >{`원래 이름: ${item.rawName}`}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Box
          component="input"
          type="text"
          aria-label="라벨 이름"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          autoComplete="off"
          value={draft.name}
          disabled={draft.excluded}
          onChange={(event) => onChange({ ...draft, name: event.target.value, confirmed: true })}
          sx={{
            flex: '1 1 160px',
            minWidth: 0,
            boxSizing: 'border-box',
            minHeight: 44,
            px: 1.25,
            border: '1px solid',
            borderColor: error === null ? 'var(--tm-border)' : 'error.main',
            borderRadius: 'var(--tm-radius-md)',
            bgcolor: 'var(--tm-bg-surface)',
            color: 'var(--tm-text-primary)',
            font: 'inherit',
            fontSize: 16,
            '&:disabled': { opacity: 0.5 },
            '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 1 },
          }}
        />
        <Button
          variant="outlined"
          disabled={draft.excluded || draft.confirmed}
          onClick={() => onChange({ ...draft, confirmed: true })}
          sx={{ minHeight: 44 }}
        >
          이 이름 사용
        </Button>
      </Box>
      {error !== null && (
        <Typography id={errorId} role="alert" variant="body2" color="error">
          {error}
        </Typography>
      )}
      <FormControlLabel
        control={
          <Checkbox
            checked={draft.excluded}
            onChange={(event) =>
              onChange({ ...draft, excluded: event.target.checked, confirmed: true })
            }
          />
        }
        label="이 라벨 제외"
        sx={{ m: 0, minHeight: 44 }}
      />
    </Box>
  );
}

type MemoProps = {
  item: MemoItem;
  decision: MemoDecision | undefined;
  /** 합친 메모 원문 전체. */
  fullMemo: string;
  onChange(decision: MemoDecision): void;
};

/** 파일 이름에 쓸 수 없는 문자를 바꾼다. */
const safeFileName = (name: string): string =>
  Array.from(name, (c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '_' : c)).join('');

/** 긴 메모: "최대 10,000자로 가져오기" / "이 장소 제외"와 원문 받기. */
export function MemoLengthItem({ item, decision, fullMemo, onChange }: MemoProps) {
  return (
    <Box component="li" aria-label={`메모 길이 확인 - ${clip(item.placeName, 20)}`} sx={ITEM_SX}>
      <Typography
        variant="body2"
        sx={{ color: 'var(--tm-text-secondary)', overflowWrap: 'anywhere' }}
      >
        {`‘${item.placeName}’의 메모가 ${item.length.toLocaleString('ko-KR')}자라서 ${LIBRARY_LIMITS.memoChars.toLocaleString('ko-KR')}자 한도를 넘어요.`}
      </Typography>
      <RadioGroup
        value={decision ?? ''}
        onChange={(event) => onChange(event.target.value as MemoDecision)}
        aria-label="메모 처리"
      >
        <FormControlLabel
          value="truncate"
          control={<Radio />}
          label={`최대 ${LIBRARY_LIMITS.memoChars.toLocaleString('ko-KR')}자로 가져오기(생략 표시 포함)`}
          sx={{ minHeight: 44 }}
        />
        <FormControlLabel
          value="exclude-place"
          control={<Radio />}
          label="이 장소 제외"
          sx={{ minHeight: 44 }}
        />
      </RadioGroup>
      <Box>
        <Button
          variant="outlined"
          onClick={() =>
            downloadText(
              fullMemo,
              `${safeFileName(item.placeName)}-memo.txt`,
              'text/plain;charset=utf-8',
            )
          }
          sx={{ minHeight: 44 }}
        >
          원문 받기(.txt)
        </Button>
      </Box>
    </Box>
  );
}
