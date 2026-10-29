export const LIVE_CONFLICT = '다른 기기에서 갱신 링크의 일정을 바꿨어요';
export const LIVE_OVERWRITE = '이 기기 일정으로 바꾸기';
export const LIVE_PAUSE = '반영 멈추기';
export const LIVE_DISCONNECTED =
  '이 기기의 갱신 링크 관리 연결이 끊겼어요. 소유자 링크로 다시 연결하세요';
export const LIVE_ENDED = '갱신 링크 공유가 끝났어요';
export const LIVE_OFF = '지금은 갱신이 잠시 멈췄어요';
export const LIVE_LIMITED = '오늘은 더 반영할 수 없어요. 내일 다시 반영돼요';
export const LIVE_TOO_BIG =
  "일정이 커서 반영하지 못했어요. '메모 포함'이나 후보를 끄고 다시 해 주세요";
export const LIVE_EMPTY = '일정에 넣은 장소가 없어 반영하지 않았어요';
export const LIVE_FAILED = '반영하지 못했어요. 인터넷이 돌아오면 다시 반영해요';
export const LIVE_PAUSED = '이 기기에서는 반영을 멈췄어요';
export const LIVE_CREATE_ERRORS = {
  offline: '인터넷 연결을 확인해 주세요. 링크 복사를 이용해 주세요',
  turnstile: '확인에 실패했어요. 다시 해 주세요',
  'rate-limited': '오늘은 더 만들 수 없어요. 링크 복사를 이용해 주세요',
  'switched-off': '지금은 갱신 링크를 만들 수 없어요. 링크 복사·파일 저장을 이용해 주세요',
  'too-big':
    "일정이 커서 갱신 링크를 만들 수 없어요. '메모 포함'이나 후보를 끄거나 파일로 보내 주세요",
  failed: '갱신 링크를 만들지 못했어요. 잠시 뒤 다시 해 주세요',
};
export const LIVE_STATE_TEXT = {
  off: LIVE_OFF,
  limited: LIVE_LIMITED,
  'too-big': LIVE_TOO_BIG,
  empty: LIVE_EMPTY,
  failed: LIVE_FAILED,
  conflict: LIVE_CONFLICT,
  disconnected: LIVE_DISCONNECTED,
  ended: LIVE_ENDED,
  paused: LIVE_PAUSED,
  pending: '반영을 기다리고 있어요',
  publishing: '반영하는 중이에요',
  published: '',
  idle: '',
};
export const LIVE_OWNER_WARNING =
  '이 링크를 가진 사람은 일정을 바꾸고 공유를 지울 수 있어요. 내 기기에만 보내세요';
export const LIVE_IMPORT_HINT =
  '이 기기 보관함에 이 여행을 담고, 여기서 고친 내용도 갱신 링크에 반영해요. 다른 기기에서 고친 내용과 겹치면 어느 쪽을 쓸지 물어봐요';
