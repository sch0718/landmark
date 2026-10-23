import Box from '@mui/material/Box';
import { useRef, type KeyboardEvent } from 'react';
import { LabelGlyph } from 'src/components/icons';
import type { LabelColor } from 'src/schema/library';
import { EMOJI_OPTIONS } from 'src/sections/labels/emoji-options';
import { labelColors } from 'src/sections/library/label-style';
import { FOCUS_RING } from 'src/theme/focus-ring';

type Props = { value: string | null; color: LabelColor; onChange(emoji: string | null): void };

/** Tab은 선택한 항목으로 진입하고 화살표·Home·End로 이동하며 고른다. */
export function EmojiPicker({ value, color, onChange }: Props) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const tone = labelColors(color);
  const options: readonly (readonly [string | null, string])[] = [
    [null, '이모지 없음'],
    ...EMOJI_OPTIONS,
    ...(value !== null && !EMOJI_OPTIONS.some(([emoji]) => emoji === value)
      ? [[value, '현재 이모지'] as const]
      : []),
  ];
  const navigate = (event: KeyboardEvent, index: number) => {
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index + options.length - 1) % options.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = options.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    buttons.current[next]?.focus();
    onChange(options[next]![0]);
  };
  return (
    <Box>
      <Box component="h3" sx={{ m: 0, mb: 1, fontSize: 15 }}>
        이모지
      </Box>
      <Box
        role="radiogroup"
        aria-label="이모지"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}
      >
        {options.map(([emoji, name], index) => {
          const checked = value === emoji;
          return (
            <Box
              key={emoji ?? 'none'}
              component="button"
              type="button"
              role="radio"
              aria-label={name}
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              ref={(node: HTMLButtonElement | null) => {
                buttons.current[index] = node;
              }}
              onClick={() => onChange(emoji)}
              onKeyDown={(event) => navigate(event, index)}
              sx={{
                minWidth: 44,
                minHeight: 44,
                p: 1,
                borderRadius: 'var(--tm-radius-md)',
                border: '1px solid',
                borderColor: checked ? tone.marker : 'transparent',
                bgcolor: checked ? tone.fill : 'transparent',
                color: checked ? tone.text : 'var(--tm-text-secondary)',
                font: 'inherit',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                '&:focus-visible': FOCUS_RING,
              }}
            >
              {emoji === null ? name : <LabelGlyph emoji={emoji} size={24} />}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
