import {
  addLabels,
  findLiveLabelByName,
  type OpCtx,
  type OpResult,
  type OpError,
} from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import { suggestLabelEmoji } from 'src/domain/library/label-emoji';
import { LABEL_COLORS, labelNameIssue, type Label, type Library } from 'src/schema/library';

const fail = (error: OpError): OpResult => ({ ok: false, error });

export function createLabel(lib: Library, name: string, ctx: OpCtx): OpResult {
  if (labelNameIssue(name) !== null) {
    return fail({ _tag: 'LabelNameInvalid', name });
  }
  const trimmed = name.trim();
  if (findLiveLabelByName(lib, trimmed) !== undefined) {
    return fail({ _tag: 'LabelNameTaken', name: trimmed });
  }
  const live = liveLabels(lib);
  const id = ctx.newId('label');
  const emoji = suggestLabelEmoji(trimmed);
  const label: Label = {
    id,
    name: { value: trimmed, updatedAt: ctx.now },
    color: { value: LABEL_COLORS[live.length % LABEL_COLORS.length]!, updatedAt: ctx.now },
    icon: { value: 'star', updatedAt: ctx.now },
    ...(emoji === null ? {} : { emoji: { value: emoji, updatedAt: ctx.now } }),
    order: {
      value: live.reduce((max, l) => Math.max(max, l.order.value), -1) + 1,
      updatedAt: ctx.now,
    },
    createdAt: ctx.now,
    deletedAt: null,
  };
  return { ok: true, lib: { ...lib, labels: { ...lib.labels, [id]: label } }, createdId: id };
}

/**
 * 이름이 같은(정규화) 살아 있는 라벨이 있으면 그 라벨을, 없으면 새로 만들어 장소에 붙인다.
 * `createdId`는 새로 만든 경우에만 있다.
 */
export function createAndAttachLabel(
  lib: Library,
  placeId: string,
  name: string,
  ctx: OpCtx,
): OpResult {
  if (lib.places[placeId] === undefined) return fail({ _tag: 'NotFound', id: placeId });
  if (labelNameIssue(name) !== null) {
    return fail({ _tag: 'LabelNameInvalid', name });
  }
  const trimmed = name.trim();
  const existing = findLiveLabelByName(lib, trimmed);
  if (existing !== undefined) {
    return { ok: true, lib: addLabels(lib, [placeId], [existing.id], ctx) };
  }
  const created = createLabel(lib, trimmed, ctx);
  if (!created.ok) return created;
  return {
    ok: true,
    lib: addLabels(created.lib, [placeId], [created.createdId!], ctx),
    createdId: created.createdId,
  };
}
