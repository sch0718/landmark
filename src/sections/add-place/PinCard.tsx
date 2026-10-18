import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Effect } from 'effect';
import { useSetAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fieldSx } from 'src/components/field-style';
import { addPlace } from 'src/domain/library/add-place';
import { forkEffect } from 'src/lib/effect/runtime';
import { useOpenPlace } from 'src/sections/library/use-open-place';
import { LIBRARY_LIMITS } from 'src/schema/library';
import { CardSection, useAliveRef, useCardLabels } from 'src/sections/add-place/card-parts';
import {
  SaveToLibraryOption,
  thenAddCandidates,
  useTripTarget,
} from 'src/sections/add-place/trip-target';
import { LabelPicker } from 'src/sections/place/LabelPicker';
import { ReverseGeocoder } from 'src/services/reverse-geocoder';
import { addFlowAtom } from 'src/stores/add-place';
import { useLibraryAction } from 'src/stores/library-state';

/** 주소 변환 상태. `missing`이면 사용자가 주소를 쓰기 전까지 안내를 보인다. */
type Geocode = 'loading' | 'found' | 'missing';

/**
 * 지도에서 고른 위치의 입력 카드(스펙 §2.4). 이름은 필수, 주소는 열 때 네이버 주소 변환으로 채우고
 * 고칠 수 있다(못 찾으면 빈칸과 안내). 출처는 직접 찍은 핀(`{ kind: 'pin' }`)이라 중복을 판단하지 않고,
 * 분류는 없다(`null`). 여행 대상이 붙은 흐름이면 `보관함에도 저장`을 고를 수 있고, 같은 연산에서 그 여행의 후보에
 * 넣은 뒤 계획 화면으로 간다.
 */
export function PinCard({
  name: initialName,
  lng,
  lat,
}: {
  name: string;
  lng: number;
  lat: number;
}) {
  const setFlow = useSetAtom(addFlowAtom);
  const { run } = useLibraryAction();
  const openPlace = useOpenPlace();
  const { labels, labelIds, shownIds, toggle, createAndSelect, creating } = useCardLabels();
  const { tripId, notify, backToTrip } = useTripTarget();
  const [keepInLibrary, setKeepInLibrary] = useState(true);

  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState('');
  const [geocode, setGeocode] = useState<Geocode>('loading');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  // 같은 이벤트 루프 안의 두 번째 클릭은 아직 `saving`을 못 본다.
  const savingRef = useRef(false);
  // 저장하는 사이 칸이 닫혔다면 늦은 결과로 흐름·경로를 건드리지 않는다.
  const aliveRef = useAliveRef();

  // 열릴 때 좌표를 주소로 바꾼다. 그사이 사용자가 주소를 썼다면 덮어쓰지 않는다. 닫히면 중단한다.
  useEffect(
    () =>
      forkEffect(
        Effect.gen(function* () {
          const geocoder = yield* ReverseGeocoder;
          const found = yield* geocoder.reverse(lng, lat);
          yield* Effect.sync(() => {
            if (found === null) {
              setGeocode('missing');
              return;
            }
            setGeocode('found');
            setAddress((current) => (current === '' ? found : current));
          });
        }),
      ),
    [lng, lat],
  );

  const trimmedName = name.trim();
  const canSave = trimmedName !== '' && !saving && !creating;

  const save = async () => {
    if (savingRef.current || trimmedName === '') return;
    savingRef.current = true;
    setSaving(true);
    const result = await run((lib, ctx) => {
      const added = addPlace(
        lib,
        {
          source: { kind: 'pin' },
          name: trimmedName,
          address: address.trim(),
          lng,
          lat,
          category: null,
        },
        {
          // 다른 탭이 그사이 지운 라벨은 빼고 넣는다(최신본 기준).
          labelIds: labelIds.filter((id) => lib.labels[id]?.deletedAt === null),
          memo,
          saved: tripId === null || keepInLibrary,
        },
        ctx,
      );
      return tripId === null
        ? added
        : thenAddCandidates(added, tripId, (done) => [done.createdId!], ctx);
    });
    savingRef.current = false;
    setSaving(false);
    // 저장소 오류는 앱 오류 보고자가 알린다. 카드와 입력은 그대로 둔다.
    if (!result.ok) return;
    // 칸이 닫힌 뒤에도 저장은 이미 반영됐으므로 알린다. 흐름 닫기·이동은 새 흐름을 닫을 수 있어 하지 않는다.
    // 여행 대상이면 후보에 넣은 결과를 알리고 계획 화면으로 간다(그사이 여행이 지워졌으면 보통의 추가로 끝낸다).
    if (tripId !== null && result.summary !== undefined) {
      notify(tripId, result.summary.created, [result.createdId!]);
      if (aliveRef.current) backToTrip(tripId);
      return;
    }
    toast('추가했어요');
    if (!aliveRef.current) return;
    setFlow({ step: 'closed' });
    openPlace(result.createdId!, 'map');
  };

  return (
    <Box sx={{ p: 2, pb: 4 }}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 800 }}>
        지도에서 핀 찍기
      </Typography>
      <CardSection title="이름">
        <Box
          component="input"
          type="text"
          aria-label="이름"
          aria-required="true"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          sx={fieldSx()}
        />
      </CardSection>
      <CardSection title="주소">
        <Box
          component="input"
          type="text"
          aria-label="주소"
          autoComplete="off"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          sx={fieldSx()}
        />
        {/* 주소를 찾는 동안, 사용자가 주소를 쓰기 전까지만 보인다. */}
        {geocode === 'loading' && address.trim() === '' && (
          <Box
            component="p"
            role="status"
            sx={{ m: 0, mt: 0.5, fontSize: 12, color: 'var(--tm-text-secondary)' }}
          >
            주소 찾는 중…
          </Box>
        )}
        {/* 주소 변환이 못 찾았을 때, 사용자가 주소를 쓰기 전까지만 보인다. */}
        {geocode === 'missing' && address.trim() === '' && (
          <Box
            component="p"
            sx={{ m: 0, mt: 0.5, fontSize: 12, color: 'var(--tm-text-secondary)' }}
          >
            주소를 찾지 못했어요. 직접 입력해 주세요
          </Box>
        )}
      </CardSection>
      <CardSection title="라벨">
        <LabelPicker
          labels={labels}
          attachedIds={shownIds}
          onToggle={toggle}
          onCreate={createAndSelect}
        />
      </CardSection>
      {tripId !== null && (
        <SaveToLibraryOption checked={keepInLibrary} onChange={setKeepInLibrary} />
      )}
      <CardSection title="메모">
        <Box
          component="textarea"
          aria-label="메모"
          rows={4}
          maxLength={LIBRARY_LIMITS.memoChars}
          placeholder="이 장소에 대한 메모"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          sx={fieldSx({ multiline: true })}
        />
      </CardSection>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2.5 }}>
        <Button
          disabled={saving}
          onClick={() => setFlow({ step: 'closed' })}
          sx={{ minHeight: 44 }}
        >
          취소
        </Button>
        <Button
          variant="contained"
          disabled={!canSave}
          onClick={() => void save()}
          sx={{ minHeight: 44 }}
        >
          추가
        </Button>
      </Box>
    </Box>
  );
}
