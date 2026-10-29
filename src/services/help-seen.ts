import { createSeenStore, type SeenStore } from '@sch0718/seen-store';
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
export function createHelpSeenStore(storage?: () => Storage): SeenStore<HelpPageId> {
  return createSeenStore<HelpPageId>({ key: HELP_SEEN_KEY, ids: IDS, storage });
}

export const helpSeen = createHelpSeenStore();
