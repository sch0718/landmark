import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { useAtomValue, useSetAtom } from 'jotai';
import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { XIcon } from 'src/components/icons';
import { addFlowAtom, addOpenerAtom, addTargetAtom } from 'src/stores/add-place';
import {
  hiddenRecommendationCountAtom,
  hideRecommendationAtom,
  showHiddenRecommendationsAtom,
  visibleRecommendationsAtom,
} from 'src/stores/recommend';
import { formatPeriod } from './format';

export function RecommendCards() {
  const recs = useAtomValue(visibleRecommendationsAtom);
  const hiddenCount = useAtomValue(hiddenRecommendationCountAtom);
  const hide = useSetAtom(hideRecommendationAtom);
  const showHidden = useSetAtom(showHiddenRecommendationsAtom);
  const setFlow = useSetAtom(addFlowAtom);
  const setOpener = useSetAtom(addOpenerAtom);
  const setTarget = useSetAtom(addTargetAtom);
  const sectionRef = useRef<HTMLElement>(null);
  // 누른 × 단추가 사라지므로 다음(없으면 앞) 카드로 포커스를 옮긴다. 마지막 카드면 목록 칸으로.
  const hideAndMoveFocus = (index: number, id: string) => {
    const cards = sectionRef.current?.querySelectorAll<HTMLElement>('[data-recommend-card]');
    const next = cards?.[index + 1] ?? cards?.[index - 1];
    hide(id);
    if (next) next.focus();
    else document.querySelector<HTMLElement>('#main')?.focus();
  };
  if (!recs.length && hiddenCount === 0) return null;
  return (
    <>
      {recs.length > 0 && (
        <Box
          component="section"
          aria-label="추천"
          ref={sectionRef}
          sx={{ display: 'flex', gap: 1, p: 1, overflowX: 'auto', scrollSnapType: 'x mandatory' }}
        >
          {recs.map((rec, index) => (
            <Box
              key={rec.id}
              sx={{ position: 'relative', flex: '0 0 240px', scrollSnapAlign: 'start' }}
            >
              <Box
                component="button"
                type="button"
                data-recommend-card
                onClick={(event) => {
                  setTarget(null);
                  setOpener(event.currentTarget);
                  setFlow({
                    step: 'share',
                    doc: rec.doc,
                    recommend: {
                      id: rec.id,
                      title: rec.title,
                      description: rec.description,
                      startDate: rec.startDate,
                      endDate: rec.endDate,
                    },
                  });
                }}
                sx={{
                  width: '100%',
                  minHeight: 100,
                  border: '1px solid var(--tm-border)',
                  borderRadius: 'var(--tm-radius-md)',
                  p: 1.5,
                  pr: 5.5,
                  textAlign: 'left',
                  font: 'inherit',
                  color: 'var(--tm-text-primary)',
                  bgcolor: 'var(--tm-bg-surface)',
                  cursor: 'pointer',
                }}
              >
                <Box sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{rec.title}</Box>
                {rec.description && (
                  <Box
                    sx={{
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: 'var(--tm-text-secondary)',
                    }}
                  >
                    {rec.description}
                  </Box>
                )}
                <Box
                  sx={{ mt: 0.5, fontSize: 12, color: 'var(--tm-text-secondary)' }}
                >{`${rec.places}곳 · ${formatPeriod(rec.startDate, rec.endDate)}`}</Box>
              </Box>
              <IconButton
                aria-label={`${rec.title} 추천 숨기기`}
                onClick={() => hideAndMoveFocus(index, rec.id)}
                sx={{ position: 'absolute', top: 0, right: 0, minWidth: 44, minHeight: 44 }}
              >
                <XIcon aria-hidden="true" />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}
      {hiddenCount > 0 && (
        <Button
          onClick={() => {
            flushSync(() => showHidden());
            sectionRef.current?.querySelector<HTMLElement>('[data-recommend-card]')?.focus();
          }}
          sx={{ minHeight: 44, mx: 1 }}
        >
          숨긴 추천 다시 보기
        </Button>
      )}
    </>
  );
}
