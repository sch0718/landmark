import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { LegacySource } from 'src/domain/library/legacy-import';
import { ImportPreview } from 'src/sections/settings/ImportPreview';
import { loadLegacySource, type SourceInput } from 'src/sections/settings/import-effects';

/** `/t/<publicId>` 링크(전체 주소 가능) 또는 publicId 자체에서 publicId를 꺼낸다. */
export function parsePublicId(input: string): string {
  const text = input.trim();
  return /\/t\/([^/?#\s]+)/.exec(text)?.[1] ?? text;
}

type Props = {
  open: boolean;
  onClose(): void;
  /** 가져오기가 끝났다. */
  onImported(added: number): void;
};

const FIELD_SX = {
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  minHeight: 44,
  px: 1.25,
  border: '1px solid var(--tm-border)',
  borderRadius: 'var(--tm-radius-md)',
  bgcolor: 'var(--tm-bg-raised)',
  color: 'var(--tm-text-primary)',
  font: 'inherit',
  fontSize: 16,
  '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 1 },
} as const;

/**
 * 옛 여행 가져오기 대화상자. 입력은 `.json` 파일 선택 또는 `/t/<publicId>` 링크 붙여넣기이고,
 * 읽기 오류는 대화상자 안에 보인다. 읽으면 같은 대화상자에 미리보기가 나온다.
 */
export function LegacyImportDialog({ open, onClose, onImported }: Props) {
  const [source, setSource] = useState<LegacySource | null>(null);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const load = async (input: SourceInput) => {
    setLoading(true);
    setError(null);
    const result = await loadLegacySource(input);
    setLoading(false);
    if (result.ok) setSource(result.source);
    else setError(result.message);
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 같은 파일을 다시 고를 수 있게 비운다.
    event.target.value = '';
    if (file !== undefined) void load({ kind: 'file', file });
  };

  const onSubmitLink = (event: FormEvent) => {
    event.preventDefault();
    void load({ kind: 'publicId', id: parsePublicId(link) });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      fullWidth
      maxWidth="sm"
      slotProps={{ transition: { onExited: () => setSource(null) } }}
    >
      <DialogTitle id={titleId}>옛 여행 가져오기</DialogTitle>
      <DialogContent>
        {source === null ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
              예전 여행 데이터(.json)나 배포된 여행 링크로 장소와 라벨을 보관함에 가져와요.
            </Typography>
            <Box>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                aria-label="파일 선택(.json)"
                hidden
                onChange={onFile}
              />
              <Button
                variant="outlined"
                disabled={loading}
                onClick={() => fileInput.current?.click()}
                sx={{ minHeight: 44 }}
              >
                파일 선택(.json)
              </Button>
            </Box>
            <Box
              component="form"
              onSubmit={onSubmitLink}
              sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}
            >
              <Box
                component="input"
                type="text"
                aria-label="링크 붙여넣기"
                placeholder="/t/여행ID 또는 여행ID"
                autoComplete="off"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                sx={FIELD_SX}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={loading || link.trim() === ''}
                sx={{ minHeight: 44, flex: 'none' }}
              >
                불러오기
              </Button>
            </Box>
            {error !== null && (
              <Typography role="alert" variant="body2" color="error">
                {error}
              </Typography>
            )}
          </Box>
        ) : (
          <ImportPreview source={source} onImported={onImported} />
        )}
      </DialogContent>
      <DialogActions>
        {source !== null && (
          <Button onClick={() => setSource(null)} sx={{ minHeight: 44 }}>
            다시 고르기
          </Button>
        )}
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
