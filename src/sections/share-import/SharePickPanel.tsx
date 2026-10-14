import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, type ChangeEvent, type DragEvent } from 'react';
import { hasFiles } from 'src/sections/share-import/drag-files';
import { useShareFile } from 'src/sections/share-import/use-share-file';
import { useLayout } from 'src/sections/shell/use-layout';

const TITLE = '공유 파일 가져오기';

/**
 * 공유 파일 고르기 칸(스펙 §2.2). `파일 고르기` 버튼이 숨긴 파일 입력을 연다. 칸이 열리면 이 버튼에
 * 포커스한다(`data-autofocus`, `AddPlaceHost`).
 * 넓은·중간 화면(PC)에서는 칸 자체가 끌어 놓는 자리도 된다(첫 파일만 읽는다). 칸 밖(목록·지도 등)에
 * 놓은 파일도 같은 방법으로 읽어서, `여기로 끌어 놓아도 돼요` 안내를 보고 조금 빗나가게 놓아도 된다.
 * 칸 안에 놓은 것은 칸이 읽고 `window` 쪽은 건너뛰어 한 번 놓을 때 한 번만 읽는다.
 * 읽는 중에는 버튼을 끄고 `읽는 중…`, 실패하면 칸 안에 오류 문구를 보이며 다시 고를 수 있다.
 */
export function SharePickPanel() {
  const { read, reading, error } = useShareFile();
  const droppable = useLayout() !== 'compact';
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const readRef = useRef({ read, reading });
  // `window` 쪽 듣기가 최신 `read`·`reading`을 쓰도록 렌더 뒤에 맞춰 둔다.
  useEffect(() => {
    readRef.current = { read, reading };
  });

  useEffect(() => {
    if (!droppable) return;
    const onWindowDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      if (event.target instanceof Node && boxRef.current?.contains(event.target)) return;
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      const current = readRef.current;
      if (file !== undefined && !current.reading) void current.read(file);
    };
    window.addEventListener('drop', onWindowDrop);
    return () => window.removeEventListener('drop', onWindowDrop);
  }, [droppable]);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 같은 파일을 다시 골라도 `change`가 오도록 비운다.
    event.target.value = '';
    if (file !== undefined && !reading) void read(file);
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (droppable) event.preventDefault();
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!droppable) return;
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file !== undefined && !reading) void read(file);
  };

  return (
    <Box
      component="section"
      aria-label={TITLE}
      ref={boxRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
      sx={{ boxSizing: 'border-box', minHeight: '100%', p: 2 }}
    >
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 800, mb: 1 }}>
        {TITLE}
      </Typography>
      <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)', mb: 2 }}>
        받은 Landmark 공유 파일(.html)을 고르면 장소를 미리 보고 내 보관함에 넣어요
      </Typography>
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm,text/html"
        hidden
        aria-label="공유 파일 선택"
        onChange={onChange}
      />
      <Button
        data-autofocus
        variant="contained"
        disabled={reading}
        onClick={() => inputRef.current?.click()}
        sx={{ minHeight: 44 }}
      >
        파일 고르기
      </Button>
      {reading && (
        <Typography
          role="status"
          variant="body2"
          sx={{ color: 'var(--tm-text-secondary)', mt: 1.5 }}
        >
          읽는 중…
        </Typography>
      )}
      {error !== null && (
        <Typography role="alert" variant="body2" color="error" sx={{ mt: 1.5 }}>
          {error}
        </Typography>
      )}
      {droppable && (
        <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)', mt: 2 }}>
          여기로 끌어 놓아도 돼요
        </Typography>
      )}
    </Box>
  );
}
