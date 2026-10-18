import { TripShareDialog } from 'src/routes/lazy-routes';
import { LazyDialogHost } from 'src/sections/share-export/LazyDialogHost';

type Props = { open: boolean; onClose(): void; tripId: string };

/** 일정 공유 창(`TripShareDialog`)을 처음 열 때 받아 그린다(`LazyDialogHost`, 스펙 §11). */
export function TripShareDialogHost({ open, onClose, tripId }: Props) {
  return (
    <LazyDialogHost open={open} onClose={onClose} heading="일정 공유">
      <TripShareDialog open={open} onClose={onClose} tripId={tripId} />
    </LazyDialogHost>
  );
}
