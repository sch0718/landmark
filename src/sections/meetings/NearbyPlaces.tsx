import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { useState } from 'react';
import type { Hub } from 'src/domain/meeting/hubs';
import { nearbyPlaces } from 'src/domain/nearby';
import type { Library } from 'src/schema/library';
import type { Candidate } from 'src/schema/meeting';

export function NearbyPlaces({
  hub,
  library,
  onAdd,
}: {
  hub: Hub;
  library: Library;
  onAdd(candidate: Omit<Candidate, 'id'>): void;
}) {
  const [label, setLabel] = useState<string | null>(null);
  const nearby = nearbyPlaces(
    Object.values(library.places).filter((p) => p.deletedAt === null && p.saved.value),
    [hub.lng, hub.lat],
    1000,
  ).places;
  const labels = Object.values(library.labels).filter(
    (l) => l.deletedAt === null && nearby.some((p) => p.labelIds.value.includes(l.id)),
  );
  const places = nearby.filter((p) => label === null || p.labelIds.value.includes(label));
  return (
    <Box component="section" aria-label={`${hub.name} 근처 보관함 장소`} sx={{ p: 1 }}>
      <Box sx={{ fontSize: 13 }}>반경 1km 안 보관함 장소</Box>
      <Box
        role="group"
        aria-label="근처 장소 라벨"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}
      >
        <Chip
          label="전체"
          onClick={() => setLabel(null)}
          aria-pressed={label === null}
          sx={{ minHeight: 44, minWidth: 44 }}
        />
        {labels.map((l) => (
          <Chip
            key={l.id}
            label={`${l.emoji?.value ?? ''}${l.name.value}`}
            onClick={() => setLabel(l.id)}
            aria-pressed={label === l.id}
            sx={{ minHeight: 44, minWidth: 44 }}
          />
        ))}
      </Box>
      {places.length === 0 && <p>근처에 보관한 장소가 없어요</p>}
      <Box component="ul" sx={{ p: 0, listStyle: 'none' }}>
        {places.map((p) => (
          <Box component="li" key={p.id}>
            <span>{p.name.value}</span>
            <Button
              sx={{ minHeight: 44, minWidth: 44 }}
              aria-label={`${p.name.value} 후보에 담기`}
              onClick={() =>
                onAdd({
                  kind: 'place',
                  name: p.name.value,
                  address: p.address,
                  lng: p.lng,
                  lat: p.lat,
                  placeId: p.id,
                })
              }
            >
              후보에 담기
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
