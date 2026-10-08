import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LibraryPage } from 'src/sections/library/LibraryPage';
import { LibraryMap } from 'src/sections/map/LibraryMap';
import { PlaceDetail } from 'src/sections/place/PlaceDetail';

/**
 * 셸의 슬롯 자리. 크기·경계·랜드마크는 `AppShell`이 정하고, 안쪽 내용은 각 태스크가 이 컴포넌트를
 * 채운다(목록·상세·지도). `AppShell`은 건드리지 않아도 된다.
 */
function SlotPlaceholder({ title, children }: { title: string; children?: string }) {
  return (
    <Box sx={{ p: 2, color: 'var(--tm-text-secondary)' }}>
      <Typography component="p" sx={{ fontWeight: 800, color: 'var(--tm-text-primary)' }}>
        {title}
      </Typography>
      {children !== undefined && <Typography variant="body2">{children}</Typography>}
    </Box>
  );
}

export function ListSlot() {
  return <LibraryPage />;
}

export function MapSlot() {
  return <LibraryMap />;
}

/** `placeId`가 없으면(넓은 화면에서 아직 고르지 않음) 안내만 보여 준다. */
export function DetailSlot({ placeId }: { placeId: string | null }) {
  return placeId === null ? (
    <SlotPlaceholder title="장소 상세">장소를 고르면 여기에 보여요</SlotPlaceholder>
  ) : (
    <PlaceDetail placeId={placeId} />
  );
}

/** `/labels`·`/settings`처럼 아직 화면이 없는 경로 자리. */
export function PagePlaceholder({ title }: { title: string }) {
  return <SlotPlaceholder title={title}>곧 제공돼요</SlotPlaceholder>;
}
