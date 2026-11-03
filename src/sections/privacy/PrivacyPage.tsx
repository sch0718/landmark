import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import { helpText } from 'src/sections/help/help-text';
import { PRIVACY_LEAD, PRIVACY_SECTIONS } from './privacy-content';

/** 개인정보 처리방침. 도움말 화면과 같은 틀로 그린다. */
export function PrivacyPage() {
  useDocumentTitle('개인정보 처리방침');
  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', p: 2, color: 'var(--tm-text-primary)' }}>
      <Button component={Link} to={paths.help} sx={{ minHeight: 44 }}>
        ← 도움말
      </Button>
      <Typography component="h1" sx={{ fontSize: 24, fontWeight: 800, my: 2 }}>
        개인정보 처리방침
      </Typography>
      <Typography component="p" sx={{ my: 3 }}>
        {PRIVACY_LEAD.join(' ')}
      </Typography>
      {PRIVACY_SECTIONS.map((section) => (
        <Box component="section" key={section.title} sx={{ mb: 3 }}>
          <Typography component="h2" sx={{ fontSize: 20, fontWeight: 800 }}>
            {section.title}
          </Typography>
          {section.paragraphs?.map((text) => (
            <Typography component="p" key={text} sx={{ my: 1.5, lineHeight: 1.8 }}>
              {helpText(text)}
            </Typography>
          ))}
          {section.items !== undefined && (
            <Box component="ul" sx={{ pl: 3, '& li': { my: 1.5, lineHeight: 1.8 } }}>
              {section.items.map((item) => (
                <li key={item}>{helpText(item)}</li>
              ))}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
