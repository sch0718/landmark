import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import { HELP_PAGES } from './help-content';
import { helpText } from './help-text';
import { ResetHelpButton } from './ResetHelpButton';

export function HelpIndexPage() {
  useDocumentTitle('도움말');
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
      <ResetHelpButton />
    </Box>
  );
}
