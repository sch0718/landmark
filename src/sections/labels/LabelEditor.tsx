import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useId, useState, type KeyboardEvent } from 'react';
import { fieldSx } from 'src/components/field-style';
import { renameLabel, setLabelColor, setLabelIcon } from 'src/domain/library/ops';
import { localDate } from 'src/lib/local-date';
import { LIBRARY_LIMITS, type FolderLink, type Label } from 'src/schema/library';
import { ColorPicker } from 'src/sections/labels/ColorPicker';
import { IconPicker } from 'src/sections/labels/IconPicker';
import { labelRejectionMessage } from 'src/sections/labels/rejection-message';
import { useLibraryAction } from 'src/stores/library-state';

type Props = {
  label: Label;
  /** 합칠 다른 라벨이 있는가. 없으면 합치기 버튼을 끈다. */
  canMerge: boolean;
  onClose(): void;
  onMerge(): void;
  onDelete(): void;
  /** 이 라벨에 연결된 살아 있는 네이버 폴더(이름순). 비면 `네이버 폴더` 구역을 그리지 않는다. */
  folders: readonly FolderLink[];
  /** 그 폴더의 다시 가져오기를 연다. */
  onResync(shareId: string): void;
  /** 그 폴더의 연결을 끊는다. */
  onUnlink(shareId: string): void;
};

/** 라벨 고치기의 `네이버 폴더` 구역(스펙 §4.2): 폴더마다 이름·확인한 날짜·다시 가져오기·연결 끊기. */
function FolderSection({
  folders,
  onResync,
  onUnlink,
}: Pick<Props, 'folders' | 'onResync' | 'onUnlink'>) {
  const titleId = useId();
  return (
    <Box component="section" aria-labelledby={titleId}>
      <Box component="h3" id={titleId} sx={{ m: 0, fontSize: 15, fontWeight: 700 }}>
        네이버 폴더
      </Box>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {folders.map((folder) => {
          const name = folder.name.value === '' ? '이름 없는 폴더' : folder.name.value;
          return (
            <Box component="li" key={folder.shareId} sx={{ mt: 1 }}>
              <Box sx={{ overflowWrap: 'anywhere' }}>{name}</Box>
              <Box sx={{ fontSize: 13, color: 'var(--tm-text-secondary)' }}>
                {`${localDate(folder.checkedAt)} 확인`}
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                <Button
                  variant="outlined"
                  aria-label={`‘${name}’에서 새로 저장한 곳 가져오기`}
                  onClick={() => onResync(folder.shareId)}
                  sx={{ minHeight: 44 }}
                >
                  새로 저장한 곳 가져오기
                </Button>
                <Button
                  aria-label={`‘${name}’ 연결 끊기`}
                  onClick={() => onUnlink(folder.shareId)}
                  sx={{ minHeight: 44 }}
                >
                  연결 끊기
                </Button>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * 라벨 하나를 고치는 대화상자: 이름·색·아이콘. 색과 아이콘은 누르는 즉시 저장하고, 이름은
 * 엔터·포커스 이동·닫을 때 저장한다. 이름이 거절되면(빈 이름·중복) 입력란 아래에 이유를 보이고 열어 둔다.
 * 연결된 네이버 폴더가 있으면 아이콘 아래에 `네이버 폴더` 구역을 둔다.
 */
export function LabelEditor({
  label,
  canMerge,
  onClose,
  onMerge,
  onDelete,
  folders,
  onResync,
  onUnlink,
}: Props) {
  const { run } = useLibraryAction();
  const [name, setName] = useState(label.name.value);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  /** 이름을 저장한다. 바뀐 게 없거나 저장됐으면 true, 거절되면 false. */
  const commitName = async (): Promise<boolean> => {
    if (name.trim() === label.name.value) {
      setName(label.name.value);
      setError(null);
      return true;
    }
    const result = await run((lib, ctx) => renameLabel(lib, label.id, name, ctx));
    if (result.ok) {
      setError(null);
      return true;
    }
    setError(labelRejectionMessage(result.error));
    return false;
  };

  const close = async () => {
    if (await commitName()) onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 한글 조합 중의 Enter는 글자를 확정하는 키라서 건너뛴다.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void commitName();
  };

  return (
    <Dialog
      open
      onClose={() => void close()}
      aria-labelledby="label-editor-title"
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle id="label-editor-title">라벨 고치기</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Box
            component="input"
            type="text"
            aria-label="라벨 이름"
            autoComplete="off"
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : errorId}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onBlur={() => void commitName()}
            onKeyDown={onKeyDown}
            sx={fieldSx({ invalid: error !== null })}
          />
          {error !== null && (
            <Box id={errorId} role="alert" sx={{ mt: 0.5, fontSize: 12, color: 'error.main' }}>
              {error}
            </Box>
          )}
          <Box sx={{ mt: 0.5, fontSize: 12, color: 'var(--tm-text-muted)' }}>
            {`최대 ${LIBRARY_LIMITS.labelNameChars}자`}
          </Box>
        </Box>
        <ColorPicker
          value={label.color.value}
          onChange={(color) => void run((lib, ctx) => setLabelColor(lib, label.id, color, ctx))}
        />
        <IconPicker
          value={label.icon.value}
          color={label.color.value}
          onChange={(icon) => void run((lib, ctx) => setLabelIcon(lib, label.id, icon, ctx))}
        />
        {folders.length > 0 && (
          <FolderSection folders={folders} onResync={onResync} onUnlink={onUnlink} />
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Button disabled={!canMerge} onClick={onMerge} sx={{ minHeight: 44 }}>
            합치기
          </Button>
          <Button color="error" onClick={onDelete} sx={{ minHeight: 44 }}>
            지우기
          </Button>
        </Box>
        <Button variant="contained" onClick={() => void close()} sx={{ minHeight: 44 }}>
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
