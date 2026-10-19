import Box from '@mui/material/Box';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  DEFAULT_QUERY,
  hasVisited,
  labelCounts,
  liveLabels,
  livePlaces,
  placeIdsInRegion,
  queryPlaces,
  regionCounts,
  sortByVisited,
  visitCounts,
  type LibraryQuery,
} from 'src/domain/library/query';
import {
  addLabels,
  deletePlaces,
  markVisitedToday,
  removeLabels,
  restorePlaces,
  setVisitedOn,
} from 'src/domain/library/ops';
import { isVisited, localDateOf, visitedOnOf } from 'src/domain/library/visit';
import { nextRadius, radiusLabel } from 'src/domain/nearby';
import type { Library } from 'src/schema/library';
import { addCandidates } from 'src/domain/trips/ops';
import { paths } from 'src/routes/paths';
import { useOpenPlace } from 'src/sections/library/use-open-place';
import { BulkBar } from 'src/sections/library/BulkBar';
import { EmptyState } from 'src/sections/library/EmptyState';
import { FilterBar } from 'src/sections/library/FilterBar';
import { useLibraryQuery } from 'src/sections/library/use-library-query';
import { useListScrollRestore } from 'src/sections/library/use-list-scroll-restore';
import { useOpenPlaceId } from 'src/sections/library/use-open-place-id';
import { BentoView } from 'src/sections/library/views/BentoView';
import { CardsView } from 'src/sections/library/views/CardsView';
import { ListView } from 'src/sections/library/views/ListView';
import { TilesView } from 'src/sections/library/views/TilesView';
import type { LibraryView } from 'src/sections/library/ViewSwitcher';
import { candidatesNotice } from 'src/sections/trips/candidate-notice';
import { TripFormDialog } from 'src/sections/trips/TripFormDialog';
import { TripPickerDialog } from 'src/sections/trips/TripPickerDialog';
import type { Trip } from 'src/schema/trip';
import { NearbyBar, type NearbyBarHandle } from 'src/sections/nearby/NearbyBar';
import { useNearby, useStartNearby } from 'src/sections/nearby/use-nearby';
import { ExportHtmlDialogHost } from 'src/sections/share-export/ExportHtmlDialogHost';
import { exportTargets } from 'src/sections/share-export/export-targets';
import { useCloseDetail } from 'src/sections/shell/use-close-detail';
import { useLayout } from 'src/sections/shell/use-layout';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';
import { focusPlaceAtom } from 'src/stores/library-ui';
import { nearbyAtom, nearbyOffAtom } from 'src/stores/my-location';
import { prefsAtom, setPrefsAtom } from 'src/stores/prefs-state';
import { visitedSortAtom } from 'src/stores/visit-sort';

/** 삭제 직후 "되돌리기"를 보여 주는 시간. */
export const UNDO_MS = 5000;

const toggled = (set: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
};

/** 최신본의 살아 있는 `ids` 중 `changes(이전 다녀온 날)`가 참인 장소의 이전 값. 실제로 바뀌는 곳만 센다. */
const visitedBefore = (
  lib: Library,
  ids: readonly string[],
  changes: (prev: string | null) => boolean,
): Record<string, string | null> => {
  const out: Record<string, string | null> = {};
  for (const id of ids) {
    const place = lib.places[id];
    if (place === undefined || place.deletedAt !== null) continue;
    const prev = visitedOnOf(place);
    if (changes(prev)) out[id] = prev;
  }
  return out;
};

/**
 * 보관함 목록 화면(스펙 §4.2). 위에서부터 검색·보기·정렬, 라벨·지역 칩, 보기 본문, 선택 모드의 하단 바.
 * 벤토·타일은 "라벨 개요" 보기라서 라벨 블록 아래에 현재 조건의 장소 목록(`ListView`)을 항상 함께 보여 준다.
 */
