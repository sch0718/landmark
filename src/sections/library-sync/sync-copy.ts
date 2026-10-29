import { createSyncApi, googleAuth } from 'src/services/library-sync/api';
import { readSyncClientConfig } from 'src/services/library-sync/config';
export const SYNC_DESCRIPTION = [
  '장소·라벨·여행·약속·폴더 연결을 서버에 올려 내 다른 기기와 맞춰요. 메모·출발지도 올라가요.',
  '서버에는 암호화하지 않고 저장해요(운영자가 볼 수 있어요).',
  '화면 설정과 약속 공유 연결은 기기마다 따로예요.',
];
export const REJECTED_COPY = {
  invalid: '형식이 맞지 않아 올리지 못했어요',
  'too-large': '너무 커서 올리지 못했어요',
  clock: '기기 시계를 확인해 주세요',
};
export function conflictPath(path: string): string {
  const day = /^days\.(\d+)\.stops$/.exec(path);
  if (day) return `${Number(day[1]) + 1}일차 일정`;
  return (
    (
      {
        memo: '메모',
        name: '이름',
        labelIds: '라벨',
        visitedOn: '다녀온 날',
        review: '한 줄 평',
        title: '제목',
        '': '전체 항목',
      } as Record<string, string>
    )[path] ?? path
  );
}
export function shortValue(value: unknown): string {
  if (Array.isArray(value)) return `${value.length}개`;
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}
/** 설정 조각 안에서만 쓰는 공통 클라이언트 구성. */
export function syncServices() {
  const config = readSyncClientConfig(import.meta.env, location.origin);
  if (!config) return null;
  const auth = googleAuth(config);
  return { config, auth, api: createSyncApi({ config, storage: localStorage, auth }) };
}
