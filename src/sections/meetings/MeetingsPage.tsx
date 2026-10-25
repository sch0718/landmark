import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { HelpButton } from 'src/components/HelpButton';
import { EllipsisIcon } from 'src/components/icons';
import { deleteMeeting, restoreMeeting } from 'src/domain/meeting/ops';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import { EmptyState } from 'src/sections/library/EmptyState';
import { MeetingFormDialog } from 'src/sections/meetings/MeetingFormDialog';
import { readOnline } from 'src/services/meet-online/store';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

const MODE_LABEL = { transit: '대중교통', car: '자동차', straight: '직선거리' };

/** 저장한 약속 목록. 삭제는 묘비를 남기고 알림에서 되돌릴 수 있다. */
export function MeetingsPage() {
  useDocumentTitle('약속');
  const library = useAtomValue(libraryAtom);
  const { run } = useLibraryAction();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const meetings = Object.values(library.meetings ?? {})
    .filter((meeting) => meeting.deletedAt === null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const deletingMeeting = deleting === null ? undefined : library.meetings?.[deleting];
  const confirmDelete = async () => {
    if (deletingMeeting === undefined) return;
    const { id } = deletingMeeting;
    const title = deletingMeeting.title.value;
    let fresh = false;
    const result = await run((lib, ctx) => {
      fresh = lib.meetings?.[id]?.deletedAt === null;
      return deleteMeeting(lib, id, ctx);
    });
    if (!result.ok) return;
    setDeleting(null);
    if (fresh)
      toast(`‘${title}’ 약속을 지웠어요`, {
        duration: 8000,
        action: {
          label: '되돌리기',
          onClick: () => void run((lib, ctx) => restoreMeeting(lib, id, ctx)),
        },
      });
  };
  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', px: 2, py: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box component="h1" sx={{ m: 0, fontSize: 20, fontWeight: 800 }}>
          약속
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <HelpButton page="meetings" />
          {meetings.length > 0 && (
            <Button variant="contained" onClick={() => setCreating(true)} sx={{ minHeight: 44 }}>
              새 약속
            </Button>
          )}
        </Box>
      </Box>
      {meetings.length === 0 ? (
        <EmptyState
          title="아직 약속이 없어요"
          actionLabel="새 약속"
          onAction={() => setCreating(true)}
        />
      ) : (
        <Box component="ul" aria-label="약속 목록" sx={{ m: 0, p: 0 }}>
          {meetings.map((meeting) => {
            const record = readOnline(meeting.id);
            const sharing = record?.ended ? '공유 끝남' : record?.hostToken ? '공유 중' : null;
            const at = meeting.at.value;
            const info = `${at === null ? '일시 미정' : `${at.date.replaceAll('-', '.')} ${at.time}`} · ${MODE_LABEL[meeting.mode.value]}`;
            const counts = `참석자 ${meeting.participants.value.length}명 · 후보 ${meeting.candidates.value.length}곳`;
            const decided = meeting.candidates.value.find(
              (candidate) => candidate.id === meeting.decided.value,
            );
            return (
              <Box
                component="li"
                key={meeting.id}
                sx={{
                  position: 'relative',
                  listStyle: 'none',
                  mb: 1.25,
                  border: '1px solid var(--tm-border)',
                  borderRadius: 'var(--tm-radius-md)',
                  bgcolor: 'var(--tm-bg-raised)',
                }}
              >
                <Box
                  component={Link}
                  to={paths.meeting(meeting.id)}
                  aria-label={`${meeting.title.value}, ${info}, ${counts}${decided === undefined ? '' : `, 확정: ${decided.name}`}`}
                  sx={{
                    display: 'block',
                    minHeight: 44,
                    py: 1.5,
                    pl: 2,
                    pr: 7,
                    borderRadius: 'inherit',
                    color: 'inherit',
                    textDecoration: 'none',
                    '&:focus-visible': { outlineOffset: -2 },
                  }}
                >
                  <Box
                    component="h2"
                    sx={{ m: 0, fontSize: 16, fontWeight: 800, overflowWrap: 'anywhere' }}
                  >
                    {meeting.title.value}
                  </Box>
                  <Box sx={{ mt: 0.5, fontSize: 13, color: 'var(--tm-text-secondary)' }}>
                    {info}
                  </Box>
                  <Box sx={{ mt: 0.25, fontSize: 13, color: 'var(--tm-text-secondary)' }}>
                    {counts}
                  </Box>
                  {sharing && <Box sx={{ mt: 0.5, fontSize: 13 }}>{sharing}</Box>}
                  {decided !== undefined && (
                    <Box sx={{ mt: 0.5, fontSize: 13, fontWeight: 700 }}>확정: {decided.name}</Box>
                  )}
                </Box>
                <Box
                  component="button"
                  type="button"
                  aria-label={`‘${meeting.title.value}’ 메뉴`}
                  aria-haspopup="menu"
                  onClick={(event) => setMenu({ id: meeting.id, anchor: event.currentTarget })}
                  sx={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
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
              </Box>
            );
          })}
        </Box>
      )}
      <Menu open={menu !== null} anchorEl={menu?.anchor} onClose={() => setMenu(null)}>
        <MenuItem
          sx={{ minHeight: 44, color: 'error.main' }}
          onClick={() => {
            setDeleting(menu?.id ?? null);
            setMenu(null);
          }}
        >
          삭제
        </MenuItem>
      </Menu>
      <MeetingFormDialog
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
        onDone={(id) => void navigate(paths.meeting(id))}
      />
      {deletingMeeting !== undefined && (
        <Dialog open onClose={() => setDeleting(null)} aria-labelledby="delete-meeting-title">
          <DialogTitle id="delete-meeting-title">약속 지우기</DialogTitle>
          <DialogContent>
            <DialogContentText>{`‘${deletingMeeting.title.value}’ 약속을 지울까요?`}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleting(null)} sx={{ minHeight: 44 }}>
              취소
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => void confirmDelete()}
              sx={{ minHeight: 44 }}
            >
              삭제
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
