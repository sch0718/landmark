import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { useAtomValue, useSetAtom } from 'jotai';
import { XIcon } from 'src/components/icons';
import { addFlowAtom, addOpenerAtom, addTargetAtom } from 'src/stores/add-place';
import { hideRecommendationAtom, visibleRecommendationsAtom } from 'src/stores/recommend';
import { formatPeriod } from './format';

export function RecommendCards() {
  const recs = useAtomValue(visibleRecommendationsAtom);
  const hide = useSetAtom(hideRecommendationAtom);
  const setFlow = useSetAtom(addFlowAtom);
  const setOpener = useSetAtom(addOpenerAtom);
  const setTarget = useSetAtom(addTargetAtom);
  if (!recs.length) return null;
  return (
    <Box
      component="section"
      aria-label="추천"
      sx={{ display: 'flex', gap: 1, p: 1, overflowX: 'auto', scrollSnapType: 'x mandatory' }}
    >
      {recs.map((rec) => (
        <Box
          key={rec.id}
          sx={{ position: 'relative', flex: '0 0 240px', scrollSnapAlign: 'start' }}
        >
          <Box
            component="button"
            type="button"
            aria-label={rec.title}
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
            onClick={() => hide(rec.id)}
            sx={{ position: 'absolute', top: 0, right: 0, minWidth: 44, minHeight: 44 }}
          >
            <XIcon aria-hidden="true" />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}
