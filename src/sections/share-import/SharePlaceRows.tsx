import Box from '@mui/material/Box';
import { useMemo } from 'react';
import { cutLabelName } from 'src/domain/library/import-share';
import type { ShareDoc, ShareLabel } from 'src/schema/share';
import { RowMark } from 'src/sections/add-place/FolderPlaceRows';
import { ColorBadge } from 'src/sections/library/LabelBadge';

/**
 * 공유 파일 미리보기의 장소 목록(체크박스). 행마다 받은 라벨 칩(받은 색), 받은 메모가 있으면 `메모`,
 * `existing`(살아 있는 내 장소와 같은 받은 장소)이면 `이미 있음`을 붙인다.
 * 라벨 칩은 가져올 때처럼 다듬은 이름으로 보이고, 이름이 비거나 파일에 없는 라벨은 뺀다.
 */
export function SharePlaceRows({
  doc,
  selected,
  existing,
  onToggle,
}: {
  doc: ShareDoc;
  selected: ReadonlySet<string>;
  existing: ReadonlySet<string>;
  onToggle(id: string): void;
}) {
  const labelsById = useMemo(() => {
    const byId = new Map<string, { label: ShareLabel; name: string }>();
    for (const label of doc.labels) {
      const name = cutLabelName(label.name);
      if (name !== '') byId.set(label.id, { label, name });
    }
    return byId;
  }, [doc]);

  return (
    <Box
      component="ul"
      aria-label="가져올 장소"
      sx={{ listStyle: 'none', m: 0, p: 0, borderTop: '1px solid var(--tm-border)' }}
    >
      {doc.places.map((place) => {
        const chips = [...new Set(place.labelIds)].flatMap((id) => labelsById.get(id) ?? []);
        return (
          <Box component="li" key={place.id} sx={{ borderBottom: '1px solid var(--tm-border)' }}>
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
                checked={selected.has(place.id)}
                onChange={() => onToggle(place.id)}
                sx={{ flex: 'none', width: 20, height: 20, m: 0, mt: '2px' }}
              />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ fontSize: 15, fontWeight: 700, wordBreak: 'break-word' }}>
                  {place.name}
                </Box>
                <Box
                  sx={{ fontSize: 13, color: 'var(--tm-text-secondary)', wordBreak: 'break-word' }}
                >
                  {place.address}
                </Box>
                {chips.length > 0 && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {chips.map(({ label, name }) => (
                      <ColorBadge key={label.id} color={label.color} name={name} />
                    ))}
                  </Box>
                )}
              </Box>
              {(place.memo ?? '') !== '' && <RowMark>메모</RowMark>}
              {existing.has(place.id) && <RowMark>이미 있음</RowMark>}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
