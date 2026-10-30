import { CollabDialogHost } from 'src/sections/trips/collab/CollabDialogHost';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { HelpButton } from 'src/components/HelpButton';
import { EllipsisIcon } from 'src/components/icons';
import { deleteTrip, restoreTrip } from 'src/domain/trips/ops';
import { rolloverDate, todayStatus } from 'src/domain/trips/today';
import { liveTrips, visibleCandidates, visibleStops } from 'src/domain/trips/query';
import { useDocumentTitle } from 'src/lib/use-document-title';
import type { Library } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { paths } from 'src/routes/paths';
import { EmptyState } from 'src/sections/library/EmptyState';
import { TripShareDialogHost } from 'src/sections/share-export/TripShareDialogHost';
import { TripFormDialog } from 'src/sections/trips/TripFormDialog';
import { periodLabel } from 'src/sections/trips/trip-dates';
import { useTripLiveRecords } from 'src/services/trip-live/store';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

/** 지운 직후 "되돌리기"를 보여 주는 시간(스펙: 8초). */
const UNDO_MS = 8000;

type CardProps = {
  liveShared: boolean;
  trip: Trip;
  library: Library;
  onMenu(anchor: HTMLElement): void;
};

/**
 * 여행 카드: 제목, 기간, 일정·후보 수. 카드를 누르면 계획 화면, 오른쪽 `⋯`은 메뉴.
 * 오늘(04:00 경계)이 기간 안이면 카드 링크 아래 줄에 `오늘 일정`(당일 모드)을 둔다(스펙 §3.1).
 */
function TripCard({ trip, library, onMenu, liveShared }: CardProps) {
  const title = trip.title.value;
  const during = todayStatus(trip, new Date()).kind === 'during';
  const scheduled = trip.days.reduce((sum, day) => sum + visibleStops(library, day).length, 0);
  const candidates = visibleCandidates(library, trip).length;
  const period = periodLabel(trip.startDate.value, trip.endDate.value);
  const counts = `일정 ${scheduled}곳 · 후보 ${candidates}곳${liveShared ? ' · 갱신 공유 중' : ''}`;
  return (
    <Box
      component="li"
      sx={{
        position: 'relative',
        listStyle: 'none',
        mb: 1.25,
        border: '1px solid var(--tm-border)',
        borderRadius: 'var(--tm-radius-md)',
        bgcolor: 'var(--tm-bg-raised)',
      }}
    >
      <Box
        component={Link}
        to={paths.trip(trip.id)}
        // 화면의 세 줄(제목·기간·일정/후보 수)을 쉼표로 이어 읽는다.
        aria-label={`${title}, ${period}, ${counts}`}
        sx={{
          display: 'block',
          minHeight: 44,
          py: 1.5,
          pl: 2,
          pr: 7,
          borderRadius: 'inherit',
          color: 'inherit',
          textDecoration: 'none',
          '&:focus-visible': { outlineOffset: -2 },
        }}
      >
        <Box component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 800, overflowWrap: 'anywhere' }}>
          {title}
        </Box>
        <Box sx={{ mt: 0.5, fontSize: 13, color: 'var(--tm-text-secondary)' }}>{period}</Box>
        <Box sx={{ mt: 0.25, fontSize: 13, color: 'var(--tm-text-secondary)' }}>{counts}</Box>
      </Box>
      {/* 카드 전체가 링크라 그 안에 넣지 않고 링크 다음 형제로 둔다(⋯ 메뉴와 같다). */}
      {during && (
        <Box sx={{ px: 2, pb: 1.5 }}>
          <Button
            component={Link}
            to={paths.tripToday(trip.id)}
            variant="contained"
            aria-label={`‘${title}’ 오늘 일정`}
            sx={{ minHeight: 44 }}
          >
            오늘 일정
          </Button>
        </Box>
      )}
      <Box
        component="button"
        type="button"
        aria-label={`‘${title}’ 메뉴`}
        aria-haspopup="menu"
        onClick={(event) => onMenu(event.currentTarget)}
        sx={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 44,
          height: 44,
          display: 'grid',
          placeItems: 'center',
          border: 0,
          borderRadius: '50%',
          background: 'transparent',
          color: 'var(--tm-text-secondary)',
          cursor: 'pointer',
          '&:focus-visible': { outlineOffset: -2 },
          '& svg': { width: 20, height: 20 },
        }}
      >
        <EllipsisIcon aria-hidden="true" />
      </Box>
    </Box>
  );
}

function TripList({
  liveIds,
  label,
  trips,
  library,
  onMenu,
}: {
  liveIds: ReadonlySet<string>;
  label: string;
  trips: Trip[];
  library: Library;
  onMenu(trip: Trip, anchor: HTMLElement): void;
}) {
  return (
    <Box component="ul" aria-label={label} sx={{ m: 0, p: 0 }}>
      {trips.map((trip) => (
        <TripCard
          key={trip.id}
          trip={trip}
          liveShared={liveIds.has(trip.id)}
          library={library}
          onMenu={(anchor) => onMenu(trip, anchor)}
        />
      ))}
    </Box>
  );
}

