import { PlaceList, type PlaceListProps } from 'src/sections/library/views/PlaceList';

/** 목록 보기: 한 줄 행(이름 · 지역 · 대표 라벨 점). */
export function ListView(props: PlaceListProps) {
  return <PlaceList variant="row" {...props} />;
}
