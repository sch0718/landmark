import type { Trip } from 'src/schema/trip';
import { TripFormDialog } from 'src/sections/trips/TripFormDialog';

/**
 * `여행 설정`(스펙 §2.6): 제목·기간·1일차 출발지. 여행 목록의 `이름 바꾸기`와 같은 고치기 창을 쓴다.
 * 기간을 줄여 장소가 있는 Day가 사라지면 창 안에서 먼저 확인하고, 저장은 `되돌리기` 토스트로 돌릴 수 있다.
 * 창은 열릴 때마다 지금 여행의 값으로 시작한다.
 */
export function TripSettingsDialog({
  trip,
  open,
  onClose,
}: {
  trip: Trip;
  open: boolean;
  onClose(): void;
}) {
  return (
    <TripFormDialog
      open={open}
      mode="edit"
      tripId={trip.id}
      initial={{
        title: trip.title.value,
        startDate: trip.startDate.value,
        endDate: trip.endDate.value,
        origin: trip.origin.value,
      }}
      onClose={onClose}
    />
  );
}
