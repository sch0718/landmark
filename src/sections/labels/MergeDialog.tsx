import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useState } from 'react';
import { LabelGlyph } from 'src/components/icons';
import type { Label } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';

type Props = {
  /** 합쳐져 사라질 라벨. */
  from: Label;
  /** 합칠 수 있는 대상(살아 있는 다른 라벨, 순서대로). */
  targets: Label[];
  /** 라벨 id별로 붙은 (살아 있는) 장소 수. */
  counts: ReadonlyMap<string, number>;
  onCancel(): void;
  onConfirm(intoId: string): void;
};

/** 라벨 병합. 대상 라벨을 고르면 영향받는 장소 수가 든 확인 문구가 나타난다. */
export function MergeDialog({ from, targets, counts, onCancel, onConfirm }: Props) {
  const [intoId, setIntoId] = useState<string | null>(null);
  const into = targets.find((label) => label.id === intoId);
  const fromName = from.name.value;

  return (
    <Dialog open onClose={onCancel} aria-labelledby="merge-label-title" fullWidth maxWidth="xs">
      <DialogTitle id="merge-label-title">{`‘${fromName}’ 합치기`}</DialogTitle>
      <DialogContent>
        <Box
          role="radiogroup"
          aria-label="합칠 라벨"
          sx={{ display: 'flex', flexDirection: 'column' }}
        >
          {targets.map((label) => {
            const checked = label.id === intoId;
            const tone = labelColors(label.color.value);
            return (
              <Box
                key={label.id}
                component="button"
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setIntoId(label.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  minHeight: 44,
                  px: 1,
                  border: '1px solid',
                  borderColor: checked ? tone.marker : 'transparent',
                  borderRadius: 'var(--tm-radius-md)',
                  bgcolor: checked ? tone.fill : 'transparent',
                  color: checked ? tone.text : 'var(--tm-text-primary)',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  // 대화상자 내용이 넘침을 자르니 첫 행의 바깥선이 위에서 잘리지 않게 안쪽으로 그린다.
                  '&:focus-visible': { outlineOffset: -2 },
                }}
              >
                <Box component="span" sx={{ display: 'inline-flex', color: tone.marker }}>
                  <LabelGlyph name={label.icon.value} size={18} />
                </Box>
                <Box
                  component="span"
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label.name.value}
                </Box>
              </Box>
            );
          })}
        </Box>
        {into !== undefined && (
          <DialogContentText role="status" sx={{ mt: 2 }}>
            {`‘${fromName}’를 ‘${into.name.value}’로 합칠까요? 장소 ${counts.get(from.id) ?? 0}곳에 ‘${into.name.value}’가 붙고 ‘${fromName}’는 지워져요.`}
          </DialogContentText>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} sx={{ minHeight: 44 }}>
          취소
        </Button>
        <Button
          variant="contained"
          disabled={into === undefined}
          onClick={() => into !== undefined && onConfirm(into.id)}
          sx={{ minHeight: 44 }}
        >
          합치기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
