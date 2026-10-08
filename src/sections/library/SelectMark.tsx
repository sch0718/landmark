import Box from '@mui/material/Box';
import { CheckIcon } from 'src/components/icons';

/** 선택 모드에서 행·카드 앞에 붙는 동그라미. 상태는 버튼의 `aria-pressed`가 알리므로 장식이다. */
export function SelectMark({ checked }: { checked: boolean }) {
  return (
    <Box
      aria-hidden="true"
      sx={{
        flex: 'none',
        width: 22,
        height: 22,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '2px solid',
        borderColor: checked ? 'var(--tm-accent-main)' : 'var(--tm-border)',
        bgcolor: checked ? 'var(--tm-accent-main)' : 'transparent',
        color: 'var(--tm-accent-contrast)',
        '& svg': { width: 14, height: 14 },
      }}
    >
      {checked && <CheckIcon />}
    </Box>
  );
}
