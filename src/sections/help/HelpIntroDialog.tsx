import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useId } from 'react';
import { Link } from 'react-router';
import { paths } from 'src/routes/paths';
import { HELP_PAGES, type HelpPageId } from './help-content';
import { helpText } from './help-text';
import { HelpFigure } from './HelpFigure';

export function HelpIntroDialog({
  pageId,
  open,
  onClose,
}: {
  pageId: HelpPageId;
  open: boolean;
  onClose(): void;
}) {
  const titleId = useId();
  const page = HELP_PAGES.find((item) => item.id === pageId)!;
  return (
    <Dialog
      data-dialog-kind="help-intro"
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      fullWidth
      maxWidth="sm"
      sx={{
        '@media (max-width:767px)': {
          '& .MuiDialog-container': { alignItems: 'flex-end' },
          '& .MuiDialog-paper': { m: 1, width: 'calc(100% - 16px)' },
        },
      }}
    >
      <DialogTitle id={titleId}>{page.title}</DialogTitle>
      <DialogContent>
        <HelpFigure page={page} compact />
        <Typography component="p" sx={{ mt: 2 }}>
          {helpText(page.lead.join(' '))}
        </Typography>
        <Box component="ol" sx={{ pl: 3, '& li': { my: 1 } }}>
          {page.steps.map((step) => (
            <li key={step.title}>{helpText(step.title)}</li>
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button
          component={Link}
          to={paths.helpPage(pageId)}
          onClick={onClose}
          sx={{ minHeight: 44 }}
        >
          도움말 자세히
        </Button>
        <Button variant="contained" onClick={onClose} sx={{ minHeight: 44 }}>
          시작하기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
