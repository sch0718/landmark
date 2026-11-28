import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Drawer from '@mui/material/Drawer';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, useState, type ReactNode } from 'react';
import { useLayout } from 'src/sections/shell/use-layout';
import type { LibraryActionResult } from 'src/stores/library-state';

export const selectOptions = {
  select: { MenuProps: { sx: { '& .MuiMenuItem-root': { minHeight: 44 } } } },
};

export function prepActionError(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === 'object' &&
    '_tag' in error &&
    (error._tag === 'PrepInvalid' || error._tag === 'TripTooLarge') &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return fallback;
}

type Props = {
  title: string;
  draft: object;
  validation: string | null;
  canSave: boolean;
  onSave: () => Promise<LibraryActionResult>;
  onRemove?: () => Promise<LibraryActionResult>;
  onClose: () => void;
  children: ReactNode;
};

export function PrepSheet({
  title,
  draft,
  validation,
  canSave,
  onSave,
  onRemove,
  onClose,
  children,
}: Props) {
  const titleId = useId();
  const mobile = useLayout() === 'compact';
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ draft: object; message: string } | null>(null);
  const error = failure?.draft === draft ? failure.message : validation;

  function close() {
    if (!busy) onClose();
  }

  async function run(action: () => Promise<LibraryActionResult>) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await action();
    setBusy(false);
    if (result.ok) onClose();
    else {
      setFailure({
        draft,
        message: prepActionError(result.error, '변경을 저장하지 못했어요. 다시 시도해 주세요'),
      });
    }
  }

  const content = (
    <Stack
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && (event.nativeEvent.isComposing || event.keyCode === 229)) {
          event.stopPropagation();
        }
      }}
      sx={{
        gap: 2,
        p: 2,
        pb: mobile ? 'calc(16px + env(safe-area-inset-bottom, 0px))' : 2,
        overflowY: 'auto',
      }}
    >
      <Typography id={titleId} component="h2" variant="h6">
        {title}
      </Typography>
      {children}
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
        {onRemove && (
          <Button
            disabled={busy}
            color="error"
            onClick={() => void run(onRemove)}
            sx={{ minHeight: 44, mr: 'auto' }}
          >
            지우기
          </Button>
        )}
        <Button disabled={busy} onClick={close} sx={{ minHeight: 44 }}>
          닫기
        </Button>
        <Button
          variant="contained"
          disabled={!canSave || busy}
          onClick={() => void run(onSave)}
          sx={{ minHeight: 44 }}
        >
          저장
        </Button>
      </Stack>
    </Stack>
  );

  return mobile ? (
    <Drawer
      anchor="bottom"
      open
      onClose={close}
      slotProps={{
        paper: {
          'aria-labelledby': titleId,
          sx: {
            maxWidth: 480,
            width: '100%',
            maxHeight: 'calc(100dvh - 16px)',
            mx: 'auto',
            borderRadius: 'var(--tm-radius-xl) var(--tm-radius-xl) 0 0',
            bgcolor: 'var(--tm-bg-surface)',
            backgroundImage: 'none',
          },
        },
      }}
    >
      {content}
    </Drawer>
  ) : (
    <Dialog open onClose={close} aria-labelledby={titleId} fullWidth maxWidth="sm">
      {content}
    </Dialog>
  );
}
