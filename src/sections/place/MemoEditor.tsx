import Box from '@mui/material/Box';
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { LIBRARY_LIMITS } from 'src/schema/library';
import { useDraft } from 'src/stores/library-state';

/** 입력이 멈추고 이만큼 지나면 저장한다. */
export const MEMO_DEBOUNCE_MS = 600;
/** 이 글자 수를 넘으면 남은 글자 수를 보여 준다. */
const COUNTER_FROM = 9000;

type Props = {
  placeId: string;
  /** 저장된 메모(보관함 문서의 값). */
  saved: string;
  /** 저장한다. 실패는 `ok: false`로 알리고 토스트는 호출한 쪽이 맡는다. */
  onSave(text: string): Promise<{ ok: boolean }>;
};

/**
 * 장소 메모(스펙 §4.3). 입력이 600ms 멈추면 저장하고, 화면을 떠날 때(언마운트·장소 바뀜·탭 숨김·
 * 페이지 닫힘)는 기다리지 않고 바로 저장한다. "저장됨"은 저장이 성공한 뒤에만 보인다.
 */
export function MemoEditor({ placeId, saved, onSave }: Props) {
  const draft = useDraft(`memo:${placeId}`, saved);
  const [overflow, setOverflow] = useState(false);
  // 붙여넣기 직후 브라우저가 보내는 `input`(→ `onChange`)이 방금 켠 경고를 지우지 않게 한다.
  const pasting = useRef(false);

  // 타이머·이벤트·정리 함수가 오래된 클로저를 쓰지 않게 최신 `flush`를 ref로 부른다.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 지금 저장 중인 글. 탭을 닫을 때 `visibilitychange`·`pagehide`·언마운트가 잇따라 와도 같은 글을 또 보내지 않는다.
  const inflight = useRef<string | null>(null);
  const send = (text: string) => {
    inflight.current = text;
    return onSave(text).finally(() => {
      if (inflight.current === text) inflight.current = null;
    });
  };
  const flush = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (inflight.current === draft.value) return;
    void draft.commit(send);
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  useEffect(() => {
    const now = () => flushRef.current();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', now);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', now);
      now(); // 언마운트: 장소가 바뀌거나 화면을 떠나는 경우
    };
  }, []);

  const onChange = (text: string) => {
    if (!pasting.current) setOverflow(false);
    pasting.current = false;
    draft.setValue(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), MEMO_DEBOUNCE_MS);
  };

  // 브라우저는 `maxLength`를 넘는 붙여넣기를 말없이 자르므로, 잘렸다는 것을 알린다.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart, selectionEnd } = event.currentTarget;
    const pasted = event.clipboardData.getData('text').length;
    const after = value.length - (selectionEnd - selectionStart) + pasted;
    if (after <= LIBRARY_LIMITS.memoChars) return;
    setOverflow(true);
    // `input`은 같은 작업 안에서 이어서 온다. 글이 이미 가득 차 `input`이 안 오면 다음 입력이 경고를 지운다.
    pasting.current = true;
    setTimeout(() => (pasting.current = false), 0);
  };

  const length = draft.value.length;
  const remaining = LIBRARY_LIMITS.memoChars - length;
  return (
    <Box>
      <Box
        component="textarea"
        aria-label="메모"
        aria-describedby={`memo-status-${placeId}`}
        value={draft.value}
        maxLength={LIBRARY_LIMITS.memoChars}
        rows={6}
        placeholder="이 장소에 대한 메모"
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
        sx={{
          boxSizing: 'border-box',
          display: 'block',
          width: '100%',
          minHeight: 132,
          p: 1.25,
          border: '1px solid var(--tm-border)',
          borderRadius: 'var(--tm-radius-md)',
          bgcolor: 'var(--tm-bg-raised)',
          color: 'var(--tm-text-primary)',
          font: 'inherit',
          fontSize: 14,
          lineHeight: 1.6,
          resize: 'vertical',
          '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 1 },
        }}
      />
      <Box
        id={`memo-status-${placeId}`}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
          minHeight: 28,
          mt: 0.5,
          fontSize: 12,
          color: 'var(--tm-text-secondary)',
        }}
      >
        <Box component="span" role="status" aria-live="polite">
          {draft.status === 'saving' && '저장 중…'}
          {draft.status === 'saved' && '저장됨'}
        </Box>
        {draft.status === 'error' && (
          <Box
            component="button"
            type="button"
            onClick={flush}
            sx={{
              minHeight: 44,
              px: 0.5,
              border: 0,
              background: 'transparent',
              font: 'inherit',
              fontWeight: 700,
              color: 'error.main',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            저장하지 못했어요 · 다시 시도
          </Box>
        )}
        {draft.remoteChanged && (
          <Box component="span" role="status">
            다른 탭에서 바뀌었어요
          </Box>
        )}
        {overflow && (
          <Box component="span" role="alert" sx={{ color: 'error.main' }}>
            {LIBRARY_LIMITS.memoChars.toLocaleString('ko-KR')}자를 넘는 부분은 들어가지 않았어요
          </Box>
        )}
        {length > COUNTER_FROM && (
          <Box component="span" sx={{ ml: 'auto' }}>
            {remaining.toLocaleString('ko-KR')}자 남음
          </Box>
        )}
      </Box>
    </Box>
  );
}
