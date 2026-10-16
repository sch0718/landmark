import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { CheckIcon } from 'src/components/icons';
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
import { NoticeBand, TodayNotices } from 'src/sections/trips/today/TodayNotices';
import { lastFixOf, useMyLocation } from 'src/sections/trips/today/use-my-location';
import { useOnline } from 'src/sections/trips/today/use-online';
import { useToday, type TodayModel, type TodayStop } from 'src/sections/trips/today/use-today';
import { useVisitToggle } from 'src/sections/trips/today/use-visit-toggle';
import { useWakeLock } from 'src/sections/trips/today/use-wake-lock';
import { libraryAtom } from 'src/stores/library-state';

const EDGE = 40;
const MAP_PADDING: MapPadding = { top: EDGE, right: EDGE, bottom: EDGE, left: EDGE };
/** 좁은 화면 지도 높이(스펙 §5.1). 나머지 높이는 카드·목록이 스크롤한다. */
const COMPACT_MAP_HEIGHT = 'clamp(180px, 34dvh, 320px)';
const WAKE_LOCK_LABEL = '화면 켜 두기';
const OFFLINE_NOTICE =
  '인터넷에 연결되지 않았어요. 일정과 체크는 그대로 쓸 수 있고, 이동 시간은 어림값이에요';

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

/** 체크·풀기(또는 스스로 사라지는 버튼) 뒤 포커스를 둘 곳. `index`는 누른 상자가 그 목록에서 있던 자리. */
type CheckFocus = { from: 'remaining' | 'visited'; index: number } | { from: 'card' };

/**
 * 체크한 행은 목록을 옮겨 가며 사라지므로 포커스가 `body`로 떨어지지 않게 옮긴다. 남은 일정은 같은 자리(없으면
 * 마지막)의 상자 → 카드, 다녀온 곳은 같은 자리의 상자 → `다녀온 곳 N곳` 버튼 → 카드. 카드의 `다녀옴`은 카드로.
 */
