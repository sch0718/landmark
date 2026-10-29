export const COLLAB_SYNCED = (hhmm: string) => `함께 편집 중 · ${hhmm}에 맞췄어요`;
export const COLLAB_CHANGED = (label: string, hhmm: string) =>
  `‘${label}’에서 일정을 바꿨어요 · ${hhmm}`;
export const COLLAB_SYNCING = '맞추는 중이에요';
export const COLLAB_CONFLICT = (n: number) => `다른 기기와 같은 곳을 고쳤어요 · ${n}곳`;
export const COLLAB_COMPARE = '비교하기';
export const COLLAB_OFFLINE = '오프라인이에요. 고친 내용은 연결되면 맞춰요';
export const COLLAB_OFF = '지금은 함께 편집이 잠시 멈췄어요. 고친 내용은 다시 켜지면 맞춰요';
export const COLLAB_LIMITED = '오늘은 더 맞출 수 없어요. 내일 다시 맞춰요';
export const COLLAB_TOO_BIG = '일정이 커서 보내지 못했어요. 후보나 메모를 줄여 주세요';
export const COLLAB_REVOKED = '이 기기의 편집 권한이 거둬졌어요. 이 여행은 이 기기에만 남아요';
export const COLLAB_ENDED = '공동 여행이 끝났어요. 이 여행은 이 기기에만 남아요';
export const COLLAB_VERSION = '새 버전의 앱이 필요해요. 페이지를 새로 고쳐 주세요';
export const COLLAB_FAILED = '공동 여행을 맞추지 못했어요. 잠시 뒤 다시 해 볼게요';
export const COLLAB_OK = '알겠어요';
export const COLLAB_RELOAD = '새로 고침';
export const COLLAB_OPEN = '함께 편집';
