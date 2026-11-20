import Box from '@mui/material/Box';
import { ExternalLinkIcon } from 'src/components/icons';
import { naverPlaceUrlOf } from 'src/domain/library/links';
import { liveLabels } from 'src/domain/library/query';
import { reviewOf } from 'src/domain/library/visit';
import type { Library } from 'src/schema/library';
import { LabelBadge } from 'src/sections/library/LabelBadge';
import { placeLabels } from 'src/sections/library/place-labels';
import { useOpenPlace } from 'src/sections/library/use-open-place';
import { BUTTON_SX } from 'src/sections/place/button-style';

const TEXT_SX = {
  m: 0,
  mt: 0.5,
  fontSize: 13,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
} as const;

/** 보관함 장소 후보의 라벨·한 줄 평·메모와 네이버 지도·상세 열기. 보관함에 없으면 아무것도 보이지 않는다. */
export function CandidatePlaceInfo({
  placeId,
  name,
  library,
}: {
  placeId: string;
  name: string;
  library: Library;
}) {
  const openPlace = useOpenPlace();
  const place = library.places[placeId];
  if (place === undefined || place.deletedAt !== null) return null;
  const labelsById = new Map(liveLabels(library).map((label) => [label.id, label]));
  const labels = placeLabels(place, labelsById);
  const review = reviewOf(place);
  const memo = place.memo.value;
  const url = naverPlaceUrlOf(place);
  return (
    <Box sx={{ mt: 0.5 }}>
      {place.address !== '' && (
        <Box component="p" sx={{ m: 0, fontSize: 13, color: 'var(--tm-text-secondary)' }}>
          {place.address}
        </Box>
      )}
      {labels.length > 0 && (
        <Box
          component="ul"
          aria-label={`${name} 라벨`}
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
            p: 0,
            m: 0,
            mt: 0.5,
            listStyle: 'none',
          }}
        >
          {labels.map((label) => (
            <Box component="li" key={label.id} sx={{ minWidth: 0, maxWidth: '100%' }}>
              <LabelBadge label={label} />
            </Box>
          ))}
        </Box>
      )}
      {review !== '' && (
        <Box component="p" sx={TEXT_SX}>
          {`“${review}”`}
        </Box>
      )}
      {memo !== '' && (
        <Box
          component="p"
          aria-label={`${name} 메모`}
          sx={{ ...TEXT_SX, color: 'var(--tm-text-secondary)' }}
        >
          {memo}
        </Box>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
        {url !== null && (
          <Box
            component="a"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${name} 네이버 지도에서 열기`}
            sx={BUTTON_SX}
          >
            <ExternalLinkIcon aria-hidden="true" />
            네이버 지도에서 열기
          </Box>
        )}
        <Box
          component="button"
          type="button"
          aria-label={`${name} 상세`}
          onClick={() => openPlace(place.id, 'list')}
          sx={BUTTON_SX}
        >
          상세
        </Box>
      </Box>
    </Box>
  );
}