/** `/trips`: 여행 목록. 새 여행 만들기, 이름 바꾸기, 일정 공유, 삭제(되돌리기 토스트). */
export function TripsPage() {
  useDocumentTitle('여행');
  const liveRecords = useTripLiveRecords();
  const liveIds = new Set(liveRecords.filter((r) => r.status === 'live').map((r) => r.tripId));
  const library = useAtomValue(libraryAtom);
  const { run } = useLibraryAction();
  const navigate = useNavigate();

  // 묶음도 `오늘 일정` 버튼과 같은 새벽 경계를 쓴다(04:00 전에는 어제 끝난 여행이 아직 위에 있다).
  const today = rolloverDate(new Date());
  const { upcoming, past } = useMemo(() => {
    const all = liveTrips(library, today);
    return {
      upcoming: all.filter((t) => t.endDate.value >= today),
      past: all.filter((t) => t.endDate.value < today),
    };
  }, [library, today]);

  const [collab, setCollab] = useState<{ tripId: string; open: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ tripId: string; anchor: HTMLElement } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // 일정 공유 창. 한 번 연 뒤에는 닫아도 마운트를 두고 `open`만 바꾼다(`LazyDialogHost`).
  const [sharing, setSharing] = useState<{ tripId: string; open: boolean } | null>(null);

  const menuTrip = menu === null ? undefined : library.trips[menu.tripId];
  const renamingTrip = renaming === null ? undefined : library.trips[renaming];
  const deletingTrip = deleting === null ? undefined : library.trips[deleting];

  const confirmDelete = async () => {
    if (deletingTrip === undefined) return;
    const { id } = deletingTrip;
    const title = deletingTrip.title.value;
    // 이번 삭제가 새로 지운 경우에만 되돌리기를 준다(이미 다른 탭이 지웠다면 살려 내지 않는다).
    let fresh = false;
    const result = await run((lib, ctx) => {
      fresh = lib.trips[id]?.deletedAt === null;
      return deleteTrip(lib, id, ctx);
    });
    if (!result.ok) return;
    setDeleting(null);
    if (!fresh) return;
    toast(`‘${title}’ 여행을 지웠어요`, {
      duration: UNDO_MS,
      action: {
        label: '되돌리기',
        onClick: () => void run((lib, ctx) => restoreTrip(lib, id, ctx)),
      },
    });
  };

  const openMenu = (trip: Trip, anchor: HTMLElement) => setMenu({ tripId: trip.id, anchor });
  const empty = upcoming.length === 0 && past.length === 0;

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', px: 2, py: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box component="h1" sx={{ m: 0, fontSize: 20, fontWeight: 800 }}>
          여행
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <HelpButton page="trips" />
          {!empty && (
            <Button variant="contained" onClick={() => setCreating(true)} sx={{ minHeight: 44 }}>
              새 여행
            </Button>
          )}
        </Box>
      </Box>

      {empty ? (
        <EmptyState
          title="아직 만든 여행이 없어요"
          actionLabel="새 여행"
          onAction={() => setCreating(true)}
        />
      ) : (
        <>
          {upcoming.length > 0 && (
            <TripList
              liveIds={liveIds}
              label="여행 목록"
              trips={upcoming}
              library={library}
              onMenu={openMenu}
            />
          )}
          {past.length > 0 && (
            <Box component="section" sx={{ mt: upcoming.length > 0 ? 3 : 0 }}>
              <Box
                component="h2"
                sx={{
                  m: 0,
                  mb: 1,
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'var(--tm-text-secondary)',
                }}
              >
                지난 여행
              </Box>
              <TripList
                liveIds={liveIds}
                label="지난 여행 목록"
                trips={past}
                library={library}
                onMenu={openMenu}
              />
            </Box>
          )}
        </>
      )}

      <Menu
        open={menu !== null && menuTrip !== undefined}
        anchorEl={menu?.anchor}
        onClose={() => setMenu(null)}
      >
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            setRenaming(menu?.tripId ?? null);
            setMenu(null);
          }}
        >
          이름 바꾸기
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            if (menu !== null) setSharing({ tripId: menu.tripId, open: true });
            setMenu(null);
          }}
        >
          일정 공유
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            if (menu) setCollab({ tripId: menu.tripId, open: true });
            setMenu(null);
          }}
        >
          함께 편집…
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 44, color: 'error.main' }}
          onClick={() => {
            setDeleting(menu?.tripId ?? null);
            setMenu(null);
          }}
        >
          삭제
        </MenuItem>
      </Menu>

      <TripFormDialog
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
        onDone={(id) => void navigate(paths.trip(id))}
      />
      {renamingTrip !== undefined && (
        <TripFormDialog
          open
          mode="edit"
          tripId={renamingTrip.id}
          initial={{
            title: renamingTrip.title.value,
            startDate: renamingTrip.startDate.value,
            endDate: renamingTrip.endDate.value,
            origin: renamingTrip.origin.value,
          }}
          onClose={() => setRenaming(null)}
        />
      )}
      {collab && (
        <CollabDialogHost
          key={collab.tripId}
          open={collab.open}
          onClose={() => setCollab({ ...collab, open: false })}
          tripId={collab.tripId}
        />
      )}
      {sharing !== null && (
        <TripShareDialogHost
          open={sharing.open}
          onClose={() => setSharing({ ...sharing, open: false })}
          tripId={sharing.tripId}
        />
      )}
      {deletingTrip !== undefined && (
        <Dialog open onClose={() => setDeleting(null)} aria-labelledby="delete-trip-title">
          <DialogTitle id="delete-trip-title">여행 지우기</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {`‘${deletingTrip.title.value}’ 여행을 지울까요? 보관함의 장소는 지워지지 않아요.`}
            </DialogContentText>
            {liveIds.has(deletingTrip.id) && (
              <DialogContentText>
                갱신 링크는 서버에 남아요. 설정 › 갱신 링크에서 지울 수 있어요
              </DialogContentText>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleting(null)} sx={{ minHeight: 44 }}>
              취소
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => void confirmDelete()}
              sx={{ minHeight: 44 }}
            >
              삭제
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
