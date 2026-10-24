import Button from '@mui/material/Button';
import { toast } from 'sonner';
import { helpSeen } from 'src/services/help-seen';

export function ResetHelpButton() {
  return (
    <Button
      variant="outlined"
      sx={{ minHeight: 44 }}
      onClick={() => {
        helpSeen.reset();
        toast('처음 안내를 다시 보여 드릴게요');
      }}
    >
      처음 안내 다시 보기
    </Button>
  );
}
