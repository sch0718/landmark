import { Schema } from 'effect';
import { LIVE_ID_PATTERN } from 'src/domain/trip-live/live-doc';
import { safeParse } from 'src/schema/parse';
import { tripLiveStore } from './store';

// 2B 전용 자료다. 2A는 모르는 필드가 있는 기록을 버리므로 기존 키에 섞지 않는다.
export const TRIP_LIVE_PLAN_KEY = 'tripmap:trip-live-plan:v1';
type PlanRecord = { liveId: string; planKey: string; publishedKey: string };
const id = Schema.String.check(Schema.isPattern(LIVE_ID_PATTERN));
const recordsSchema = Schema.Record(
  id,
  Schema.Struct({ liveId: id, planKey: Schema.String, publishedKey: Schema.String }),
);

export function createTripLivePlanStore(
  liveStore: Pick<typeof tripLiveStore, 'get'> = tripLiveStore,
  storage: () => Storage = () => window.localStorage,
) {
  let memory: Record<string, PlanRecord> = {},
    memoryOnly = false;

  function read(): Record<string, PlanRecord> {
    if (!memoryOnly) {
      let raw: string | null;
      try {
        raw = storage().getItem(TRIP_LIVE_PLAN_KEY);
      } catch {
        memoryOnly = true;
        return memory;
      }
      try {
        const parsed = safeParse(recordsSchema, JSON.parse(raw ?? '{}'), {
          onExcessProperty: 'error',
        });
        memory = parsed.success ? parsed.data : {};
      } catch {
        memory = {};
      }
    }
    return memory;
  }

  function matches(tripId: string, plan: PlanRecord): boolean {
    const record = liveStore.get(tripId);
    // 2A로 롤백한 동안 새로 공개해도 전용 키는 남으므로 공개 지문도 맞아야 한다.
    return record?.liveId === plan.liveId && record.publishedKey === plan.publishedKey;
  }

  function get(tripId: string): string | undefined {
    const plan = read()[tripId];
    return plan && matches(tripId, plan) ? plan.planKey : undefined;
  }

  function put(tripId: string, liveId: string, planKey: string) {
    const record = liveStore.get(tripId);
    if (!record || record.liveId !== liveId || record.publishedKey === undefined) return;
    // 삭제·상한 정리·공유 다시 만들기 뒤의 값을 빼고 2A의 최대 100개에 맞춘다.
    memory = Object.fromEntries(
      Object.entries({
        ...read(),
        [tripId]: { liveId, planKey, publishedKey: record.publishedKey },
      }).filter(([key, plan]) => matches(key, plan)),
    );
    if (!memoryOnly)
      try {
        storage().setItem(TRIP_LIVE_PLAN_KEY, JSON.stringify(memory));
      } catch {
        memoryOnly = true;
      }
  }

  return { get, put };
}

export const tripLivePlanStore = createTripLivePlanStore();
