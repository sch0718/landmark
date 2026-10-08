import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAtomValue, useStore } from 'jotai';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  planLegacyImport,
  type ImportPlan,
  type LegacySource,
} from 'src/domain/library/legacy-import';
import { startEffect } from 'src/lib/effect/runtime';
import { LegacyImportStale } from 'src/services/errors';
import {
  labelNameError,
  mergePending,
  NO_DECISIONS,
  NO_ITEMS,
  toChoices,
  type Decisions,
  type Items,
} from 'src/sections/settings/import-decisions';
import { applyLegacyImport, mintId } from 'src/sections/settings/import-effects';
import { LabelNameItem, MemoLengthItem } from 'src/sections/settings/PendingItems';
import { libraryAtom, reflectSaved } from 'src/stores/library-state';

const STALE_MESSAGE = new LegacyImportStale().userMessage;

type View = {
  plan: ImportPlan;
  decisions: Decisions;
  items: Items;
  notice: string | null;
  busy: boolean;
  failed: boolean;
};

type Props = {
  source: LegacySource;
  /** 가져오기가 끝났다. `added`는 새로 추가한 장소 수. */
  onImported(added: number): void;
};

const summaryText = (s: ImportPlan['summary']): string =>
  `새로 추가 ${s.added} · 이미 있음 ${s.existing}(라벨만 합침) · 새 라벨 ${s.newLabels} · 확인 필요 ${s.needsDecision}`;

/**
 * 옛 여행 가져오기 미리보기와 확인 대상 결정(스펙 §4.6). 결정이 바뀔 때마다 이전 계획의 ID·시각을 그대로 써서
 * 다시 계획하고, 적용은 최신 보관함 기준으로 다시 계산해 의미가 달라졌으면 새 미리보기만 보여 준다.
 */
export function ImportPreview({ source, onImported }: Props) {
  const jotaiStore = useStore();
  const library = useAtomValue(libraryAtom);
  const [view, setView] = useState<View>(() => {
    const plan = planLegacyImport(
      jotaiStore.get(libraryAtom),
      source,
      { labels: {}, memos: {} },
      null,
      mintId,
      new Date().toISOString(),
    );
    const merged = mergePending(NO_ITEMS, NO_DECISIONS, plan.pending, source);
    return { plan, ...merged, notice: null, busy: false, failed: false };
  });

  /** 결정이 바뀌었거나 보관함이 바뀌었을 때 계획을 다시 만든다. ID와 시각은 이전 것을 쓴다. */
  const replan = (prev: View, decisions: Decisions, notice: string | null): View => {
    const lib = jotaiStore.get(libraryAtom);
    const plan = planLegacyImport(
      lib,
      source,
      toChoices(decisions, lib, source),
      prev.plan.ids,
      mintId,
      prev.plan.ids.now,
    );
    return { ...prev, plan, ...mergePending(prev.items, decisions, plan.pending, source), notice };
  };

  const decide = (change: (d: Decisions) => Decisions) =>
    setView({ ...replan(view, change(view.decisions), null), failed: false });

  const { plan, decisions, items } = view;
  const errors = new Map(
    items.labels.map((item) => [
      item.key,
      decisions.labels[item.key]?.confirmed === true
        ? labelNameError(item.key, decisions, library, source)
        : null,
    ]),
  );
  const hasError = [...errors.values()].some((e) => e !== null);
  const canImport = plan.pending.length === 0 && !hasError && !view.busy;

  const apply = async () => {
    const before = jotaiStore.get(libraryAtom);
    const choices = toChoices(decisions, before, source);
    setView({ ...view, busy: true, failed: false });
    const outcome = await startEffect(applyLegacyImport(source, choices, plan));
    if (outcome.kind === 'applied') {
      await reflectSaved(jotaiStore, before, outcome.library);
      toast(`${outcome.added}곳을 가져왔어요`);
      onImported(outcome.added);
      return;
    }
    if (outcome.kind === 'stale') {
      await reflectSaved(jotaiStore, before, outcome.library);
      setView({ ...replan(view, view.decisions, STALE_MESSAGE), busy: false });
      return;
    }
    setView({ ...view, busy: false, failed: true });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography role="status" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
        {summaryText(plan.summary)}
      </Typography>
      {view.notice !== null && <Alert severity="info">{view.notice}</Alert>}

      {items.labels.length + items.memos.length > 0 && (
        // 적용하는 동안 결정을 바꾸지 못하게 막는다(적용에 쓴 결정과 화면이 어긋나지 않게).
        <Box component="fieldset" disabled={view.busy} sx={{ m: 0, p: 0, minWidth: 0, border: 0 }}>
          <Box
            component="ul"
            aria-label="확인이 필요한 항목"
            sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}
          >
            {items.labels.map((item) => (
              <LabelNameItem
                key={item.key}
                item={item}
                draft={decisions.labels[item.key]!}
                error={errors.get(item.key) ?? null}
                onChange={(draft) =>
                  decide((d) => ({ ...d, labels: { ...d.labels, [item.key]: draft } }))
                }
              />
            ))}
            {items.memos.map((item) => (
              <MemoLengthItem
                key={item.placeKey}
                item={item}
                decision={decisions.memos[item.placeKey]}
                fullMemo={plan.places.find((p) => p.placeKey === item.placeKey)?.fullMemo ?? ''}
                onChange={(decision) =>
                  decide((d) => ({ ...d, memos: { ...d.memos, [item.placeKey]: decision } }))
                }
              />
            ))}
          </Box>
        </Box>
      )}

      {view.failed && (
        <Typography role="alert" variant="body2" color="error">
          가져오지 못했어요
        </Typography>
      )}
      <Box>
        <Button
          variant="contained"
          disabled={!canImport}
          onClick={() => void apply()}
          sx={{ minHeight: 44 }}
        >
          가져오기
        </Button>
      </Box>
    </Box>
  );
}