function focusAfterCheck(pane: HTMLElement | null, card: HTMLElement | null, target: CheckFocus) {
  const nth = (selector: string, index: number): HTMLElement | null => {
    const all = pane?.querySelectorAll<HTMLElement>(selector) ?? [];
    return all.length === 0 ? null : (all[Math.min(index, all.length - 1)] ?? null);
  };
  let el: HTMLElement | null = null;
  if (target.from === 'remaining') {
    el = nth('[data-today-check="remaining"] input', target.index);
  } else if (target.from === 'visited') {
    el =
      nth('[data-today-check="visited"] input', target.index) ??
      pane?.querySelector<HTMLElement>('[data-today-fold]') ??
      null;
  }
  (el ?? card)?.focus();
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
  // `seq`는 `focusRequest`를 비운 뒤에도 늘기만 한다(`MapView`는 이미 옮긴 `seq`를 다시 옮기지 않는다).
  const focusSeq = useRef(0);
  // 내 위치는 이 화면 상태로만 둔다(보이는 동안만 지켜봄). 받은 지 2분이 지난 위치는 `useToday`가 버린다.
  const location = useMyLocation();
  const model = useToday(trip, viewDay, lastFixOf(location.state));
  // 화면 켜 두기·오프라인 안내(스펙 §4.9·§4.10)는 머리·띠의 슬롯으로만 끼운다.
  const wake = useWakeLock();
  const online = useOnline();
  const paneRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  // 체크(또는 스스로 사라지는 버튼) 뒤 옮길 포커스. 바뀐 목록이 그려진 다음(effect)에 옮긴다. `from`은 누른 때
  // 포커스가 있던 요소.
  const checkFocus = useRef<{ target: CheckFocus; from: Element | null } | null>(null);
  const [checkFocusTick, setCheckFocusTick] = useState(0);
  const focusLater = (target: CheckFocus, from: Element | null) => {
    checkFocus.current = { target, from };
    setCheckFocusTick((n) => n + 1);
  };
  /**
   * 누른 버튼이 띠와 함께 사라질 때(`내 위치 켜기`·`다시 시도`·`오늘로`) 다음에 그린 뒤 포커스를 카드로 옮긴다.
   * `from`이 null이면(토스트) 포커스가 `body`로 떨어졌을 때만 옮긴다.
   */
  const focusCardLater = (from: Element | null) => focusLater({ from: 'card' }, from);
  useEffect(() => {
    const want = checkFocus.current;
    if (want === null) return;
    checkFocus.current = null;
    // 저장하는 동안 사람이 다른 곳으로 포커스를 옮겼으면 빼앗지 않는다.
    const active = document.activeElement;
    const lost = active === null || active === document.body || active === want.from;
    if (lost || !document.contains(active)) {
      focusAfterCheck(paneRef.current, cardRef.current, want.target);
    }
  }, [checkFocusTick]);
  // 토스트의 `되돌리기`는 토스트와 함께 사라진다. 포커스가 `body`로 떨어졌을 때만 카드로 옮긴다.
  const visit = useVisitToggle({ onUndone: () => focusCardLater(null) });

  // 고른 Stop이 지워졌거나(다른 탭) 그날에서 빠졌으면 다음 장소로 돌아간다. 다음 장소를 고르면 `다음`으로 보인다.
  const found = model.stops.findIndex((s) => s.stop.id === selectedStopId);
  if (selectedStopId !== null && found === -1) setSelectedStopId(null); // 렌더 중 상태 갱신
  const nextIndex = model.next?.kind === 'stop' ? model.next.index : null;
  const selected = found === -1 || found === nextIndex ? null : found;

  const pickDay = (dayIndex: number) => {
    setViewDay(dayIndex === model.todayIndex ? null : dayIndex);
    setSelectedStopId(null);
    setFocusRequest(null);
  };
  // `오늘로`: 오늘 Day로 돌아가면 그 띠와 버튼이 사라지므로 포커스는 카드로.
  const toToday = () => {
    const from = document.activeElement;
    setViewDay(null);
    setSelectedStopId(null);
    setFocusRequest(null);
    focusCardLater(from);
  };
  const focusOn = (placeId: string | null) => {
    if (placeId === null) return;
    focusSeq.current += 1;
    setFocusRequest({ placeId, seq: focusSeq.current });
  };
  const selectIndex = (index: number) => {
    const item = model.stops[index];
    if (item === undefined) return;
    setSelectedStopId(item.stop.id);
    focusOn(item.place.id);
  };
  // `내 위치로`: 사람이 누른 것이라 지도를 내 위치로 옮긴다.
  const focusOnMe = () => {
    if (model.fix === null) return;
    focusSeq.current += 1;
    setFocusRequest({ point: [model.fix.lng, model.fix.lat], seq: focusSeq.current });
  };
  const showNext = () => {
    setSelectedStopId(null);
    focusOn(cardPlaceId(model, null));
  };
  // 체크 날짜는 보는 Day가 아니라 오늘 Day의 날짜(`model.date`, 새벽 경계 반영)다. 고른 장소를 체크하면
  // 카드는 다음 장소로 돌아온다(스펙 §4.5). 지도는 옮기지 않는다.
  const check = async (item: TodayStop, next: boolean, target: CheckFocus) => {
    const from = document.activeElement;
    const done = await visit.toggle(item.place, next, model.date);
    if (!done) return;
    if (next) setSelectedStopId((id) => (id === item.stop.id ? null : id));
    focusLater(target, from);
  };
  // `내 위치 켜기`·`다시 시도`: 감시를 걸면 위치 띠와 버튼이 사라지므로 포커스는 카드로.
  const locate = () => {
    const from = document.activeElement;
    location.start();
    focusCardLater(from);
  };
  const { stops } = model;
  const pickPlace = useCallback(
    (placeId: string) => {
      const stop = stops.find((s) => s.place.id === placeId);
      if (stop !== undefined) setSelectedStopId(stop.stop.id);
    },
    [stops],
  );

  const header = (
    <TodayHeader
      trip={trip}
      model={model}
      onPickDay={pickDay}
      extraMenu={
        wake.supported ? (
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={wake.on}
            sx={{ minHeight: 44 }}
            onClick={() => wake.setOn(!wake.on)}
          >
            <Box component="span" sx={{ display: 'inline-flex', width: 20, mr: 1 }}>
              {wake.on && <CheckIcon aria-hidden="true" width={18} height={18} />}
            </Box>
            {WAKE_LOCK_LABEL}
          </MenuItem>
        ) : null
      }
      badge={
        wake.on ? (
          <Box sx={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-secondary)' }}>
            화면 켜 둠
          </Box>
        ) : null
      }
    />
  );
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
        myLocation={model.fix}
        onLocateMe={focusOnMe}
      />
    </Box>
  );
  const scroll: ReactNode = (
    <Box
      ref={paneRef}
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
      <TodayNotices
        model={model}
        trip={trip}
        onToday={toToday}
        location={location.state}
        onLocate={locate}
      >
        {(!online || model.plan.offline) && <NoticeBand>{OFFLINE_NOTICE}</NoticeBand>}
      </TodayNotices>
      <NextCard
        model={model}
        trip={trip}
        selected={selected}
        onShowNext={showNext}
        onCheck={(item) => void check(item, true, { from: 'card' })}
        pending={visit.pending}
        cardRef={cardRef}
      />
      <TodayLists
        model={model}
        onSelect={selectIndex}
        onCheck={(item, next, index) =>
          void check(item, next, { from: next ? 'remaining' : 'visited', index })
        }
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
