import Box from '@mui/material/Box';
import { useStore } from 'jotai';
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { fieldSx } from 'src/components/field-style';
import { LIBRARY_LIMITS } from 'src/schema/library';
import { memoDraftsAtom, useDraft, type MemoDraft } from 'src/stores/library-state';

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
  const jotaiStore = useStore();
  // 저장하지 못했거나 저장 중에 화면을 떠난 글은 컴포넌트 밖에 남아 있다. 이 장소로 돌아오면 이어받는다.
  const [restored] = useState<MemoDraft | undefined>(() => {
    const kept = jotaiStore.get(memoDraftsAtom)[placeId];
    return kept !== undefined && kept.text !== saved ? kept : undefined;
  });
  const draft = useDraft(
    `memo:${placeId}`,
    saved,
    restored && { value: restored.text, failed: restored.failed, base: restored.base },
  );
  const [overflow, setOverflow] = useState(false);
  // 붙여넣기 직후 브라우저가 보내는 `input`(→ `onChange`)이 방금 켠 경고를 지우지 않게 한다.
  const pasting = useRef(false);

  // 타이머·이벤트·정리 함수가 오래된 클로저를 쓰지 않게 최신 `flush`를 ref로 부른다.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 지금 저장 중인 글. 탭을 닫을 때 `visibilitychange`·`pagehide`·언마운트가 잇따라 와도 같은 글을 또 보내지 않는다.
  const inflight = useRef<string | null>(null);
  // 남겨 둔 초안을 고친다. 컴포넌트가 사라진 뒤에 끝나는 저장도 반영해야 하므로 상태가 아니라 저장소를 쓴다.
  const keepDraft = (next: MemoDraft | null) =>
    jotaiStore.set(memoDraftsAtom, (all) => {
      const rest = { ...all };
      if (next === null) delete rest[placeId];
      else rest[placeId] = next;
      return rest;
    });
  const send = (text: string) => {
    inflight.current = text;
    return onSave(text)
      .then(
        (result) => result,
        () => ({ ok: false }),
      )
      .then((result) => {
        // 더 고친 글이 있으면 그 글의 초안을 건드리지 않는다(그 글의 저장 결과는 따로 온다).
        const kept = jotaiStore.get(memoDraftsAtom)[placeId];
        if (kept?.text === text) {
          keepDraft(result.ok ? null : { ...kept, failed: true });
        } else if (kept !== undefined && result.ok) {
          keepDraft({ ...kept, base: text }); // 저장하는 사이 더 고친 글은 방금 저장한 글을 기준으로 한다.
        }
        return result;
      })
      .finally(() => {
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

  // 이어받은 글이 아직 저장 전이면 바로 저장한다. 이미 저장된 값과 같아진 남은 초안은 지운다.
  useEffect(() => {
    if (restored === undefined) {
      if (jotaiStore.get(memoDraftsAtom)[placeId] !== undefined) keepDraft(null);
    } else if (!restored.failed && restored.base === saved) {
      // 다른 탭이 고친 메모는 말없이 덮어쓰지 않는다.
      flushRef.current();
    }
    // 처음 한 번만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    keepDraft({
      text,
      failed: false,
      base: jotaiStore.get(memoDraftsAtom)[placeId]?.base ?? saved,
    });
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
        sx={fieldSx({ multiline: true, minHeight: 132 })}
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
