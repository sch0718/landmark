import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';

export const NICKNAME_MAX = 20;

type Props = {
  open: boolean;
  title?: string;
  description?: string;
  initialValue?: string;
  onSubmit: (nickname: string) => void;
  onCancel: () => void;
};

/** 첫 편집 시 닉네임을 받는다(§4.5). 닫힐 때 내용이 초기화되도록 열 때마다 새로 마운트한다. */
export function NicknameDialog(props: Props) {
  return (
    <Dialog open={props.open} onClose={props.onCancel} fullWidth maxWidth="xs">
      {props.open && <NicknameForm {...props} />}
    </Dialog>
  );
}

function NicknameForm({
  title = '닉네임 입력',
  description = '메모와 편집에 표시할 이름이에요.',
  initialValue = '',
  onSubmit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const valid = trimmed.length > 0 && trimmed.length <= NICKNAME_MAX;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSubmit(trimmed);
  };

  return (
    <form onSubmit={submit}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{description}</DialogContentText>
        <TextField
          autoFocus
          fullWidth
          label="닉네임"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          slotProps={{ htmlInput: { maxLength: NICKNAME_MAX } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>취소</Button>
        <Button type="submit" variant="contained" disabled={!valid}>
          저장
        </Button>
      </DialogActions>
    </form>
  );
}
