import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

type Props = {
  open: boolean;
  message: string;
  onCancel(): void;
  onConfirm(): void;
};

/** 날짜 묶음 되돌리기 확인(§5.8). */
export function RevertDialog({ open, message, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={open} onClose={onCancel} aria-labelledby="revert-dialog-title">
      <DialogTitle id="revert-dialog-title">원본 일정으로 되돌리기</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>취소</Button>
        <Button color="warning" variant="contained" onClick={onConfirm}>
          되돌리기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
