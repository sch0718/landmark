import { Schema } from 'effect';
import { SHORT_ID_PATTERN } from 'src/domain/share/short-link';
import { safeParse } from 'src/schema/parse';

export const SHARE_LINKS_KEY = 'tripmap:share-links:v1';
export const SHARE_LINKS_MAX = 100;

/** 이 기기가 만든 짧은 링크. 철회에 쓰는 삭제 토큰만 두고, 내용을 푸는 키는 저장하지 않는다. */
export type SentShortLink = {
  id: string;
  deleteToken: string;
  title: string;
  kind: 'places' | 'trip';
  createdAt: string;
  expiresAt: string;
};
const recordSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(SHORT_ID_PATTERN)),
  deleteToken: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
  title: Schema.String,
  kind: Schema.Literals(['places', 'trip']),
  createdAt: Schema.String,
  expiresAt: Schema.String,
});
const isRecord = (value: unknown): value is SentShortLink =>
  safeParse(recordSchema, value, { onExcessProperty: 'error' }).success;

/** 저장소가 막히면 이번 페이지 로드 동안 메모리만 쓴다. 보관함·백업과는 별개다. */
export function createSentLinksStore(
  storage: () => Storage = () => window.localStorage,
  now: () => Date = () => new Date(),
) {
  let memory: SentShortLink[] = [];
  let memoryOnly = false;
  const listeners = new Set<() => void>();
  let snapshot: readonly SentShortLink[] | null = null;

  function load(): SentShortLink[] {
    if (memoryOnly) return memory;
    let raw: string | null;
    try {
      raw = storage().getItem(SHARE_LINKS_KEY);
    } catch {
      memoryOnly = true;
      return memory;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw ?? '[]');
    } catch {
      parsed = [];
    }
    memory = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    return memory;
  }
  function save(next: SentShortLink[]) {
    memory = next;
    snapshot = null;
    if (!memoryOnly) {
      try {
        storage().setItem(SHARE_LINKS_KEY, JSON.stringify(next));
      } catch {
        memoryOnly = true;
      }
    }
    for (const listener of listeners) listener();
  }
  /** 기한이 지난 것은 빼고 새것부터. */
  function list(): readonly SentShortLink[] {
    if (snapshot) return snapshot;
    const at = now().getTime();
    snapshot = load()
      .filter((link) => new Date(link.expiresAt).getTime() > at)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return snapshot;
  }
  function add(link: SentShortLink) {
    const at = now().getTime();
    const kept = load().filter(
      (item) => item.id !== link.id && new Date(item.expiresAt).getTime() > at,
    );
    save([link, ...kept].slice(0, SHARE_LINKS_MAX));
  }
  function remove(id: string) {
    save(load().filter((item) => item.id !== id));
  }
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SHARE_LINKS_KEY && event.key !== null) return;
      snapshot = null;
      listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  }
  return { list, add, remove, subscribe };
}

export const sentLinks = createSentLinksStore();
