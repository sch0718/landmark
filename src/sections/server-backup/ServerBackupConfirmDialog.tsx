import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useId } from 'react';
export function ServerBackupConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  busy,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm(): void;
  onClose(): void;
  busy: boolean;
}) {
  const id = useId();
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      aria-labelledby={id}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle id={id}>{title}</DialogTitle>
      <DialogContent>
        <Typography>{body}</Typography>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose} sx={{ minHeight: 44 }}>
          취소
        </Button>
        <Button disabled={busy} onClick={onConfirm} sx={{ minHeight: 44 }}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
