import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useAtomValue } from 'jotai';
import { useCallback, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { MapPadding } from 'src/components/map/MapAdapter';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import type { Trip } from 'src/schema/trip';
import { LIST_WIDTH } from 'src/sections/shell/pane-widths';
import { useLayout } from 'src/sections/shell/use-layout';
import { NextCard } from 'src/sections/trips/today/NextCard';
import { TodayHeader } from 'src/sections/trips/today/TodayHeader';
import { TodayLists } from 'src/sections/trips/today/TodayLists';
import { TodayMap, type TodayFocusRequest } from 'src/sections/trips/today/TodayMap';
import { TodayNotices } from 'src/sections/trips/today/TodayNotices';
import { useToday, type TodayModel, type TodayStop } from 'src/sections/trips/today/use-today';
import { useVisitToggle } from 'src/sections/trips/today/use-visit-toggle';
import { libraryAtom } from 'src/stores/library-state';

const EDGE = 40;
const MAP_PADDING: MapPadding = { top: EDGE, right: EDGE, bottom: EDGE, left: EDGE };
/** 좁은 화면 지도 높이(스펙 §5.1). 나머지 높이는 카드·목록이 스크롤한다. */
const COMPACT_MAP_HEIGHT = 'clamp(180px, 34dvh, 320px)';

function NotFound() {
  return (
    <Box
      role="alert"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1.5,
        px: 3,
        py: 6,
        textAlign: 'center',
      }}
    >
      <Box component="h1" sx={{ m: 0, fontSize: 'inherit', fontWeight: 800 }}>
        여행을 찾지 못했어요
      </Box>
      <Button component={Link} to={paths.trips} variant="contained" sx={{ minHeight: 44 }}>
        여행 목록으로
      </Button>
    </Box>
  );
}

/** 카드가 보는 장소: 고른 Stop → 다음 Stop → 숙소. */
function cardPlaceId(model: TodayModel, selected: number | null): string | null {
  if (selected !== null) return model.stops[selected]?.place.id ?? null;
  const { next } = model;
  if (next === null) return null;
  return next.kind === 'stop' ? (model.stops[next.index]?.place.id ?? null) : next.place.id;
}

function Today({ trip }: { trip: Trip }) {
  const layout = useLayout();
  // 보는 Day(null이면 오늘 Day)와 카드로 고른 Stop. 화면 상태라 저장하지 않는다(스펙 §4.3·§4.5).
  const [viewDay, setViewDay] = useState<number | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  // 지도를 옮기는 요청. 사람이 고를 때만 늘린다(행 누름·`다음 장소 보기`). 체크·삭제로 카드가 바뀌면 그대로 둔다.
  const [focusRequest, setFocusRequest] = useState<TodayFocusRequest | null>(null);
  const model = useToday(trip, viewDay);
  const visit = useVisitToggle();

  // 고른 Stop이 지워졌거나(다른 탭) 그날에서 빠졌으면 다음 장소로 돌아간다. 다음 장소를 고르면 `다음`으로 보인다.
  const found = model.stops.findIndex((s) => s.stop.id === selectedStopId);
  if (selectedStopId !== null && found === -1) setSelectedStopId(null); // 렌더 중 상태 갱신
  const nextIndex = model.next?.kind === 'stop' ? model.next.index : null;
  const selected = found === -1 || found === nextIndex ? null : found;

  const pickDay = (dayIndex: number) => {
    setViewDay(dayIndex === model.todayIndex ? null : dayIndex);
    setSelectedStopId(null);
  };
  const toToday = () => {
    setViewDay(null);
    setSelectedStopId(null);
  };
  const focusOn = (placeId: string | null) => {
    if (placeId === null) return;
    setFocusRequest((prev) => ({ placeId, seq: (prev?.seq ?? 0) + 1 }));
  };
  const selectIndex = (index: number) => {
    const item = model.stops[index];
    if (item === undefined) return;
    setSelectedStopId(item.stop.id);
    focusOn(item.place.id);
  };
  const showNext = () => {
    setSelectedStopId(null);
    focusOn(cardPlaceId(model, null));
  };
  // 체크 날짜는 보는 Day가 아니라 오늘 Day의 날짜(`model.date`, 새벽 경계 반영)다. 고른 장소를 체크하면
  // 카드는 다음 장소로 돌아온다(스펙 §4.5). 지도는 옮기지 않는다.
  const check = async (item: TodayStop, next: boolean) => {
    const done = await visit.toggle(item.place, next, model.date);
    if (done && next) setSelectedStopId((id) => (id === item.stop.id ? null : id));
  };
  const { stops } = model;
  const pickPlace = useCallback(
    (placeId: string) => {
      const stop = stops.find((s) => s.place.id === placeId);
      if (stop !== undefined) setSelectedStopId(stop.stop.id);
    },
    [stops],
  );

  const header = <TodayHeader trip={trip} model={model} onPickDay={pickDay} />;
  const map = (sx: object) => (
    <Box
      component="section"
      aria-label="지도"
      sx={{ position: 'relative', overflow: 'hidden', bgcolor: 'var(--tm-bg-base)', ...sx }}
    >
      <TodayMap
        trip={trip}
        model={model}
        selectedPlaceId={cardPlaceId(model, selected)}
        focusRequest={focusRequest}
        onPick={pickPlace}
        padding={MAP_PADDING}
      />
    </Box>
  );
  const scroll: ReactNode = (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        p: 2,
        bgcolor: 'var(--tm-bg-base)',
      }}
    >
      <TodayNotices model={model} trip={trip} onToday={toToday} />
      <NextCard
        model={model}
        trip={trip}
        selected={selected}
        onShowNext={showNext}
        onCheck={(item) => void check(item, true)}
        pending={visit.pending}
      />
      <TodayLists
        model={model}
        onSelect={selectIndex}
        onCheck={(item, next) => void check(item, next)}
        pending={visit.pending}
      />
    </Box>
  );

  if (layout === 'compact') {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {header}
        {map({ flex: 'none', height: COMPACT_MAP_HEIGHT })}
        {scroll}
      </Box>
    );
  }
  // 중간·넓은 화면: [왼쪽 칸 360px: 머리 + 스크롤 칸][지도]. 넓어도 세 칸으로 나누지 않는다(스펙 §5.2).
  return (
    <Box sx={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      <Box
        data-today-pane=""
        sx={{
          flex: 'none',
          width: LIST_WIDTH,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--tm-border)',
          bgcolor: 'var(--tm-bg-surface)',
        }}
      >
        {header}
        {scroll}
      </Box>
      {map({ flex: 1, minWidth: 0, height: '100%' })}
    </Box>
  );
}

/**
 * `/trips/:id/today` 여행 당일 모드(스펙 §5). 오늘 Day의 다음 장소 카드·남은 일정·다녀온 곳·그날 지도를 보인다.
 * 좁은 화면은 [머리][지도][스크롤 칸], 중간·넓은 화면은 [왼쪽 칸][지도]. 셸의 `Outlet` 본문을 높이 100%로 채운다.
 */
export function TripTodayPage() {
  const { id = '' } = useParams();
  const library = useAtomValue(libraryAtom);
  const trip = library.trips[id];
  const found = trip !== undefined && trip.deletedAt === null;
  useDocumentTitle(found ? `오늘 일정 · ${trip.title.value}` : null);
  if (!found) return <NotFound />;
  // 여행이 바뀌면 화면 상태(보는 Day·고른 장소)를 새로 시작한다.
  return <Today key={trip.id} trip={trip} />;
}
