import { takeUnseenReleases, watchVersion } from '@sch0718/app-update';
import { createSeenStore } from '@sch0718/seen-store';
import { toast } from 'sonner';
import { RELEASE_NOTES } from 'src/sections/help/release-notes';

export const RELEASE_SEEN_KEY = 'tripmap:release-seen:v1';
/** 나눠 받기 실패 안내(`ChunkErrorNotice`)와 같은 문구를 쓴다. 둘 다 「배포 뒤 옛 화면」을 다룬다. */
export const NEW_VERSION_MESSAGE = '새 버전이 나왔어요. 새로고침해 주세요';

/**
 * 첫 화면 예산 밖에서 받는다(`App`이 운영 빌드에서 마운트 뒤 `import()`).
 * 업데이트 뒤 첫 실행이면 「바뀐 점」을 한 번 알리고, 배포 루트 `version.json`으로 새 버전을 지켜본다.
 * 접속 직후·조작 전이면 바로 새로고침하고, 쓰는 중이면 새로고침 안내 토스트를 띄운다.
 */
export function startAppUpdate(
  current: string,
  openReleaseNotes: () => void,
  storage?: () => Storage,
): () => void {
  const seen = createSeenStore({
    key: RELEASE_SEEN_KEY,
    ids: RELEASE_NOTES.map((n) => n.version),
    ...(storage ? { storage } : {}),
  });
  const [latest] = takeUnseenReleases(RELEASE_NOTES, seen);
  if (latest)
    toast(`업데이트했어요 (${latest.version})`, {
      action: { label: '바뀐 점', onClick: openReleaseNotes },
      duration: 10_000,
    });
  return watchVersion({
    current,
    onUpdate: (reload) =>
      toast(NEW_VERSION_MESSAGE, {
        id: 'app-update',
        action: { label: '새로고침', onClick: reload },
        duration: Infinity,
      }),
  });
}
