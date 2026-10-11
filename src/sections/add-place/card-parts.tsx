import Box from '@mui/material/Box';
import { useAtomValue, useStore } from 'jotai';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createLabel } from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import { normalizeLabelName } from 'src/schema/library';
import { libraryAtom, useLibraryAction, type LibraryActionResult } from 'src/stores/library-state';

// 확인 카드(`CandidateCard`)와 핀 입력 카드(`PinCard`)가 같이 쓰는 칸·훅.

/** 카드의 한 줄 입력칸. */
export const CARD_FIELD_SX = {
  boxSizing: 'border-box',
  display: 'block',
  width: '100%',
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

/** 카드의 제목 붙은 칸. */
export function CardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ mt: 2 }}>
      <Box
        component="h3"
        sx={{ m: 0, mb: 0.5, fontSize: 13, fontWeight: 800, color: 'var(--tm-text-secondary)' }}
      >
        {title}
      </Box>
      {children}
    </Box>
  );
}

const isNameTaken = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'LabelNameTaken';

/**
 * 카드의 라벨 고르기. `labelIds`는 고른 그대로, `shownIds`는 그사이 지워진
 * 라벨을 뺀 것이다. 저장할 때는 최신본 기준으로 다시 걸러야 한다.
 */
export function useCardLabels() {
  const library = useAtomValue(libraryAtom);
  const jotaiStore = useStore();
  const { run } = useLibraryAction();
  const labels = useMemo(() => liveLabels(library), [library]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  // 고른 라벨 중 그사이 지워진 것은 보이지 않게 뺀다.
  const shownIds = labelIds.filter((id) => labels.some((label) => label.id === id));

  const toggle = (labelId: string) =>
    setLabelIds((ids) =>
      ids.includes(labelId) ? ids.filter((id) => id !== labelId) : [...ids, labelId],
    );
  const select = (labelId: string) =>
    setLabelIds((ids) => (ids.includes(labelId) ? ids : [...ids, labelId]));

  // 새 라벨을 만들어 고른다. 같은 이름의 라벨이 있으면 그 라벨을 고른다.
  const createAndSelect = async (name: string): Promise<LibraryActionResult> => {
    const result = await run((lib, ctx) => createLabel(lib, name, ctx));
    if (result.ok) {
      select(result.createdId!);
      return result;
    }
    if (isNameTaken(result.error)) {
      const wanted = normalizeLabelName(name);
      const found = liveLabels(jotaiStore.get(libraryAtom)).find(
        (label) => normalizeLabelName(label.name.value) === wanted,
      );
      if (found !== undefined) {
        select(found.id);
        return { ok: true };
      }
    }
    return result;
  };

  return { labels, labelIds, shownIds, toggle, createAndSelect };
}

/** 마운트돼 있는 동안 `true`. 저장하는 사이 칸이 닫혔는지 볼 때 쓴다. */
export function useAliveRef() {
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  return aliveRef;
}
