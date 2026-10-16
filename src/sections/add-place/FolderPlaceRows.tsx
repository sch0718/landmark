import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import type { FolderResult } from 'src/server/resolve';

type FolderPlace = FolderResult['places'][number];

/** 폴더 미리보기의 장소 목록(체크박스). `marks`에 있는 `sid` 행 오른쪽에 그 값을 작은 표시(`이미 있음` 등)로 붙인다. */
export function FolderPlaceRows({
  places,
  selected,
  marks,
  onToggle,
  label,
}: {
  places: readonly FolderPlace[];
  selected: ReadonlySet<string>;
  marks: ReadonlyMap<string, string>;
  onToggle(sid: string): void;
  /** 목록의 접근 이름. */
  label: string;
}) {
  return (
    <Box
      component="ul"
      aria-label={label}
      sx={{ listStyle: 'none', m: 0, p: 0, borderTop: '1px solid var(--tm-border)' }}
    >
      {places.map((place) => {
        const mark = marks.get(place.sid);
        return (
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
              {mark !== undefined && <RowMark>{mark}</RowMark>}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/** 행 오른쪽의 작은 표시(`이미 있음`·`메모`). */
export function RowMark({ children }: { children: ReactNode }) {
  return (
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
      {children}
    </Box>
  );
}
