import Box from '@mui/material/Box';
import { useId, useState, type KeyboardEvent } from 'react';
import { LabelGlyph } from 'src/components/icons';
import type { LibraryActionResult } from 'src/stores/library-state';
import { LIBRARY_LIMITS, type Label } from 'src/schema/library';
import { ChipButton } from 'src/sections/library/ChipButton';
import { labelColors } from 'src/sections/library/label-style';

type Props = {
  /** 붙일 수 있는 라벨(살아 있는 모든 라벨, 순서대로). */
  labels: Label[];
  /** 이 장소에 붙은 라벨 id. */
  attachedIds: readonly string[];
  /** 라벨을 켜거나 끈다. 실패는 호출한 쪽이 알린다(토스트). */
  onToggle(labelId: string): void;
  /** 이름으로 라벨을 만들어(같은 이름이 있으면 그것을) 붙인다. */
  onCreate(name: string): Promise<LibraryActionResult>;
};

const NAME_INVALID = `1–${LIBRARY_LIMITS.labelNameChars}자로 입력하세요`;

const isNameInvalid = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  '_tag' in error &&
  error._tag === 'LabelNameInvalid';

/** 장소 상세의 라벨 칩(켜짐/꺼짐)과 새 라벨 입력란. */
export function LabelPicker({ labels, attachedIds, onToggle, onCreate }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const create = async () => {
    const result = await onCreate(name);
    if (result.ok) {
      setName('');
      setError(null);
    } else if (isNameInvalid(result.error)) {
      setError(NAME_INVALID);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 한글 조합 중의 Enter는 글자를 확정하는 키라서 건너뛴다.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void create();
  };

  return (
    <Box>
      {labels.length > 0 && (
        <Box
          role="group"
          aria-label="라벨"
          sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 0.5 }}
        >
          {labels.map((label) => {
            const tone = labelColors(label.color.value);
            return (
              <ChipButton
                key={label.id}
                selected={attachedIds.includes(label.id)}
                tone={tone}
                onClick={() => onToggle(label.id)}
              >
                <LabelGlyph name={label.icon.value} size={14} />
                {label.name.value}
              </ChipButton>
            );
          })}
        </Box>
      )}
      <Box
        component="input"
        type="text"
        aria-label="새 라벨 이름"
        placeholder="새 라벨 이름"
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        sx={{
          boxSizing: 'border-box',
          width: '100%',
          minHeight: 44,
          mt: 0.5,
          px: 1.25,
          border: '1px solid',
          borderColor: error === null ? 'var(--tm-border)' : 'error.main',
          borderRadius: 'var(--tm-radius-md)',
          bgcolor: 'var(--tm-bg-raised)',
          color: 'var(--tm-text-primary)',
          font: 'inherit',
          fontSize: 14,
          '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 1 },
        }}
      />
      {error !== null && (
        <Box id={errorId} role="alert" sx={{ mt: 0.5, fontSize: 12, color: 'error.main' }}>
          {error}
        </Box>
      )}
    </Box>
  );
}
