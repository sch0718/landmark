import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { OpSummary } from 'src/domain/library/ops';
import { planFolderSync, syncFolder } from 'src/domain/library/folder-links';
import { localDate } from 'src/lib/local-date';
import { paths } from 'src/routes/paths';
import type { FolderLink } from 'src/schema/library';
import { FolderPlaceRows } from 'src/sections/add-place/FolderPlaceRows';
import { resultMessage, type FolderPlace } from 'src/sections/add-place/shared';
import { useLibraryQuery } from 'src/sections/library/use-library-query';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

const MARK_TEXT = { 'in-library': '이미 있음', deleted: '지웠던 곳' } as const;

/** 연산 거절 중 `NotFound`인가(연결이 없어짐). `run`의 실패는 저장소 오류일 수도 있어 모양을 본다. */
const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { _tag?: unknown })._tag === 'NotFound';

/** 구역 제목(h3)과 그 오른쪽의 단추. */
function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2, mb: 0.5, minHeight: 44 }}>
      <Box
        component="h3"
        sx={{ m: 0, flex: 1, fontSize: 13, fontWeight: 800, color: 'var(--tm-text-secondary)' }}
      >
        {title}
      </Box>
      {action}
    </Box>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body2" sx={{ mb: 1, color: 'var(--tm-text-secondary)' }}>
      {children}
    </Typography>
  );
}

/**
 * 연결된 폴더의 다시 가져오기 미리보기(스펙 §4.3). 본 장소에 없던 곳(`새로 저장한 곳`)만 체크해 보이고,
 * 전에 봤는데 보관함에서 지운 곳은 체크 없이, 폴더에서 빠진 곳은 이름만 보인다.
 * 분류는 화면에 보이는 보관함 기준의 안내이고, 가져오기는 `syncFolder`가 최신본으로 다시 판단한다.
 * 누르는 사이 연결이 없어졌으면(다른 탭이 끊음·라벨을 지움) 칸 안에 알리고 선택을 그대로 둔다.
 */
