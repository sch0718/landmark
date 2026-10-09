import { Context, Effect, Layer } from 'effect';
import { browserStorage } from 'src/services/browser-storage';
import { createMemoryStorage, isStorageAvailable } from 'src/repositories/edit-layer-repo';
import { safeParse } from 'src/schema/parse';
import { DEFAULT_PREFS, PrefsSchema, type Prefs } from 'src/schema/prefs';

export const PREFS_KEY = 'tripmap:prefs';

const freshDefaults = (): Prefs => structuredClone(DEFAULT_PREFS);

function readPrefs(storage: Storage): Prefs {
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (raw === null) return freshDefaults();
    const parsed = safeParse(PrefsSchema, JSON.parse(raw));
    return parsed.success ? parsed.data : freshDefaults();
  } catch {
    return freshDefaults();
  }
}

/**
 * UI 선호(테마·보기 방식·필터). 잃어도 되는 데이터라서 읽기 실패·검증 실패는 기본값으로,
 * 쓰기 실패는 콘솔 경고만 남기고 넘어간다.
 */
export class PrefsStore extends Context.Service<
  PrefsStore,
  { readonly get: Effect.Effect<Prefs>; set(prefs: Prefs): Effect.Effect<void> }
>()('tripmap/PrefsStore') {
  static layerWith(options: { storage: Storage | undefined }) {
    return Layer.sync(PrefsStore, () => {
      const storage = isStorageAvailable(options.storage) ? options.storage : createMemoryStorage();
      return PrefsStore.of({
        get: Effect.sync(() => readPrefs(storage)),
        set: (prefs) =>
          Effect.sync(() => {
            try {
              storage.setItem(PREFS_KEY, JSON.stringify(prefs));
            } catch (error) {
              console.warn('UI 선호를 저장하지 못했어요', error);
            }
          }),
      });
    });
  }

  static readonly layer = Layer.suspend(() => PrefsStore.layerWith({ storage: browserStorage() }));
}
