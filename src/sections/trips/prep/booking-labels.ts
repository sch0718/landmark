import type { Booking } from 'src/schema/trip';

export const STATUS_LABELS = {
  todo: '예약 전',
  booked: '예약함',
  pending: '결제 대기',
  skipped: '안 하기로 함',
} satisfies Record<Booking['status'], string>;

export const NEED_LABELS = {
  required: '필수',
  recommended: '권장',
  optional: '선택',
} satisfies Record<Booking['need'], string>;

export const KIND_LABELS = {
  flight: '항공편',
  train: '기차',
  bus: '버스',
  lodging: '숙소',
  ticket: '입장권',
  restaurant: '식당',
  tour: '투어',
  car: '렌터카',
  insurance: '보험',
  other: '기타',
} satisfies Record<Booking['kind'], string>;
