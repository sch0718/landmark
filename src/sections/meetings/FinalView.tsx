import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useState } from 'react';
import { MapView } from 'src/components/map/MapView';
import type { FinalDoc } from 'src/domain/meeting/link';
import { useLayout } from 'src/sections/shell/use-layout';
import { naverDirectionsUrl } from 'src/sections/trips/planner/naver-directions';

/** 확정 링크는 보관함을 바꾸지 않고 장소와 참석자별 길찾기를 보여 준다. */
export function FinalView({ doc }: { doc: FinalDoc }) {
  const layout = useLayout();
  const [unavailable, setUnavailable] = useState<string | null>(null);
  return (
    <Box sx={{ p: 2, maxWidth: 720, mx: 'auto' }}>
      <Box component="h1" sx={{ fontSize: 24 }}>
        {doc.title}
      </Box>
      <p>{doc.at === null ? '일시 미정' : `${doc.at.date.replaceAll('-', '.')} ${doc.at.time}`}</p>
      <Box component="h2" sx={{ fontSize: 20 }}>
        확정 · {doc.place.name}
      </Box>
      {doc.place.address !== undefined && <p>{doc.place.address}</p>}
      <Box
        component="section"
        aria-label="확정 장소 지도"
        sx={{ height: 300, position: 'relative', bgcolor: 'var(--tm-bg-raised)' }}
      >
        <MapView
          markers={[
            {
              id: 'final',
              lng: doc.place.lng,
              lat: doc.place.lat,
              label: doc.place.name,
              color: '#19733b',
              selected: true,
              clusterable: false,
            },
          ]}
          polylines={[]}
          onMarkerClick={() => {}}
          onUnavailable={setUnavailable}
        />
        {unavailable !== null && (
          <Box
            role="status"
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              p: 2,
              textAlign: 'center',
            }}
          >
            {unavailable}
          </Box>
        )}
      </Box>
      <Box component="ul" aria-label="참석자별 길찾기" sx={{ p: 0, listStyle: 'none' }}>
        {doc.participants.map((participant, i) => {
          const url =
            participant.origin === null
              ? null
              : naverDirectionsUrl(
                  {
                    from: participant.origin,
                    to: doc.place,
                    mode: doc.mode === 'straight' ? 'transit' : doc.mode,
                  },
                  layout === 'compact' ? 'app' : 'web',
                );
          const web = url?.startsWith('https://') ?? false;
          return (
            <Box component="li" key={i} sx={{ py: 0.5 }}>
              {url === null ? (
                <span>{participant.name}</span>
              ) : (
                <Button
                  component="a"
                  href={url}
                  {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  sx={{ minHeight: 44 }}
                >
                  {participant.name} 출발 길찾기
                </Button>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
