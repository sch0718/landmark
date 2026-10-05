import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { useAtomValue, useSetAtom } from 'jotai';
import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { NicknameDialog } from 'src/components/NicknameDialog';
import type { ImportInput } from 'src/repositories/import-flow';
import { useHashImport } from 'src/sections/share/use-hash-import';
import { ExportDialog } from 'src/sections/share/view/ExportDialog';
import { ImportDialog } from 'src/sections/share/view/ImportDialog';
import { useEditActions, useTripStore } from 'src/stores/trip-store';

export function TripShareControls({ icon }: { icon: ReactNode }) {
  const ts = useTripStore();
  const edit = useAtomValue(ts.editLayerAtom);
  const renameNickname = useSetAtom(ts.renameNicknameAtom);
  const { ensureAuthor } = useEditActions();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<{ seq: number; input: ImportInput } | null>(null);
  const storageUnavailable = useAtomValue(ts.storageUnavailableAtom);
  const fileInput = useRef<HTMLInputElement>(null);

  const startImport = (input: ImportInput) =>
    setImporting((prev) => ({ seq: (prev?.seq ?? 0) + 1, input }));
  useHashImport(startImport);

  const openRename = () => {
    setMenuAnchor(null);
    if (edit) setRenaming(true);
    else ensureAuthor().catch(reportSaveError);
  };

  return (
    <>
      <IconButton aria-label="설정" onClick={(e) => setMenuAnchor(e.currentTarget)}>
        {icon}
      </IconButton>
      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={openRename}>닉네임 변경</MenuItem>
        <MenuItem
          data-emphasized={storageUnavailable ? 'true' : 'false'}
          onClick={() => {
            setMenuAnchor(null);
            setExporting(true);
          }}
          sx={storageUnavailable ? { fontWeight: 700, color: 'primary.main' } : undefined}
        >
          {storageUnavailable ? (
            <Box>
              내보내기
              <Typography variant="caption" component="div" color="text.secondary">
                이 브라우저에는 저장되지 않아요
              </Typography>
            </Box>
          ) : (
            '내보내기'
          )}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            fileInput.current?.click();
          }}
        >
          파일 가져오기
        </MenuItem>
      </Menu>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="편집 파일 선택"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) startImport({ kind: 'file', file });
        }}
      />
      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
      {importing && (
        <ImportDialog
          key={importing.seq}
          input={importing.input}
          onClose={() => setImporting(null)}
        />
      )}
      <NicknameDialog
        open={renaming}
        title="닉네임 변경"
        initialValue={edit ? (edit.authors[edit.authorId]?.nickname ?? '') : ''}
        onCancel={() => setRenaming(false)}
        onSubmit={(nickname) => {
          setRenaming(false);
          renameNickname(nickname).catch(reportSaveError);
        }}
      />
    </>
  );
}

function reportSaveError(e: unknown) {
  console.warn('편집을 저장하지 못했어요', e);
  toast.error('편집을 저장하지 못했어요');
}
