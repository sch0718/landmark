import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

/** 백틱으로 감싼 단추 이름을 텍스트 노드 그대로 강조한다. */
export function helpText(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <Box
        component="span"
        key={index}
        sx={{
          px: 0.5,
          border: '1px solid var(--tm-border)',
          borderRadius: 'var(--tm-radius-sm)',
          bgcolor: 'var(--tm-bg-raised)',
          color: 'var(--tm-text-primary)',
          fontWeight: 700,
        }}
      >
        {part.slice(1, -1)}
      </Box>
    ) : (
      part
    ),
  );
}
