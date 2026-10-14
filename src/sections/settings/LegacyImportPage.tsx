import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { LegacySource } from 'src/domain/library/legacy-import';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import { ImportPreview } from 'src/sections/settings/ImportPreview';
import { loadLegacySource } from 'src/sections/settings/import-effects';

type State =
  | { status: 'loading' }
  | { status: 'ready'; source: LegacySource }
  | { status: 'missing'; message: string };

/** `/t/:publicId`: 배포된 옛 여행을 읽어 가져오기 미리보기를 한 페이지로 보여 준다. */
export function LegacyImportPage() {
  useDocumentTitle('옛 여행 가져오기');
  const { publicId = '' } = useParams();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<{ publicId: string; state: State } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadLegacySource({ kind: 'publicId', id: publicId }).then((result) => {
      if (cancelled) return;
      setLoaded({
        publicId,
        state: result.ok
          ? { status: 'ready', source: result.source }
          : { status: 'missing', message: result.message },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  // 다른 링크로 바뀐 직후에는 이전 결과를 보이지 않는다.
  const state: State = loaded?.publicId === publicId ? loaded.state : { status: 'loading' };

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', px: 2, py: 2 }}>
      {state.status === 'loading' && <Typography role="status">불러오는 중…</Typography>}
      {state.status === 'missing' && (
        <Box role="alert" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography component="h1" sx={{ fontSize: 20, fontWeight: 800 }}>
            이 링크의 여행을 찾지 못했어요
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
            {state.message}
          </Typography>
          <Box>
            <Button component={Link} to={paths.library} variant="outlined" sx={{ minHeight: 44 }}>
              보관함으로
            </Button>
          </Box>
        </Box>
      )}
      {state.status === 'ready' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography
            component="h1"
            sx={{ fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}
          >
            {state.source.trip.title}
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
            이 여행의 장소와 라벨을 보관함으로 가져와요. 일정은 가져오지 않아요.
          </Typography>
          <ImportPreview
            key={publicId}
            source={state.source}
            onImported={() => void navigate(paths.library)}
          />
        </Box>
      )}
    </Box>
  );
}
