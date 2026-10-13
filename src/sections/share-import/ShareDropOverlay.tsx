import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { matchPath, useLocation } from 'react-router';
import { toast } from 'sonner';
import { paths } from 'src/routes/paths';
import { hasFiles } from 'src/sections/share-import/drag-files';
import { useShareFile } from 'src/sections/share-import/use-share-file';
import { useLayout } from 'src/sections/shell/use-layout';
import { addFlowAtom } from 'src/stores/add-place';

/**
 * PC 끌어 놓기 덮개(스펙 §2.1-4). 넓은·중간 화면의 보관함(`/`, `/map`)에서 추가 흐름이 닫혀 있을 때만
 * `window`의 끌기 이벤트를 듣는다. 파일을 끌어 오면 화면 전체에 안내를 띄우고, 놓으면 첫 파일을
 * 읽는다. 읽기에 실패하면 토스트로 알린다. 흐름이 열려 있으면 듣지 않는다
 * (`공유 파일 고르기` 칸이 스스로 받는다). 끌고 있지 않을 때는 아무것도 그리지 않는다.
 * 넓은·중간 화면이면 그 밖의 경우(다른 화면, 미리보기 중 등)에도 파일 끌기의 `dragover`·`drop` 기본 동작만
 * 막는다. 안 막으면 브라우저가 놓은 파일을 열어 앱을 떠나 버린다(읽지는 않는다).
 */
export function ShareDropOverlay() {
  const wide = useLayout() !== 'compact';
  const { pathname } = useLocation();
  const closed = useAtomValue(addFlowAtom).step === 'closed';
  const onLibrary =
    matchPath(paths.library, pathname) !== null || matchPath(paths.map, pathname) !== null;
  const active = wide && onLibrary && closed;

  const { read, reading } = useShareFile();
  const readRef = useRef({ read, reading });
  // 끌기 이벤트 쪽에서 최신 `read`·`reading`을 쓰도록 렌더 뒤에 맞춰 둔다.
  useEffect(() => {
    readRef.current = { read, reading };
  });

  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!wide) return;
    // `dragover`를 막아야 놓을 수 있는 자리가 되어 `drop`이 오고, `drop`을 막아야 브라우저가 파일을 열지 않는다.
    const intercept = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    window.addEventListener('dragover', intercept);
    window.addEventListener('drop', intercept);
    return () => {
      window.removeEventListener('dragover', intercept);
      window.removeEventListener('drop', intercept);
    };
  }, [wide]);

  useEffect(() => {
    if (!active) return;
    // 자식 요소를 넘나들 때마다 enter/leave가 짝으로 오므로 세어서 0이 될 때만 내린다.
    let depth = 0;
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      reset();
      const file = event.dataTransfer?.files[0];
      const current = readRef.current;
      if (file === undefined || current.reading) return;
      void current.read(file).then((message) => {
        if (message !== null) toast(message);
      });
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      reset();
    };
  }, [active]);

  if (!active || !dragging) return null;
  return (
    <Box
      role="presentation"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1500,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(0, 0, 0, 0.45)',
      }}
    >
      <Typography
        variant="h6"
        sx={{
          px: 4,
          py: 3,
          borderRadius: 2,
          border: '2px dashed var(--tm-border)',
          bgcolor: 'var(--tm-bg-surface)',
          color: 'var(--tm-text-primary)',
          fontWeight: 800,
        }}
      >
        여기에 놓으면 가져와요
      </Typography>
    </Box>
  );
}
