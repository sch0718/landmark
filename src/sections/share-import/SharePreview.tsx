import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  defaultTitleLabel,
  existingShareIds,
  importShare,
  planShareLabels,
  shareTitle,
} from 'src/domain/library/import-share';
import { fieldSx } from 'src/components/field-style';
import { localDate } from 'src/lib/local-date';
import { labelNameIssue } from 'src/schema/library';
import type { ShareDoc } from 'src/schema/share';
import { resultMessage } from 'src/sections/add-place/shared';
import { useLibraryQuery } from 'src/sections/library/use-library-query';
import { ShareLabelRows } from 'src/sections/share-import/ShareLabelRows';
import { SharePlaceRows } from 'src/sections/share-import/SharePlaceRows';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';
import { nearbyOffAtom } from 'src/stores/my-location';

const NOTE_SX = { mt: 0.5, fontSize: 12, color: 'var(--tm-text-secondary)' } as const;

/**
 * 받은 공유 파일의 미리보기(스펙 §2.3). 머리글, 붙을 받은 라벨, 제목 라벨·메모 덧붙이기 스위치,
 * 장소 목록(체크박스), 가져오기. `이미 있음`·`내 라벨에 합침`은 화면에 보이는 보관함 기준의 안내이고,
 * 가져오기는 `LibraryStore.update` 한 번의 `importShare`로 최신본에 적용한다(토스트 개수도 그 결과에서 센다).
 * 공유 파일 가져오기에는 여행 대상이 붙지 않는다(＋ 시트가 여행 화면에서는 이 항목을 숨긴다).
 */
