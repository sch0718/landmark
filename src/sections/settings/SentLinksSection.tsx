import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { formatShortExpiry } from 'src/domain/share/short-link';
import { shareApi } from 'src/services/share-short/client';
import { sentLinks, type SentShortLink } from 'src/services/share-short/store';

const KIND = { places: '장소', trip: '일정' } as const;

/**
 * 이 기기가 카카오톡으로 보낸 짧은 링크(서버 사본) 목록. 지우면 받은 사람도 더는 열 수 없다.
 * 이미 `Landmark에 담기`로 가져간 것과 보기 화면의 방문 기록은 지워지지 않는다. 다른 기기의 링크는 보이지 않는다.
 */
export function SentLinksSection() {
  const links = useSyncExternalStore(sentLinks.subscribe, sentLinks.list);
  const [busy, setBusy] = useState<string | null>(null);
  if (links.length === 0) return null;

  const remove = async (link: SentShortLink) => {
    setBusy(link.id);
    const result = await shareApi.remove(link.id, link.deleteToken);
    setBusy(null);
    if (result.ok) {
      sentLinks.remove(link.id);
      toast('짧은 링크를 지웠어요');
    } else {
      toast.error(
        result.error === 'offline'
          ? '인터넷 연결을 확인하고 다시 해 주세요'
          : '짧은 링크를 지우지 못했어요. 잠시 뒤 다시 해 주세요',
      );
    }
  };

  const at = new Date();
  return (
    <Box
      component="section"
      aria-label="보낸 짧은 링크"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Typography component="h2" sx={{ fontSize: 15, fontWeight: 800 }}>
        보낸 짧은 링크
      </Typography>
      <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
        카카오톡으로 보낸 링크의 암호화한 사본이에요. 지우면 받은 사람도 더는 열 수 없어요. 이미
        Landmark에 담은 장소는 지워지지 않아요
      </Typography>
      <Box
        component="ul"
        sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        {links.map((link) => (
          <Box
            component="li"
            key={link.id}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44 }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                {link.title}
              </Typography>
              <Typography variant="caption" sx={{ color: 'var(--tm-text-secondary)' }}>
                {`${KIND[link.kind]} · ${formatShortExpiry(new Date(link.createdAt), at)} 보냄 · ${formatShortExpiry(new Date(link.expiresAt), at)}까지`}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              color="error"
              disabled={busy !== null}
              aria-label={`${link.title} 링크 지우기`}
              onClick={() => void remove(link)}
              sx={{ minHeight: 44 }}
            >
              지우기
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
