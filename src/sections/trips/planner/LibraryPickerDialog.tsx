import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import InputBase from '@mui/material/InputBase';
import { useAtomValue } from 'jotai';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SearchIcon } from 'src/components/icons';
import {
  DEFAULT_QUERY,
  labelCounts,
  liveLabels,
  queryPlaces,
  regionCounts,
  type LibraryQuery,
} from 'src/domain/library/query';
import { addCandidates } from 'src/domain/trips/ops';
import { locatePlace } from 'src/domain/trips/query';
import type { Place } from 'src/schema/library';
import { LabelChips } from 'src/sections/library/LabelChips';
import { RegionChips } from 'src/sections/library/RegionChips';
import {
  addedNotice,
  ALREADY_CANDIDATE,
  locationNotice,
} from 'src/sections/trips/candidate-notice';
import { useTripUndo } from 'src/sections/trips/planner/use-trip-undo';
import { libraryAtom } from 'src/stores/library-state';

type Props = { open: boolean; tripId: string; onClose(): void };

/** 장소 한 줄. 이미 이 여행에 있으면 체크 상자를 막고 어디에 있는지 보인다. */
function PickRow({
  place,
  checked,
  notice,
  onToggle,
}: {
  place: Place;
  checked: boolean;
  /** `이미 Day <N>에 있어요` / `이미 후보에 있어요`. 여행에 없으면 null. */
  notice: string | null;
  onToggle(): void;
}) {
  const inTrip = notice !== null;
  return (
    <Box component="li" sx={{ listStyle: 'none', borderBottom: '1px solid var(--tm-border)' }}>
      <Box
        component="label"
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.25,
          minHeight: 44,
          py: 1,
          cursor: inTrip ? 'default' : 'pointer',
          opacity: inTrip ? 0.6 : 1,
        }}
      >
        <Box
          component="input"
          type="checkbox"
          checked={inTrip || checked}
          disabled={inTrip}
          onChange={onToggle}
          sx={{ flex: 'none', width: 20, height: 20, m: 0, mt: '2px' }}
        />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>
            {place.name.value}
          </Box>
          {place.address !== '' && (
            <Box sx={{ fontSize: 13, color: 'var(--tm-text-secondary)', overflowWrap: 'anywhere' }}>
              {place.address}
            </Box>
          )}
          {inTrip && (
            <Box sx={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-secondary)' }}>
              {notice}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * 계획 화면의 `보관함에서 더하기`(스펙 §2.2의 3). 보관함 목록을 지역·라벨·검색으로 걸러 체크하고 `<N>곳 넣기`로
 * 후보에 더한다(되돌리기 토스트). 거른 조건은 이 창 안에서만 쓰고 보관함 화면의 조건은 건드리지 않는다.
 * 체크는 조건을 바꿔도 남는다. 닫았다 열면 처음부터다.
 */
export function LibraryPickerDialog({ open, tripId, onClose }: Props) {
  const library = useAtomValue(libraryAtom);
  const { run } = useTripUndo(tripId);
  const titleId = useId();
  const [query, setQuery] = useState<LibraryQuery>(DEFAULT_QUERY);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // 다시 열리면 처음 상태로 돌아간다(렌더 중 상태 맞추기).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery(DEFAULT_QUERY);
      setChecked(new Set());
      setSubmitting(false);
    }
  }

  const trip = library.trips[tripId];
  const labels = useMemo(() => liveLabels(library), [library]);
  const { places, counts, regions } = useMemo(
    () => ({
      places: queryPlaces(library, query),
      counts: labelCounts(library, query),
      regions: regionCounts(library, query),
    }),
    [library, query],
  );
  const noticeOf = (placeId: string) =>
    trip === undefined ? null : locationNotice(locatePlace(trip, placeId));
  // 그사이 이 여행에 들어간 장소는 넣을 것에서 뺀다.
  const picked = [...checked].filter((id) => noticeOf(id) === null);

  const patch = (change: Partial<LibraryQuery>) => setQuery((prev) => ({ ...prev, ...change }));
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const submit = async () => {
    if (submitting || picked.length === 0) return;
    setSubmitting(true);
    const ids = picked;
    // 문구는 체크한 수가 아니라 저장된 최신본에서 새로 넣은 수다(그사이 다른 탭이 먼저 넣었을 수 있다).
    const result = await run(
      (lib, ctx) => addCandidates(lib, tripId, ids, ctx),
      (done) => addedNotice(done.summary?.created ?? ids.length),
    );
    setSubmitting(false);
    // 새로 넣은 곳이 없으면 바뀐 것이 없어 되돌리기 토스트도 없다. 이미 있다고만 알린다.
    if (result.ok && result.summary?.created === 0) toast(ALREADY_CANDIDATE);
    // 실패는 저장소 오류 보고자가 알린다. 창과 체크는 그대로 둔다.
    if (result.ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      fullWidth
      maxWidth="sm"
      scroll="paper"
    >
      <DialogTitle id={titleId}>보관함에서 더하기</DialogTitle>
      <Box sx={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 0.5, pb: 1 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minHeight: 44,
            mx: 3,
            px: 1.5,
            borderRadius: 'var(--tm-radius-md)',
            bgcolor: 'var(--tm-bg-raised)',
            border: '1px solid var(--tm-border)',
            color: 'var(--tm-text-muted)',
            '&:focus-within': { borderColor: 'var(--tm-accent-main)' },
          }}
        >
          <SearchIcon aria-hidden="true" width={18} height={18} />
          <InputBase
            fullWidth
            type="search"
            value={query.text}
            placeholder="이름·주소·메모·라벨 검색"
            onChange={(event) => patch({ text: event.target.value })}
            slotProps={{ input: { 'aria-label': '장소 검색' } }}
            sx={{ color: 'var(--tm-text-primary)' }}
          />
        </Box>
        <LabelChips
          query={query}
          onChange={patch}
          labels={labels}
          counts={counts}
          manageLink={false}
        />
        <RegionChips
          regions={regions}
          selected={query.regions}
          onChange={(next) => patch({ regions: next })}
        />
      </Box>
      <DialogContent dividers sx={{ py: 0 }}>
        {places.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center', color: 'var(--tm-text-secondary)' }}>
            조건에 맞는 장소가 없어요
          </Box>
        ) : (
          <Box component="ul" aria-label="보관함 장소" sx={{ m: 0, p: 0 }}>
            {places.map((place) => (
              <PickRow
                key={place.id}
                place={place}
                checked={checked.has(place.id)}
                notice={noticeOf(place.id)}
                onToggle={() => toggle(place.id)}
              />
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          취소
        </Button>
        <Button
          variant="contained"
          disabled={picked.length === 0 || submitting}
          onClick={() => void submit()}
          sx={{ minHeight: 44 }}
        >
          {`${picked.length}곳 넣기`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
