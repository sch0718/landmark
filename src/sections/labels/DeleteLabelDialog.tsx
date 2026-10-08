import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import type { Label } from 'src/schema/library';

type Props = {
  label: Label;
  /** 이 라벨이 붙은 (살아 있는) 장소 수. */
  placeCount: number;
  onCancel(): void;
  onConfirm(): void;
};

/** 라벨 삭제 확인. 영향받는 장소 수를 보여 준다. 장소는 지워지지 않는다. */
export function DeleteLabelDialog({ label, placeCount, onCancel, onConfirm }: Props) {
  return (
    <Dialog open onClose={onCancel} aria-labelledby="delete-label-title">
      <DialogTitle id="delete-label-title">라벨 지우기</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {`‘${label.name.value}’ 라벨을 지울까요? 장소 ${placeCount}곳에서 이 라벨이 빠져요. 장소는 지워지지 않아요.`}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} sx={{ minHeight: 44 }}>
          취소
        </Button>
        <Button color="error" variant="contained" onClick={onConfirm} sx={{ minHeight: 44 }}>
          지우기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
