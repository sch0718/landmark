import { CodecError, decodeEditLayer } from 'src/domain/codec';
import { applyMerge, planMerge, type MergeSide } from 'src/domain/merge';
import { reconcile, type ReconcileReport } from 'src/domain/reconcile';
import { storageKey, withEditLock } from 'src/repositories/edit-layer-repo';
import type { TripLoadResult } from 'src/repositories/trip-repo';
import { LIMITS } from 'src/schema/common';
import { EDIT_LAYER_PARSE, EditLayerSchema, type EditLayer } from 'src/schema/legacy/edit-layer';
import { safeParse } from 'src/schema/parse';
import type { TripData } from 'src/schema/legacy/trip-data';

export type ImportInput = { kind: 'link'; value: string } | { kind: 'file'; file: Blob };

export type PreparedImport = {
  trip: TripData;
  tripRefreshed: boolean;
  local: EditLayer;
  /** 준비 시점 저장소의 원문(`readEditLayer().raw`). 처음 방문이면 null. */
  localSnapshot: string | null;
  incoming: EditLayer;
  incomingReport: ReconcileReport;
  plan: ReturnType<typeof planMerge>;
};

export type ImportFailureReason =
  'too-long' | 'too-large' | 'corrupt' | 'invalid' | 'other-trip' | 'trip-stale';

export type ImportFailure = { ok: false; reason: ImportFailureReason; message: string };

const MESSAGES: Record<ImportFailureReason, string> = {
  'too-long': '가져오기 데이터가 너무 커요',
  'too-large': '가져오기 데이터가 너무 커요',
  corrupt: '가져오기 데이터가 손상됐어요',
  invalid: '가져오기 데이터가 손상됐어요',
  'other-trip': '다른 여행의 편집이에요',
  'trip-stale': '최신 여행 데이터가 아직 반영되지 않았어요. 잠시 후 다시 시도하세요.',
};

const fail = (reason: ImportFailureReason): ImportFailure => ({
  ok: false,
  reason,
  message: MESSAGES[reason],
});

type Decoded = { ok: true; value: unknown } | ImportFailure;

async function decodeInput(input: ImportInput): Promise<Decoded> {
  if (input.kind === 'link') {
    try {
      return { ok: true, value: await decodeEditLayer(input.value) };
    } catch (e) {
      return fail(e instanceof CodecError ? e.code : 'corrupt');
    }
  }
  // 크기 제한은 읽기 전에 적용한다(§5.3).
  if (input.file.size > LIMITS.fileBytes) return fail('too-large');
  try {
    return { ok: true, value: JSON.parse(await input.file.text()) as unknown };
  } catch {
    return fail('corrupt');
  }
}

/**
 * 가져오기 §5.3 1–5단계: 크기 제한·해제·검증 → publicId 확인 → 원본 버전 맞추기 →
 * incoming 정리 → 미리보기 계획. 실패하면 사유만 돌려주고 아무것도 바꾸지 않는다.
 */
export async function prepareImport(
  input: ImportInput,
  ctx: {
    trip: TripData;
    local: EditLayer;
    localSnapshot: string | null;
    refetchTrip: () => Promise<TripLoadResult>;
  },
): Promise<{ ok: true; prepared: PreparedImport } | ImportFailure> {
  const decoded = await decodeInput(input);
  if (!decoded.ok) return decoded;

  const parsed = safeParse(EditLayerSchema, decoded.value, EDIT_LAYER_PARSE);
  if (!parsed.success) return fail('invalid');
  const rawIncoming = parsed.data;

  if (rawIncoming.publicId !== ctx.trip.publicId || ctx.local.publicId !== ctx.trip.publicId) {
    return fail('other-trip');
  }

  let trip = ctx.trip;
  let local = ctx.local;
  let tripRefreshed = false;
  if (rawIncoming.baseDataVersion > trip.dataVersion) {
    const refetched = await ctx.refetchTrip();
    if (!refetched.ok || refetched.trip.dataVersion < rawIncoming.baseDataVersion)
      return fail('trip-stale');
    trip = refetched.trip;
    local = reconcile(trip, ctx.local).edit;
    tripRefreshed = true;
  }

  const { edit: incoming, report: incomingReport } = reconcile(trip, rawIncoming);
  const plan = planMerge(local, incoming, trip);

  return {
    ok: true,
    prepared: {
      trip,
      tripRefreshed,
      local,
      localSnapshot: ctx.localSnapshot,
      incoming,
      incomingReport,
      plan,
    },
  };
}

/**
 * 가져오기 확정(§5.3 6단계). 잠금 안에서 저장소 원문이 준비 시점과 같을 때만 병합해 저장한다.
 * 그사이 다른 탭이 편집했으면 쓰지 않고 `changed`를 돌려준다 — 다시 준비해야 한다.
 * `signal`이 쓰기 전에 중단되면(대화상자 취소) AbortError로 거부하고 아무것도 쓰지 않는다.
 */
export async function commitImport(
  prepared: PreparedImport,
  choices: Record<string, MergeSide>,
  now: string,
  deps: { storage: Storage; locks?: LockManager; signal?: AbortSignal },
): Promise<{ ok: true; edit: EditLayer } | { ok: false; reason: 'changed' | string }> {
  const { publicId } = prepared.trip;
  return withEditLock(publicId, deps, () => {
    const key = storageKey(publicId);
    if (deps.storage.getItem(key) !== prepared.localSnapshot)
      return { ok: false, reason: 'changed' } as const;

    const result = applyMerge(prepared.local, prepared.incoming, prepared.trip, choices, now);
    if (result.ok) deps.storage.setItem(key, JSON.stringify(result.edit));
    return result;
  });
}
