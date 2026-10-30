import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import { useId, useState } from 'react';
import type {
  CollabConflict,
  CollabSide,
  FieldConflict,
  ListId,
} from 'src/domain/trip-collab/merge';
import { libraryAtom } from 'src/stores/library-state';
import { useTripCollab } from './use-trip-collab';
const listLabel = (id: ListId) => (id === 'c' ? '후보 목록' : `Day ${Number(id.slice(1)) + 1}`);
function fieldLabel(c: FieldConflict, name: (id: string) => string): string {
  const day = (c.dayIndex ?? 0) + 1,
    place = name(c.placeId ?? '');
  return c.field === 'title'
    ? '여행 이름'
    : c.field === 'origin'
      ? '출발지'
      : c.field === 'startTime'
        ? `Day ${day} 출발 시각`
        : c.field === 'lodging'
          ? `Day ${day} 숙소`
          : c.field === 'stayMin'
            ? `‘${place}’ 머무는 시간`
            : c.field === 'fixedTime'
              ? `‘${place}’ 도착 시각 고정`
              : c.field === 'note'
                ? `‘${place}’ 메모`
                : `‘${name(c.legKey?.split('>')[0] ?? '')}’→‘${name(c.legKey?.split('>')[1] ?? '')}’ 이동 수단`;
}
export function CollabConflictDialog({
  open,
  onClose,
  tripId,
}: {
  open: boolean;
  onClose(): void;
  tripId: string;
}) {
  const view = useTripCollab(tripId, open),
    lib = useAtomValue(libraryAtom),
    heading = useId(),
    conflicts = view.merge?.conflicts ?? [];
  const signature = conflicts
    .map((c) => c.id)
    .sort()
    .join('|');
  const [state, setState] = useState<{
    signature: string;
    choices: Record<string, CollabSide>;
    notice: boolean;
  }>({ signature, choices: {}, notice: false });
  let current = state;
  if (signature !== state.signature) {
    current = {
      signature,
      choices: Object.fromEntries(
        Object.entries(state.choices).filter(([key]) => conflicts.some((c) => c.id === key)),
      ),
      notice: state.signature !== '',
    };
    setState(current);
  }
  const [busy, setBusy] = useState(false),
    name = (id: string) =>
      lib.places[view.record?.placeMap[id] ?? '']?.name.value ?? '알 수 없는 장소';
  const label = (c: CollabConflict) =>
    c.kind === 'field'
      ? fieldLabel(c, name)
      : c.period
        ? '여행 기간과 장소 배치'
        : c.lists.length === 1
          ? c.lists[0] === 'c'
            ? '후보 목록'
            : `${listLabel(c.lists[0]!)} 장소 순서`
          : `${c.lists.map(listLabel).join('·')} 장소 배치`;
  const value = (c: FieldConflict, side: CollabSide) => {
    const v = c[side];
    return v === null || v === undefined || v === ''
      ? '없음'
      : c.field === 'origin' || c.field === 'lodging'
        ? name(String(v))
        : c.field === 'stayMin'
          ? `${v}분`
          : c.field === 'legMode'
            ? v === 'walk'
              ? '도보'
              : '자동차'
            : String(v);
  };
  const chooseAll = (side: CollabSide) =>
    setState({ ...current, choices: Object.fromEntries(conflicts.map((c) => [c.id, side])) });
  async function resolve() {
    if (!view.engine) return;
    setBusy(true);
    try {
      await view.engine.resolve(current.choices);
      if (view.engine.getSnapshot().state !== 'conflict') onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      sx={{ '& .MuiButton-root': { minHeight: 44 } }}
      open={open}
      onClose={onClose}
      aria-labelledby={heading}
      fullWidth
      maxWidth="md"
    >
      <DialogTitle id={heading}>겹친 변경 비교</DialogTitle>
      <DialogContent>
        <Typography>
          이 기기와 다른 기기에서 같은 곳을 고쳤어요. 곳마다 남길 쪽을 골라 주세요. 고르지 않은 쪽의
          변경은 사라져요
        </Typography>
        {current.notice && (
          <Typography role="alert">그사이 공동 여행이 또 바뀌었어요. 다시 골라 주세요</Typography>
        )}
        {conflicts.map((c) => (
          <Box key={c.id} component="section" sx={{ mt: 2 }}>
            <Typography component="h3">{label(c)}</Typography>
            <RadioGroup
              row
              aria-label={label(c)}
              value={current.choices[c.id] ?? ''}
              onChange={(_, v) =>
                setState({ ...current, choices: { ...current.choices, [c.id]: v as CollabSide } })
              }
            >
              {(['mine', 'theirs'] as const).map((side) => (
                <Box key={side} sx={{ flex: 1, minWidth: 0 }}>
                  <FormControlLabel
                    value={side}
                    control={<Radio />}
                    label={side === 'mine' ? '이 기기' : '공동 여행'}
                  />
                  {c.kind === 'field' ? (
                    <Typography>{value(c, side)}</Typography>
                  ) : (
                    <>
                      {c.period && (
                        <Typography>
                          {c[side].period.startDate} ~ {c[side].period.endDate}
                        </Typography>
                      )}
                      {c.lists.map((id) => (
                        <Box key={id}>
                          <Typography>{listLabel(id)}</Typography>
                          <Box component="ol" sx={{ pl: 3 }}>
                            {(c[side].lists[id] ?? []).map((p, i) => (
                              <Box
                                component="li"
                                key={p}
                                sx={{
                                  fontWeight:
                                    c[side === 'mine' ? 'theirs' : 'mine'].lists[id]?.[i] !== p
                                      ? 800
                                      : 400,
                                }}
                              >
                                {name(p)}
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      ))}
                    </>
                  )}
                </Box>
              ))}
            </RadioGroup>
          </Box>
        ))}
        <Button onClick={() => chooseAll('mine')}>모두 이 기기로</Button>
        <Button onClick={() => chooseAll('theirs')}>모두 공동 여행으로</Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>나중에</Button>
        <Button
          sx={{ minHeight: 44 }}
          disabled={busy || !conflicts.length || conflicts.some((c) => !current.choices[c.id])}
          onClick={() => void resolve()}
        >
          고른 대로 맞추기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