export function FolderResync({
  shareId,
  folderName,
  places,
  link,
  onShowAll,
}: {
  shareId: string;
  folderName: string;
  places: FolderPlace[];
  link: FolderLink;
  onShowAll(): void;
}) {
  const library = useAtomValue(libraryAtom);
  const setFlow = useSetAtom(addFlowAtom);
  const { run } = useLibraryAction();
  const [, patchQuery] = useLibraryQuery();
  const navigate = useNavigate();
  const plan = useMemo(() => planFolderSync(library, link, places), [library, link, places]);
  const freshItems = useMemo(() => plan.fresh.map(({ item }) => item), [plan]);
  const marks = useMemo(
    () =>
      new Map(
        plan.fresh.flatMap(({ item, mark }) =>
          mark === null ? [] : [[item.sid, MARK_TEXT[mark]] as const],
        ),
      ),
    [plan],
  );

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(freshItems.map((item) => item.sid)),
  );
  const [saving, setSaving] = useState(false);
  const [linkChanged, setLinkChanged] = useState(false);
  // 같은 이벤트 루프 안의 두 번째 클릭은 아직 `saving`을 못 본다.
  const savingRef = useRef(false);
  // 저장하는 사이 칸이 닫혔다면 늦은 결과로 흐름을 건드리지 않는다(토스트는 띄운다).
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const name = folderName.trim() === '' ? '이름 없는 폴더' : folderName;
  const labelName = library.labels[link.labelId.value]?.name.value ?? '';
  const checkedDay = localDate(link.checkedAt);
  // 지금 보이는 두 목록에서 고른 것만 센다(분류가 바뀌어 사라진 곳의 선택은 넘기지 않는다).
  const pickedSids = [...freshItems, ...plan.deleted]
    .map((item) => item.sid)
    .filter((sid) => selected.has(sid));
  const count = pickedSids.length;
  const allFreshSelected = freshItems.length > 0 && freshItems.every((i) => selected.has(i.sid));

  const toggle = (sid: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(sid)) next.add(sid);
      return next;
    });

  const toggleAllFresh = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const item of freshItems) {
        if (allFreshSelected) next.delete(item.sid);
        else next.add(item.sid);
      }
      return next;
    });

  const showInLibrary = (labelId: string) => {
    // 새로 넣은 곳은 안 가 본 곳이므로 방문 필터도 `전체`로 푼다.
    patchQuery({ labelIds: [labelId], unlabeled: false, text: '', regions: [], visited: 'all' });
    void navigate(paths.library);
  };

  const submit = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setLinkChanged(false);
    // 연산 안에서 채운다. 저장소가 다시 시도하면 다시 채운다.
    const box: { summary?: OpSummary } = {};
    const result = await run((lib, ctx) => {
      const out = syncFolder(lib, { shareId, folderName, items: places, pickedSids }, ctx);
      box.summary = out.ok ? out.summary : undefined;
      return out;
    });
    // 칸이 닫힌 뒤에도 가져오기는 이미 저장소에 반영됐으므로 결과는 알린다.
    if (result.ok) {
      const message = box.summary === undefined ? null : resultMessage(box.summary);
      const labelId = result.createdId ?? link.labelId.value;
      if (message !== null) {
        toast(message, {
          action: { label: '보관함에서 보기', onClick: () => showInLibrary(labelId) },
        });
      } else {
        toast(`‘${name}’ 폴더를 확인했어요`);
      }
    }
    if (!aliveRef.current) return;
    savingRef.current = false;
    setSaving(false);
    if (!result.ok) {
      // 연산 거절은 연결이 없어진 경우뿐이다. 저장소 오류는 앱 오류 보고자가 알린다.
      if (isNotFound(result.error)) setLinkChanged(true);
      return;
    }
    setFlow({ step: 'closed' });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 800, wordBreak: 'break-word' }}>
          {name}
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5, color: 'var(--tm-text-secondary)' }}>
          {`‘${labelName}’ 라벨 · 지난 확인 ${checkedDay}`}
        </Typography>
        <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
          {`새로 저장한 곳 ${plan.fresh.length} · 그대로 ${plan.unchanged} · 폴더에서 빠진 곳 ${plan.missing.length}`}
        </Typography>

        <SectionHead
          title="새로 저장한 곳"
          action={
            freshItems.length > 0 && (
              <Button size="small" onClick={toggleAllFresh} sx={{ minHeight: 44 }}>
                {allFreshSelected ? '전체 해제' : '전체 선택'}
              </Button>
            )
          }
        />
        {freshItems.length === 0 ? (
          <Hint>{`${checkedDay} 뒤로 새로 저장한 곳이 없어요`}</Hint>
        ) : (
          <FolderPlaceRows
            places={freshItems}
            selected={selected}
            marks={marks}
            onToggle={toggle}
            label="새로 저장한 곳"
          />
        )}

        {plan.deleted.length > 0 && (
          <>
            <SectionHead title="보관함에서 지운 곳" />
            <Hint>전에 가져왔다가 보관함에서 지운 곳이에요. 다시 넣으려면 고르세요</Hint>
            <FolderPlaceRows
              places={plan.deleted}
              selected={selected}
              marks={new Map()}
              onToggle={toggle}
              label="보관함에서 지운 곳"
            />
          </>
        )}

        {plan.missing.length > 0 && (
          <>
            <SectionHead title="폴더에서 빠진 곳" />
            <Hint>네이버 폴더에서는 빠졌지만 보관함에서는 지우지 않았어요</Hint>
            <Box
              component="ul"
              aria-label="폴더에서 빠진 곳"
              sx={{ listStyle: 'none', m: 0, p: 0, borderTop: '1px solid var(--tm-border)' }}
            >
              {plan.missing.map((place) => (
                <Box
                  component="li"
                  key={place.sid}
                  sx={{ minHeight: 44, py: 1, borderBottom: '1px solid var(--tm-border)' }}
                >
                  <Box sx={{ fontSize: 15, fontWeight: 700, wordBreak: 'break-word' }}>
                    {place.name}
                  </Box>
                  <Box
                    sx={{
                      fontSize: 13,
                      color: 'var(--tm-text-secondary)',
                      wordBreak: 'break-word',
                    }}
                  >
                    {place.address}
                  </Box>
                </Box>
              ))}
            </Box>
          </>
        )}
      </Box>
      {linkChanged && (
        <Typography role="alert" variant="body2" color="error" sx={{ px: 2, pt: 1 }}>
          폴더 연결이 바뀌었어요. 창을 닫고 다시 열어 주세요
        </Typography>
      )}
      <Box
        sx={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 2,
          borderTop: '1px solid var(--tm-border)',
        }}
      >
        <Button disabled={saving} onClick={onShowAll} sx={{ minHeight: 44, mr: 'auto' }}>
          폴더 전체 보기
        </Button>
        <Button
          disabled={saving}
          onClick={() => setFlow({ step: 'closed' })}
          sx={{ minHeight: 44 }}
        >
          취소
        </Button>
        <Button
          variant="contained"
          disabled={saving}
          onClick={() => void submit()}
          sx={{ minHeight: 44 }}
        >
          {count > 0 ? `${count}곳 가져오기` : '확인했어요'}
        </Button>
      </Box>
    </Box>
  );
}
