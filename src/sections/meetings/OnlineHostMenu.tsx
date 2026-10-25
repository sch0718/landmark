import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import { EllipsisIcon } from 'src/components/icons';
import type { Meeting } from 'src/schema/meeting';
import type { OnlineMeeting } from './use-online-meeting';

type Actions = Pick<
  OnlineMeeting,
  'mode' | 'openOnOtherDevice' | 'releaseParticipant' | 'removeFromServer' | 'reissueHostLink'
>;
export function OnlineHostMenu({ meeting, online }: { meeting: Meeting; online: Actions }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'host' | 'participant' | null>(null);
  if (online.mode !== 'online') return null;
  return (
    <>
      <Box
        component="button"
        type="button"
        aria-label="약속 공유 메뉴"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          width: 44,
          height: 44,
          display: 'grid',
          placeItems: 'center',
          border: 0,
          borderRadius: '50%',
          background: 'transparent',
          color: 'var(--tm-text-secondary)',
          cursor: 'pointer',
          '& svg': { width: 20, height: 20 },
        }}
      >
        <EllipsisIcon aria-hidden="true" />
      </Box>
      <Menu open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)}>
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            setAnchor(null);
            setDialog('host');
          }}
        >
          다른 기기에서 열기
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            setAnchor(null);
            setDialog('participant');
          }}
        >
          참석자 차지 풀기
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 44, color: 'error.main' }}
          onClick={() => {
            setAnchor(null);
            void online.removeFromServer();
          }}
        >
          서버에서 지우기
        </MenuItem>
      </Menu>
      <Dialog open={dialog !== null} onClose={() => setDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{dialog === 'host' ? '다른 기기에서 열기' : '참석자 차지 풀기'}</DialogTitle>
        <DialogContent>
          {dialog === 'host' ? (
            <>
              <p>
                주최자 링크를 가진 기기는 약속을 고칠 수 있어요. 본인의 다른 기기로 보내 주세요.
              </p>
              <Button sx={{ minHeight: 44 }} onClick={() => void online.openOnOtherDevice()}>
                주최자 링크 보내기
              </Button>
              <Button sx={{ minHeight: 44 }} onClick={() => void online.reissueHostLink()}>
                주최자 링크 다시 발급
              </Button>
            </>
          ) : (
            meeting.participants.value.slice(1).map((participant) => (
              <Button
                key={participant.id}
                fullWidth
                sx={{ minHeight: 44 }}
                onClick={() => {
                  setDialog(null);
                  void online.releaseParticipant(participant.id);
                }}
              >
                {participant.name}
              </Button>
            ))
          )}
        </DialogContent>
        <DialogActions>
          <Button sx={{ minHeight: 44 }} onClick={() => setDialog(null)}>
            닫기
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
