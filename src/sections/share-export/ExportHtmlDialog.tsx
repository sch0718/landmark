import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Effect, Result } from 'effect';
import { useAtomValue } from 'jotai';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { downloadText } from 'src/lib/download-text';
import { startEffect } from 'src/lib/effect/runtime';
import type { ExportTargets } from 'src/sections/share-export/export-targets';
import { renderShareHtml, type ShareHtml } from 'src/sections/share-export/make-share-html';
import { SHARE_EXPORT_FAILED, ShareTemplateUnavailable } from 'src/services/errors';
import { ShareTemplate } from 'src/services/share-template';
import { libraryAtom } from 'src/stores/library-state';

const TITLE_MAX = 60;
const TITLE_HELP = '제목은 1~60자로 써 주세요';
const NOTHING_TO_EXPORT = '내보낼 장소가 없어요';
const SHARE_FAILED = '공유하지 못했어요. 파일 저장을 이용해 주세요';
const DONE = '파일을 만들었어요';
const SHARE_PREPARING = '공유 준비 중…';

type Props = { open: boolean; onClose(): void; targets: ExportTargets };

/** 이 기기에서 HTML 파일을 시스템 공유 창으로 보낼 수 있는지. 어떤 환경에서도 던지지 않는다. */
function canShareFiles(): boolean {
  try {
    if (typeof navigator.canShare !== 'function' || typeof File !== 'function') return false;
    return navigator.canShare({ files: [new File([''], 'x.html', { type: 'text/html' })] });
  } catch {
    return false;
  }
}

/** 사용자가 공유 창을 닫은 것(실패가 아니다). `DOMException`이 `Error`가 아닌 환경도 있어 이름만 본다. */
const isAbort = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError';

/** 틀을 받는다. 성공은 `ShareTemplate`가 캐시하고, 받는 중에 또 부르면 같은 요청을 기다린다. */
const loadTemplate = Effect.gen(function* () {
  return yield* (yield* ShareTemplate).load;
});

/**
 * 만들기 실패를 창 안 문구로 바꾼다. 틀을 받지 못한 것(오프라인 등)은 흔한 일이라 문구만 보이고,
 * 그 밖의 실패(`ShareDocInvalid` 같은 프로그램 오류)는 같은 안내를 보이되 콘솔에 남긴다.
 */
function failureMessage(e: unknown): string {
  if (e instanceof ShareTemplateUnavailable) return e.userMessage;
  console.error(e);
  return SHARE_EXPORT_FAILED;
}

/**
 * 장소를 HTML 파일 하나로 내보내는 창(스펙 §3.2·§3.4). 파일로 저장하거나, 휴대폰처럼 파일 공유가
 * 되는 기기에서는 시스템 공유 창으로 보낸다. 열 때마다 제목·메모 체크·오류를 `targets` 기준으로
 * 초기화하고, 만드는 동안에는 두 버튼을 막아 두 번 저장되지 않게 한다.
 * 열고 닫을 때마다 실행 번호를 올려, 그 전에 시작한 작업은 끝나도 저장·공유·닫기·안내를 하지 않는다.
 *
 * 공유 창은 사용자 동작 직후에만 열 수 있어서(Web Share API의 transient activation), 누른 뒤에 틀을
 * 받느라 늦으면 느린 망에서 첫 공유가 거부된다. 그래서 열 때 틀을 미리 받아 들고 있고, 받을 때까지
 * `공유`는 `공유 준비 중…`으로 막아 둔다. 공유는 들고 있는 틀로 바로 만들어 기다림 없이 공유 창을 연다.
 * 미리 받기가 실패하면 틀 실패 문구를 보이고, `파일 저장`을 누르면 다시 받는다(성공하면 공유도 준비된다).
 */
