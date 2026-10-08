import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { encodeEditLayer } from 'src/domain/codec';
import { serializeEditLayerFile, type EditLayer } from 'src/schema/legacy/edit-layer';
import {
  buildExportLink,
  exportFileName,
  isLinkOverLimit,
  isLinkTooLong,
} from 'src/sections/share/store/export-link';
import { useTripStore } from 'src/stores/trip-store';

type Props = { open: boolean; onClose(): void };

/** 링크·파일 내보내기(§5.2). 열 때마다 내용을 새로 마운트한다. */
export function ExportDialog({ open, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="export-title">
      {open && <ExportContent onClose={onClose} />}
    </Dialog>
  );
}

type LinkState = { status: 'pending' } | { status: 'ready'; link: string } | { status: 'error' };
type ShareStatus = 'idle' | 'shared' | 'copied' | 'manual';

function ExportContent({ onClose }: { onClose(): void }) {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const [link, setLink] = useState<LinkState>({ status: 'pending' });
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle');

  useEffect(() => {
    if (!edit) return;
    let cancelled = false;
    encodeEditLayer(edit).then(
      (encoded) => {
        if (!cancelled) {
          setLink({
            status: 'ready',
            link: buildExportLink(window.location.origin, ts.publicId, encoded),
          });
        }
      },
      (e: unknown) => {
        console.warn('내보내기 링크를 만들지 못했어요', e);
        if (!cancelled) setLink({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [edit, ts.publicId]);

  const ready = link.status === 'ready' ? link.link : null;
  const tooLong = ready !== null && isLinkTooLong(ready);
  // 16,000자를 넘으면 받는 쪽이 해석하지 못하므로 링크 공유·복사를 막고 파일만 남긴다.
  const overLimit = ready !== null && isLinkOverLimit(ready);

  const shareLink = async () => {
    if (ready === null || overLimit) return;
    setShareStatus('idle');
    const nav = navigator as Partial<Navigator>;
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: trip?.title, url: ready });
        setShareStatus('shared');
        return;
      } catch (e) {
        // 사용자가 공유 시트를 닫은 것은 실패가 아니다.
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      if (typeof nav.clipboard?.writeText !== 'function') throw new Error('clipboard 없음');
      await nav.clipboard.writeText(ready);
      setShareStatus('copied');
    } catch {
      setShareStatus('manual');
    }
  };

  const downloadFile = () => {
    if (!edit || !trip) return;
    downloadEdit(edit, exportFileName(trip.title, nicknameOf(edit), new Date(ts.repoDeps.now())));
  };

  return (
    <>
      <DialogTitle id="export-title">편집 내보내기</DialogTitle>
      <DialogContent>
        {!edit ? (
          <DialogContentText>
            아직 내보낼 편집이 없어요. 메모나 일정을 편집한 뒤 내보내 주세요.
          </DialogContentText>
        ) : (
          <Stack spacing={2}>
            <DialogContentText>
              링크나 파일로 동행에게 편집을 전달해요. 받은 사람은 미리보기를 확인하고 합칠 수
              있어요.
            </DialogContentText>
            {tooLong && <Alert severity="warning">링크가 길어요. 파일로 내보내 주세요</Alert>}
            {link.status === 'error' && <Alert severity="error">링크를 만들지 못했어요</Alert>}
            {shareStatus === 'shared' && <Alert severity="success">공유했어요</Alert>}
            {shareStatus === 'copied' && <Alert severity="success">링크를 복사했어요</Alert>}
            {shareStatus === 'manual' && ready !== null && !overLimit && (
              <>
                <Alert severity="info">아래 링크를 복사해 전달하세요</Alert>
                <TextField
                  autoFocus
                  fullWidth
                  multiline
                  maxRows={4}
                  label="링크"
                  value={ready}
                  onFocus={(e) => e.target.select()}
                  slotProps={{ htmlInput: { readOnly: true } }}
                />
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>닫기</Button>
        <Button
          variant={tooLong ? 'outlined' : 'contained'}
          disabled={!edit || ready === null || overLimit}
          onClick={() => void shareLink()}
        >
          링크 공유
        </Button>
        <Button
          variant={tooLong ? 'contained' : 'outlined'}
          disabled={!edit || !trip}
          onClick={downloadFile}
        >
          파일로 저장
        </Button>
      </DialogActions>
    </>
  );
}

function nicknameOf(edit: EditLayer): string {
  return edit.authors[edit.authorId]?.nickname ?? '';
}

/** 압축하지 않은 JSON을 임시 앵커로 내려받는다. */
function downloadEdit(edit: EditLayer, fileName: string): void {
  const blob = new Blob([serializeEditLayerFile(edit)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 클릭 직후 해제하면 일부 브라우저에서 다운로드가 끊긴다.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