export function LibraryPage() {
  const library = useAtomValue(libraryAtom);
  const prefs = useAtomValue(prefsAtom);
  const setPrefs = useSetAtom(setPrefsAtom);
  const [query, patchQuery] = useLibraryQuery();
  const [visitedSort, setVisitedSort] = useAtom(visitedSortAtom);
  const [nearbyState, setNearby] = useAtom(nearbyAtom);
  const nearbyOff = useSetAtom(nearbyOffAtom);
  // 근처 줄의 ×·빈 상태의 `반경 넓히기`·`필터 지우기`는 누르면 사라질 수 있어, 포커스를 남는 단추로 옮긴다.
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const nearbyBarRef = useRef<NearbyBarHandle>(null);
  const startNearby = useStartNearby();
  // 저장되는 정렬을 고르면 저장하지 않는 `다녀온 날순`·`가까운 순`은 꺼진다(같은 값을 다시 골라도).
  const patch = useCallback(
    (change: Partial<LibraryQuery>) => {
      patchQuery(change);
      if (change.sort !== undefined) {
        setVisitedSort(false);
        nearbyOff();
      }
    },
    [patchQuery, setVisitedSort, nearbyOff],
  );
  const { run } = useLibraryAction();
  const navigate = useNavigate();
  const openId = useOpenPlaceId();
  const requestListScroll = useSetAtom(focusPlaceAtom);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  // 장소를 닫으면 목록을 열기 전 자리로 되돌린다.
  useListScrollRestore(scrollElement, openId, JSON.stringify(query));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  // `여행에 넣기`의 여행 고르기 창, 그리고 새 여행 대화상자(제목·처음 후보).
  const [pickingTrip, setPickingTrip] = useState(false);
  const [newTrip, setNewTrip] = useState<{ title?: string; candidates: string[] } | null>(null);

  const view = prefs.libraryView;
  const labels = useMemo(() => liveLabels(library), [library]);
  const labelsById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const total = useMemo(() => livePlaces(library).length, [library]);
  const sorted = useMemo(() => {
    const matched = queryPlaces(library, query);
    return visitedSort ? sortByVisited(matched) : matched;
  }, [library, query, visitedSort]);
  // 근처 모드이고 위치가 있으면 반경 안만 가까운 순. 선택·내보내기도 이 목록 기준이다.
  const nearby = useNearby(sorted);
  const places = nearby.places;
  const compact = useLayout() === 'compact';
  const closeDetail = useCloseDetail();
  const queryKey = JSON.stringify(query);
  const seenQueryKey = useRef(queryKey);
  useEffect(() => {
    if (seenQueryKey.current === queryKey) return;
    seenQueryKey.current = queryKey;
    if (compact && openId !== null && !places.some((place) => place.id === openId)) {
      closeDetail({ replace: true });
    }
  }, [queryKey, compact, openId, places, closeDetail]);
  const showVisit = useMemo(
    () => hasVisited(library) || query.visited !== 'all',
    [library, query.visited],
  );
  const visits = useMemo(() => visitCounts(library, query), [library, query]);
  const counts = useMemo(() => labelCounts(library, query), [library, query]);
  const regions = useMemo(() => regionCounts(library, query), [library, query]);

  // 화면에 보이는 장소만 선택으로 센다. 필터가 바뀌어 목록에서 빠진 선택은 버린다(렌더 중 상태 갱신).
  const visible = new Set(places.map((p) => p.id));
  if ([...selected].some((id) => !visible.has(id))) {
    setSelected(new Set([...selected].filter((id) => visible.has(id))));
  }
  const selectedPlaces = places.filter((p) => selected.has(p.id));
  const selectedIds = selectedPlaces.map((p) => p.id);
  const attached = labels.filter((l) =>
    selectedPlaces.some((p) => p.labelIds.value.includes(l.id)),
  );
  // 도구줄·하단 바의 "내보내기"가 함께 쓰는 대상. 고른 것이 있으면 그것, 없으면 보이는 전부.
  const targets = useMemo(
    () => exportTargets(places, [...selected], query, labels),
    [places, selected, query, labels],
  );

  // 장소가 열리면(목록·지도·주소로) 목록이 그 행으로 스크롤한다. 이미 보이면 움직이지 않는다.
  useEffect(() => {
    if (openId !== null) requestListScroll((prev) => ({ id: openId, seq: (prev?.seq ?? 0) + 1 }));
  }, [openId, requestListScroll]);

  const openPlace = useOpenPlace();
  const onOpen = useCallback((id: string) => openPlace(id, 'list'), [openPlace]);
  const onToggle = useCallback((id: string) => setSelected((prev) => toggled(prev, id)), []);

  const changeView = (next: LibraryView) => setPrefs({ ...prefs, libraryView: next });
  // 실패는 `run`이 토스트로 알린다(`ErrorReporter`). 여기서는 성공했을 때만 이어서 한다.
  const attach = (labelId: string) =>
    void run((lib, ctx) => addLabels(lib, selectedIds, [labelId], ctx));
  const detach = (labelId: string) =>
    void run((lib, ctx) => removeLabels(lib, selectedIds, [labelId], ctx));
  const remove = async () => {
    const ids = selectedIds;
    // 화면에서 고른 id가 아니라, 저장된 최신본에서 이번에 실제로 지워지는 장소만 되돌린다
    // (다른 탭이 먼저 지운 장소를 되돌리기가 살려 내지 않도록).
    let deleted: string[] = [];
    const result = await run((lib, ctx) => {
      deleted = ids.filter((id) => lib.places[id]?.deletedAt === null);
      return deletePlaces(lib, ids, ctx);
    });
    if (!result.ok) return;
    setSelected(new Set());
    if (deleted.length === 0) return;
    toast(`${deleted.length}곳을 지웠어요`, {
      duration: UNDO_MS,
      action: {
        label: '되돌리기',
        // 같은 장소가 그 사이 다시 저장됐다면 검증에 막혀 실패한다. 그때도 `run`이 토스트로 알린다.
        onClick: () => void run((lib, ctx) => restorePlaces(lib, deleted, ctx)),
      },
    });
  };
  // 다녀옴 표시·지우기. 숫자와 되돌리기는 화면이 아니라 저장된 최신본에서 실제로 바뀐 곳 기준이다.
  // 되돌리기는 지금 값이 이 작업이 쓴 값(`written`) 그대로인 장소만 되돌린다.
  // 그사이 다른 탭이 새 날짜를 적었다면 덮어쓰지 않는다.
  const undoVisited = (prevById: Record<string, string | null>, written: string | null) => ({
    label: '되돌리기',
    onClick: () =>
      void run((lib, ctx) => {
        const toRestore: Record<string, string | null> = {};
        for (const [id, prev] of Object.entries(prevById)) {
          const current = lib.places[id];
          if (current === undefined || current.deletedAt !== null) continue;
          if (visitedOnOf(current) === written) toRestore[id] = prev;
        }
        return Object.keys(toRestore).length === 0 ? lib : setVisitedOn(lib, toRestore, ctx);
      }),
  });
  const markVisited = async () => {
    const ids = selectedIds;
    let prevById: Record<string, string | null> = {};
    let written = '';
    const result = await run((lib, ctx) => {
      const today = localDateOf(ctx.now);
      written = today;
      prevById = visitedBefore(lib, ids, (prev) => prev === null || prev < today);
      return markVisitedToday(lib, ids, ctx);
    });
    if (!result.ok) return;
    const n = Object.keys(prevById).length;
    if (n === 0) {
      toast('이미 다녀옴으로 표시돼 있어요');
      return;
    }
    toast(`${n}곳을 오늘 다녀옴으로 표시했어요`, {
      duration: UNDO_MS,
      action: undoVisited(prevById, written),
    });
  };
  const clearVisited = async () => {
    const ids = selectedIds;
    let prevById: Record<string, string | null> = {};
    const result = await run((lib, ctx) => {
      prevById = visitedBefore(lib, ids, (prev) => prev !== null);
      return setVisitedOn(
        lib,
        Object.fromEntries(Object.keys(prevById).map((id) => [id, null])),
        ctx,
      );
    });
    if (!result.ok) return;
    const n = Object.keys(prevById).length;
    if (n === 0) return;
    toast(`${n}곳의 다녀옴 표시를 지웠어요`, {
      duration: UNDO_MS,
      action: undoVisited(prevById, null),
    });
  };
  // 정렬은 그대로 둔다. `patch`를 거치면 저장되지 않는 `다녀온 날순`이 꺼지므로 `patchQuery`로 직접 쓴다.
  // 근처 모드는 끈다(스펙 §4.2·§13 결정 11 (다)). 켜 둔 반경 때문에 필터를 풀어도 장소가 숨으면 안 된다.
  // 빈 상태와 그 단추가 사라지므로 포커스는 정렬 단추로 옮긴다.
  const clearFilters = () => {
    patchQuery({ ...DEFAULT_QUERY, sort: query.sort });
    nearbyOff();
    sortButtonRef.current?.focus();
  };
  // 고른 장소를 기존 여행의 후보에 더한다. 이미 그 여행에 있는 곳은 건너뛰고 새로 넣은 수만 알린다.
  // 저장이 끝나기 전에 또 누르면(두 번 탭) 무시한다. 토스트가 두 번 뜨지 않게.
  const addingToTrip = useRef(false);
  const addToTrip = async (tripId: string) => {
    if (addingToTrip.current) return;
    addingToTrip.current = true;
    try {
      const ids = selectedIds;
      const box: { trip?: Trip } = {};
      const result = await run((lib, ctx) => {
        const out = addCandidates(lib, tripId, ids, ctx);
        box.trip = out.ok ? out.lib.trips[tripId] : undefined;
        return out;
      });
      if (!result.ok) return;
      setPickingTrip(false);
      toast(candidatesNotice(result.summary?.created ?? 0, box.trip, ids));
    } finally {
      addingToTrip.current = false;
    }
  };
  // 지역 칩 하나 → 그 지역의 보관함 장소 전부(다른 필터와 상관없이)를 후보로 새 여행.
  const createRegionTrip = (region: string) =>
    setNewTrip({ title: `${region} 여행`, candidates: placeIdsInRegion(library, region) });

  const listProps = {
    places,
    labelsById,
    selection: selected,
    scrollElement,
    onOpen,
    onToggle,
    distances: nearby.distances,
  };
  const overviewProps = { labels, counts, query, onSelect: patch };

  if (total === 0) {
    return (
      <EmptyState
        title="아직 저장한 장소가 없어요"
        actionLabel="옛 여행 가져오기"
        onAction={() => void navigate(paths.settingsImport)}
      />
    );
  }

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 'none' }}>
        <FilterBar
          query={query}
          onChange={patch}
          labels={labels}
          counts={counts}
          regions={regions}
          visitCounts={showVisit ? visits : undefined}
          visitedSort={visitedSort}
          onVisitedSort={() => {
            setVisitedSort(true);
            nearbyOff();
          }}
          nearby={nearbyState.on}
          onNearby={startNearby}
          sortButtonRef={sortButtonRef}
          view={view}
          onViewChange={changeView}
          onExport={() => setExporting(true)}
          onCreateRegionTrip={createRegionTrip}
        />
        <NearbyBar
          ref={nearbyBarRef}
          count={places.length}
          hidden={sorted.length - places.length}
          onTurnedOff={() => sortButtonRef.current?.focus()}
        />
      </Box>
      <Box ref={setScrollElement} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Box>
          {view === 'bento' && <BentoView {...overviewProps} />}
          {view === 'tiles' && <TilesView {...overviewProps} />}
          {places.length > 0 &&
            (view === 'cards' ? <CardsView {...listProps} /> : <ListView {...listProps} />)}
          {places.length === 0 &&
            // 필터만으로 이미 0곳이면 반경을 넓혀도 소용없으므로 필터 빈 상태를 보인다.
            (nearby.active && nearby.radiusM !== null && sorted.length > 0 ? (
              <EmptyState
                title={`반경 ${radiusLabel(nearby.radiusM)} 안에 저장한 곳이 없어요`}
                actionLabel="반경 넓히기"
                onAction={() => {
                  const radiusM = nextRadius(nearbyState.radiusM);
                  setNearby((prev) => ({ ...prev, radiusM }));
                  nearbyBarRef.current?.focusRadius(radiusM);
                }}
              />
            ) : (
              <EmptyState
                title="조건에 맞는 장소가 없어요"
                actionLabel="필터 지우기"
                onAction={clearFilters}
              />
            ))}
        </Box>
      </Box>
      {selectedIds.length > 0 && (
        <BulkBar
          count={selectedIds.length}
          labels={labels}
          attached={attached}
          onAdd={attach}
          onRemove={detach}
          onDelete={() => void remove()}
          onExport={() => setExporting(true)}
          onAddToTrip={() => setPickingTrip(true)}
          visitedCount={selectedPlaces.filter(isVisited).length}
          onMarkVisited={() => void markVisited()}
          onClearVisited={() => void clearVisited()}
          onClear={() => setSelected(new Set())}
        />
      )}
      <TripPickerDialog
        open={pickingTrip}
        onPick={(tripId) => void addToTrip(tripId)}
        onCreateNew={() => {
          setPickingTrip(false);
          setNewTrip({ candidates: selectedIds });
        }}
        onClose={() => setPickingTrip(false)}
      />
      <TripFormDialog
        open={newTrip !== null}
        mode="create"
        initial={{ title: newTrip?.title ?? '' }}
        candidates={newTrip?.candidates ?? []}
        onClose={() => setNewTrip(null)}
        onDone={(id) => void navigate(paths.trip(id))}
      />
      <ExportHtmlDialogHost
        open={exporting}
        onClose={() => setExporting(false)}
        targets={targets}
      />
    </Box>
  );
}