export function ExportHtmlDialog({ open, onClose, targets }: Props) {
  const library = useAtomValue(libraryAtom);
  const titleId = useId();
  const [title, setTitle] = useState(targets.defaultTitle);
  const [includeMemo, setIncludeMemo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareable, setShareable] = useState(canShareFiles);
  const [busy, setBusy] = useState(false);
  // 미리 받은 틀. 세션 안에서는 바뀌지 않으므로 닫았다 열어도 그대로 둔다.
  const [template, setTemplate] = useState<string | null>(null);
  // 상태 갱신이 그려지기 전에 들어온 두 번째 클릭도 막는다.
  const busyRef = useRef(false);
  // 지금 열린 창의 실행 번호. 작업은 시작할 때 번호를 기억하고, 끝났을 때 번호가 바뀌었으면 아무것도 하지 않는다.
  const runIdRef = useRef(0);

  // 열릴 때 초기화한다(렌더 중 상태 갱신).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTitle(targets.defaultTitle);
      setIncludeMemo(true);
      setError(null);
      setShareable(canShareFiles());
      setBusy(false);
    }
  }

  // 열고 닫을 때: 앞 작업을 무효로 하고 작업 중 표시를 푼다. 그려진 직후(레이아웃 단계)라 앞 작업이
  // 그 사이에 끝나 저장하는 일이 없다. 열 때는 틀을 미리 받고, 받지 못하면 이 창에서만 안내한다.
  useLayoutEffect(() => {
    runIdRef.current += 1;
    busyRef.current = false;
    if (!open) return;
    const runId = runIdRef.current;
    startEffect(loadTemplate).then(setTemplate, (e: unknown) => {
      if (runIdRef.current === runId) setError(failureMessage(e));
    });
  }, [open]);

  const trimmed = title.trim();
  // 서로게이트 쌍(이모지 등)을 한 글자로 센다.
  const titleLength = [...trimmed].length;
  const titleValid = titleLength >= 1 && titleLength <= TITLE_MAX;
  const empty = targets.ids.length === 0;
  const disabled = busy || empty || !titleValid;
  const shareDisabled = disabled || template === null;

  const run = async (kind: 'save' | 'share') => {
    if (busyRef.current || (kind === 'share' ? shareDisabled : disabled)) return;
    const runId = runIdRef.current;
    const stale = () => runIdRef.current !== runId;
    let closing = false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      // 공유는 준비된 틀로만 들어온다(네트워크를 기다리지 않는다). 저장은 틀이 없으면 다시 받는다.
      let ready = template;
      if (ready === null) {
        try {
          ready = await startEffect(loadTemplate);
        } catch (e) {
          if (!stale()) setError(failureMessage(e));
          return;
        }
        setTemplate(ready);
        if (stale()) return;
      }
      const result = renderShareHtml(ready, library, targets.ids, {
        title: trimmed,
        includeMemo,
        now: new Date(),
      });
      if (Result.isFailure(result)) {
        setError(failureMessage(result.failure));
        return;
      }
      const made: ShareHtml = result.success;
      if (kind === 'save') {
        downloadText(made.html, made.fileName, 'text/html;charset=utf-8');
      } else {
        const file = new File([made.html], made.fileName, { type: 'text/html' });
        try {
          await navigator.share({ files: [file], title: trimmed });
        } catch (e) {
          if (!stale() && !isAbort(e)) setError(SHARE_FAILED);
          return;
        }
        if (stale()) return;
      }
      closing = true;
      onClose();
      toast(DONE);
    } finally {
      // 창을 다시 열었으면 작업 중 표시는 이미 새 창의 것이다(건드리지 않는다). 성공해서 닫는 중이면
      // 풀지 않는다: 준비된 틀로는 기다림 없이 끝나서, 닫히기 전에 들어온 두 번째 클릭이 또 저장한다.
      // 다시 열 때 초기화된다.
      if (!stale() && !closing) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
      <DialogTitle id={titleId}>내보내기</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
            {targets.summary}
          </Typography>
          <TextField
            label="제목"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            error={!titleValid}
            helperText={titleValid ? undefined : TITLE_HELP}
            fullWidth
            autoComplete="off"
            sx={{ mt: 1 }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={includeMemo}
                onChange={(event) => setIncludeMemo(event.target.checked)}
              />
            }
            label="메모 포함"
            sx={{ minHeight: 44 }}
          />
          {empty && (
            <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
              {NOTHING_TO_EXPORT}
            </Typography>
          )}
          {error !== null && (
            <Typography role="alert" variant="body2" color="error">
              {error}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          닫기
        </Button>
        {shareable && (
          <Button
            variant="outlined"
            disabled={shareDisabled}
            onClick={() => void run('share')}
            sx={{ minHeight: 44 }}
          >
            {template === null ? SHARE_PREPARING : '공유'}
          </Button>
        )}
        <Button
          variant="contained"
          disabled={disabled}
          onClick={() => void run('save')}
          sx={{ minHeight: 44 }}
        >
          파일 저장
        </Button>
      </DialogActions>
    </Dialog>
  );
}
