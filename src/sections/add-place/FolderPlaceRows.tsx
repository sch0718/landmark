import Box from '@mui/material/Box';
import type { FolderResult } from 'src/server/resolve';

type FolderPlace = FolderResult['places'][number];

/** 폴더 미리보기의 장소 목록(체크박스). `existingSids`는 보관함에 이미 있는 항목이라 `이미 있음`을 붙인다. */
export function FolderPlaceRows({
  places,
  selected,
  existingSids,
  onToggle,
}: {
  places: readonly FolderPlace[];
  selected: ReadonlySet<string>;
  existingSids: ReadonlySet<string>;
  onToggle(sid: string): void;
}) {
  return (
    <Box
      component="ul"
      aria-label="가져올 장소"
      sx={{ listStyle: 'none', m: 0, p: 0, borderTop: '1px solid var(--tm-border)' }}
    >
      {places.map((place) => (
        <Box component="li" key={place.sid} sx={{ borderBottom: '1px solid var(--tm-border)' }}>
          <Box
            component="label"
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1.25,
              minHeight: 44,
              py: 1,
              cursor: 'pointer',
            }}
          >
            <Box
              component="input"
              type="checkbox"
              checked={selected.has(place.sid)}
              onChange={() => onToggle(place.sid)}
              sx={{ flex: 'none', width: 20, height: 20, m: 0, mt: '2px' }}
            />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ fontSize: 15, fontWeight: 700, wordBreak: 'break-word' }}>
                {place.name}
              </Box>
              <Box
                sx={{
                  fontSize: 13,
                  color: 'var(--tm-text-secondary)',
                  wordBreak: 'break-word',
                }}
              >
                {place.address}
              </Box>
            </Box>
            {existingSids.has(place.sid) && (
              <Box
                component="span"
                sx={{
                  flex: 'none',
                  px: 1,
                  py: 0.25,
                  borderRadius: 'var(--tm-radius-sm)',
                  border: '1px solid var(--tm-border)',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--tm-text-secondary)',
                }}
              >
                이미 있음
              </Box>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
