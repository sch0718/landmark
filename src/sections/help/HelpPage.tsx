import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Link, useParams } from 'react-router';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import { HELP_PAGES } from './help-content';
import { helpText } from './help-text';
import { HelpFigure } from './HelpFigure';

export function HelpPage() {
  const { id } = useParams();
  const index = HELP_PAGES.findIndex((page) => page.id === id);
  const page = HELP_PAGES[index];
  useDocumentTitle(page === undefined ? '도움말을 찾을 수 없어요' : `${page.title} 도움말`);
  const previous = HELP_PAGES[index - 1];
  const next = HELP_PAGES[index + 1];
  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', p: 2, color: 'var(--tm-text-primary)' }}>
      <Button component={Link} to={paths.help} sx={{ minHeight: 44 }}>
        ← 도움말
      </Button>
      {page === undefined ? (
        <Box role="alert" sx={{ py: 4 }}>
          <Typography component="h1" sx={{ fontSize: 24, fontWeight: 800 }}>
            도움말을 찾을 수 없어요
          </Typography>
        </Box>
      ) : (
        <>
          <Typography component="h1" sx={{ fontSize: 24, fontWeight: 800, my: 2 }}>
            {page.title}
          </Typography>
          <HelpFigure page={page} />
          <Typography component="p" sx={{ my: 3 }}>
            {helpText(page.lead.join(' '))}
          </Typography>
          <Typography component="h2" sx={{ fontSize: 20, fontWeight: 800 }}>
            이렇게 써요
          </Typography>
          <Box component="ol" sx={{ pl: 3, '& li': { my: 2 } }}>
            {page.steps.map((step) => (
              <li key={step.title}>
                <Box component="strong" sx={{ fontWeight: 700 }}>
                  {helpText(step.title)}
                </Box>
                <Typography component="p" sx={{ mt: 0.5 }}>
                  {helpText(step.sub)}
                </Typography>
              </li>
            ))}
          </Box>
          <Typography component="h2" sx={{ fontSize: 20, fontWeight: 800 }}>
            알아 두면 좋아요
          </Typography>
          <Box component="ul" sx={{ pl: 3, '& li': { my: 1.5, lineHeight: 1.8 } }}>
            {page.tips.map((tip) => (
              <li key={tip}>{helpText(tip)}</li>
            ))}
          </Box>
          <Box
            component="nav"
            aria-label="다른 메뉴 도움말"
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: 1,
              mt: 3,
            }}
          >
            {previous !== undefined && (
              <Button component={Link} to={paths.helpPage(previous.id)} sx={{ minHeight: 44 }}>
                ← 이전: {previous.title}
              </Button>
            )}
            {next !== undefined && (
              <Button component={Link} to={paths.helpPage(next.id)} sx={{ minHeight: 44 }}>
                다음: {next.title} →
              </Button>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