export function SharePreview({ doc }: { doc: ShareDoc }) {
  const library = useAtomValue(libraryAtom);
  const setFlow = useSetAtom(addFlowAtom);
  const { run } = useLibraryAction();
  const [, patchQuery] = useLibraryQuery();
  const nearbyOff = useSetAtom(nearbyOffAtom);

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(doc.places.map((place) => place.id)),
  );
  const [titleOn, setTitleOn] = useState(true);
  const [name, setName] = useState(() => defaultTitleLabel(doc.title));
  const [memoOn, setMemoOn] = useState(true);
  const [saving, setSaving] = useState(false);
  // 같은 이벤트 루프 안의 두 번째 클릭은 아직 `saving`을 못 본다.
  const savingRef = useRef(false);
  // 저장하는 사이 칸이 닫혔다면(칸의 닫기 버튼) 늦은 결과로 흐름·필터를 건드리지 않는다.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const nameErrorId = useId();
  const memoNoteId = useId();

  const trimmed = name.trim();
  const nameIssue = labelNameIssue(name);
  const nameTooLong = titleOn && nameIssue === 'too-long';
  const nameValid = nameIssue === null;
  // 제목 라벨을 붙이지 않거나 이름이 잘못됐으면 `null`(잘못된 이름은 버튼이 막는다).
  const titleLabel = titleOn && nameValid ? trimmed : null;
  const selectedIds = useMemo(() => [...selected], [selected]);
  // `이미 있음`은 보관함과 문서에만 달려 있다: 이름 입력·선택이 바뀔 때마다 같은 장소 찾기를 다시 하지 않는다.
  const existing = useMemo(() => existingShareIds(library, doc), [library, doc]);
  const plan = useMemo(
    () => planShareLabels(library, doc, selectedIds, titleLabel),
    [library, doc, selectedIds, titleLabel],
  );
  // 고른 장소 중 이미 있고 받은 메모가 있는 곳이 없으면 스위치를 끈 채 비활성으로 둔다.
  const memoApplies = doc.places.some(
    (place) => selected.has(place.id) && existing.has(place.id) && (place.memo ?? '') !== '',
  );
  const appendMemo = memoApplies && memoOn;
  const count = selected.size;
  const canImport = count > 0 && (!titleOn || nameValid) && !saving;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const submit = async () => {
    if (savingRef.current || !canImport) return;
    savingRef.current = true;
    setSaving(true);
    const input = { selected: selectedIds, titleLabel, appendMemo };
    // 이어지는 연산이 없어 `summary`·`createdId`(제목 라벨 id)는 `run` 결과에 그대로 실려 온다.
    const result = await run((lib, ctx) => importShare(lib, doc, input, ctx));
    // 칸이 닫힌 뒤에도 가져오기는 이미 저장소에 반영됐으므로 결과는 알린다.
    if (result.ok) {
      const message = result.summary === undefined ? null : resultMessage(result.summary);
      if (message !== null) toast(message);
    }
    // 칸이 닫혔다면 잠금 해제·필터·흐름 닫기는 건드리지 않는다(새 흐름을 닫을 수 있다).
    if (!aliveRef.current) return;
    savingRef.current = false;
    setSaving(false);
    // 연산 거절(OpRejected)은 보고되지 않는다. 제목 라벨 이름은 화면이 막으므로 드물고,
    // 그때는 미리보기와 선택을 그대로 두고 버튼만 다시 켠다.
    if (!result.ok) return;
    // 제목 라벨을 붙였으면 방금 가져온 장소가 모두 보이도록 그 라벨로 거르고 검색어·지역·방문 필터를 비운다.
    if (result.createdId !== undefined) {
      patchQuery({
        labelIds: [result.createdId],
        unlabeled: false,
        text: '',
        regions: [],
        visited: 'all',
      });
      // 근처 모드가 켜져 있으면 가져온 곳이 가려질 수 있어 함께 끈다.
      nearbyOff();
    }
    setFlow({ step: 'closed' });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 800, wordBreak: 'break-word' }}>
          {`${shareTitle(doc.title)} · ${doc.places.length}곳`}
        </Typography>
        <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
          {`${localDate(doc.createdAt)} 만든 파일`}
        </Typography>

        {plan.labels.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <ShareLabelRows labels={plan.labels} />
          </Box>
        )}

        <Box sx={{ mt: 2 }}>
          <FormControlLabel
            control={
              <Switch checked={titleOn} onChange={(event) => setTitleOn(event.target.checked)} />
            }
            label="파일 제목 라벨도 붙이기"
            sx={{ minHeight: 44 }}
          />
          {titleOn && (
            <>
              <Box
                component="input"
                type="text"
                aria-label="파일 제목 라벨 이름"
                aria-invalid={nameTooLong}
                aria-describedby={nameTooLong ? nameErrorId : undefined}
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
                sx={fieldSx({ invalid: nameTooLong })}
              />
              {nameTooLong && (
                <Box id={nameErrorId} role="alert" sx={{ ...NOTE_SX, color: 'error.main' }}>
                  라벨 이름은 30자까지예요
                </Box>
              )}
              {plan.titleReuse && <Box sx={NOTE_SX}>내 라벨에 합침</Box>}
            </>
          )}
        </Box>

        <Box sx={{ mt: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={appendMemo}
                disabled={!memoApplies}
                slotProps={{ input: { 'aria-describedby': memoNoteId } }}
                onChange={(event) => setMemoOn(event.target.checked)}
              />
            }
            label="받은 메모도 덧붙이기"
            sx={{ minHeight: 44 }}
          />
          <Box id={memoNoteId} sx={{ ...NOTE_SX, mt: 0 }}>
            이미 있는 장소에만 해당해요. 새로 넣는 장소에는 받은 메모가 그대로 들어가요
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 1 }}>
          <Button
            size="small"
            disabled={count === doc.places.length}
            onClick={() => setSelected(new Set(doc.places.map((place) => place.id)))}
            sx={{ minHeight: 44 }}
          >
            모두 선택
          </Button>
          <Button
            size="small"
            disabled={count === 0}
            onClick={() => setSelected(new Set())}
            sx={{ minHeight: 44 }}
          >
            모두 해제
          </Button>
        </Box>
        <SharePlaceRows doc={doc} selected={selected} existing={existing} onToggle={toggle} />
      </Box>
      <Box
        sx={{
          flex: 'none',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1,
          p: 2,
          borderTop: '1px solid var(--tm-border)',
        }}
      >
        <Button
          disabled={saving}
          onClick={() => setFlow({ step: 'closed' })}
          sx={{ minHeight: 44 }}
        >
          취소
        </Button>
        <Button
          variant="contained"
          disabled={!canImport}
          onClick={() => void submit()}
          sx={{ minHeight: 44 }}
        >
          {`${count}곳 가져오기`}
        </Button>
      </Box>
    </Box>
  );
}
