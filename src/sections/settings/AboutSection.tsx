import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { ExternalLinkIcon } from 'src/components/icons';
import { COPYRIGHT, KOFI_URL, LICENSE_URL, NOTICES_PATH, SOURCE_URL } from 'src/config/about';

interface Props {
  /** 후원 주소. 비어 있으면 후원 링크를 숨긴다(기본은 설정 상수). */
  readonly kofiUrl?: string;
}

const LINK_SX = { minHeight: 44 } as const;

function OutLink({ href, children }: { href: string; children: string }) {
  return (
    <Button
      component="a"
      href={href}
      target="_blank"
      rel="noopener"
      variant="outlined"
      endIcon={<ExternalLinkIcon aria-hidden />}
      sx={LINK_SX}
    >
      {children}
    </Button>
  );
}

/** 설정 › 이 앱에 대해: 저작권·라이선스·오픈소스 고지·(있으면) 후원 링크. */
export function AboutSection({ kofiUrl = KOFI_URL }: Props) {
  return (
    <>
      <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
        {`${COPYRIGHT} · 소스는 공개돼 있고 개인·비상업 용도로 쓸 수 있어요(PolyForm Noncommercial 1.0.0).`}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <OutLink href={LICENSE_URL}>라이선스</OutLink>
        <OutLink href={NOTICES_PATH}>오픈소스 고지</OutLink>
        <OutLink href={SOURCE_URL}>소스 코드</OutLink>
        {kofiUrl.trim() !== '' && <OutLink href={kofiUrl}>Ko-fi로 후원하기</OutLink>}
      </Box>
    </>
  );
}
