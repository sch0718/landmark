import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import { HELP_PAGES } from './help-content';
import { helpText } from './help-text';
import { RELEASE_NOTES } from './release-notes';
import { ResetHelpButton } from './ResetHelpButton';

export function HelpIndexPage() {
  useDocumentTitle('도움말');
  const { hash } = useLocation();
  // 「업데이트했어요 › 바뀐 점」으로 오면 그 절로 옮긴다.
  useEffect(() => {
    if (hash === '#release-notes') document.getElementById('release-notes')?.scrollIntoView?.();
  }, [hash]);
  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', p: 2 }}>
      <Typography component="h1" sx={{ fontSize: 24, fontWeight: 800 }}>
        도움말
      </Typography>
      <Typography sx={{ my: 2 }}>궁금한 메뉴를 골라 그림과 함께 사용법을 살펴보세요.</Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 2,
          mb: 3,
        }}
      >
        {HELP_PAGES.map((page) => (
          <Box
            key={page.id}
            component={Link}
            to={paths.helpPage(page.id)}
            sx={{
              display: 'block',
              p: 2,
              border: '1px solid var(--tm-border)',
              borderRadius: 'var(--tm-radius-md)',
              bgcolor: 'var(--tm-bg-surface)',
              color: 'var(--tm-text-primary)',
              textDecoration: 'none',
              '&:hover': { bgcolor: 'var(--tm-bg-raised)' },
            }}
          >
            <Typography component="h2" sx={{ fontSize: 20, fontWeight: 800, mb: 1 }}>
              {page.title}
            </Typography>
            <Typography component="p" sx={{ my: 1 }}>
              {helpText(page.lead.join(' '))}
            </Typography>
            <Typography component="p" variant="body2">
              {helpText(page.steps.map((step) => step.title).join(' → '))}
            </Typography>
          </Box>
        ))}
      </Box>
      <Box component="section" aria-labelledby="release-notes" sx={{ mb: 3 }}>
        <Typography id="release-notes" component="h2" sx={{ fontSize: 20, fontWeight: 800, mb: 1 }}>
          최근 바뀐 점
        </Typography>
        {RELEASE_NOTES.slice(0, 3).map((note) => (
          <Box key={note.version} sx={{ mb: 2 }}>
            <Typography component="p" sx={{ fontWeight: 700 }}>
              {note.version}{' '}
              <Typography
                component="time"
                dateTime={note.date}
                variant="body2"
                color="text.secondary"
              >
                {note.date}
              </Typography>
            </Typography>
            <Box component="ul" sx={{ my: 0.5, pl: 3 }}>
              {note.items.map((item, i) => (
                <li key={i}>{helpText(item)}</li>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <ResetHelpButton />
        <Button component={Link} to={paths.privacy} variant="outlined" sx={{ minHeight: 44 }}>
          개인정보 처리방침
        </Button>
      </Box>
    </Box>
  );
}
