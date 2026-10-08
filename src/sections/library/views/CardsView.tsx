import { PlaceList, type PlaceListProps } from 'src/sections/library/views/PlaceList';

/** 카드 보기: 이름 아래 메모 3줄과 라벨 칩. */
export function CardsView(props: PlaceListProps) {
  return <PlaceList variant="card" {...props} />;
}
