import type { HelpPageId } from 'src/sections/help/help-content';

export const HELP_SEEN_KEY = 'tripmap:help-seen:v1';
// 문구 모듈을 첫 화면에서 받지 않도록 식별자만 둔다.
const IDS: readonly HelpPageId[] = [
  'library',
  'map',
  'add',
  'place',
  'labels',
  'trips',
  'meetings',
  'share',
  'settings',
];

/** 저장소가 막히면 이번 페이지 로드 동안 메모리만 쓴다. 보관함·백업과는 별개다. */
export function createHelpSeenStore(storage: () => Storage = () => window.localStorage) {
  let memory = new Set<HelpPageId>();
  let memoryOnly = false;
  function read(): ReadonlySet<HelpPageId> {
    if (memoryOnly) return memory;
    let raw: string | null;
    try {
      raw = storage().getItem(HELP_SEEN_KEY);
    } catch {
      memoryOnly = true;
      return memory;
    }
    // 깨진 값은 빈 기록으로 본다. 다음 기록이 덮어쓰도록 저장소는 계속 쓴다.
    let parsed: unknown = [];
    try {
      parsed = JSON.parse(raw ?? '[]');
    } catch {
      parsed = [];
    }
    // 모르는 이름(다른 버전이 더한 메뉴 등)만 빼고 나머지는 그대로 쓴다.
    memory = new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is HelpPageId => IDS.includes(id as HelpPageId))
        : [],
    );
    return memory;
  }
  function mark(id: HelpPageId) {
    memory = new Set([...read(), id]);
    if (memoryOnly) return;
    try {
      storage().setItem(HELP_SEEN_KEY, JSON.stringify([...memory]));
    } catch {
      memoryOnly = true;
    }
  }
  function reset() {
    memory = new Set();
    try {
      storage().removeItem(HELP_SEEN_KEY);
    } catch {
      memoryOnly = true;
    }
  }
  return { read, mark, reset };
}

export const helpSeen = createHelpSeenStore();
