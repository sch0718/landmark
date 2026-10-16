import { Effect } from 'effect';
import { useStore, useSetAtom } from 'jotai';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { BACKUP_MIME, backupFileName, buildBackupText } from 'src/domain/backup/build-backup';
import { downloadText } from 'src/lib/download-text';
import { startEffectSync } from 'src/lib/effect/runtime';
import { requestPersistOnce } from 'src/lib/storage-persist';
import { LibraryStore } from 'src/services/library-store';
import { markBackedUpAtom, persistStateAtom } from 'src/stores/backup-state';
import { prefsAtom } from 'src/stores/prefs-state';

const DONE = '백업 파일을 만들었어요';
const BUILD_FAILED = '백업 파일을 만들지 못했어요. 새로고침해 주세요';
const SHARE_FAILED = '공유하지 못했어요. 백업 파일 받기를 이용해 주세요';
const SHARE_TITLE = 'Landmark 백업';

/** 파일에 담은 `snapshot.text`(Task 5·6이 되살리기의 `savedText`로 넘긴다). 키가 없던 보관함이면 `null`. */
export type BackupSaved = { savedText: string | null };

/** 이 기기에서 백업 파일을 시스템 공유 창으로 보낼 수 있는지. 어떤 환경에서도 던지지 않는다. */
export function canShareBackup(): boolean {
  try {
    if (typeof navigator.canShare !== 'function' || typeof File !== 'function') return false;
    return navigator.canShare({
      files: [new File([''], 'x.json', { type: BACKUP_MIME })],
    });
  } catch {
    return false;
  }
}

/** 사용자가 공유 창을 닫은 것(실패가 아니다). `DOMException`이 `Error`가 아닌 환경도 있어 이름만 본다. */
const isAbort = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError';

const readSnapshot = Effect.gen(function* () {
  return yield* (yield* LibraryStore).snapshot;
});

/**
 * 지금 보관함을 백업 파일로 받거나 공유한다(스펙 §2.1·§2.2). 성공하면 마지막 백업 시각을 기록하고
 * 저장 보호를 한 번 요청한다. 진행 중에 또 누르면 무시한다(상태 갱신이 그려지기 전의 두 번째 클릭도 `busyRef`로 막는다).
 */
export function useBackupFile() {
  const store = useStore();
  const markBackedUp = useSetAtom(markBackedUpAtom);
  const setPersist = useSetAtom(persistStateAtom);
  const [shareable] = useState(canShareBackup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const finish = (now: Date, saved: BackupSaved): BackupSaved => {
    markBackedUp(now.toISOString());
    toast(DONE);
    // 저장 보호 요청은 기다리지 않는다(거절돼도 백업은 성공이다).
    void requestPersistOnce().then(setPersist);
    return saved;
  };

  const run = async (kind: 'save' | 'share'): Promise<BackupSaved | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      // 공유 창은 클릭과 같은 작업 안에서 열어야 한다(사파리의 사용자 활성화). 읽기는 동기라 기다리지 않는다.
      let snapshot;
      let text;
      let name;
      const now = new Date();
      try {
        snapshot = startEffectSync(readSnapshot);
        text = buildBackupText({ rawLibrary: snapshot.raw, prefs: store.get(prefsAtom), now });
        name = backupFileName(now);
        if (kind === 'save') downloadText(text, name, BACKUP_MIME);
      } catch (e) {
        console.error(e);
        setError(BUILD_FAILED);
        return null;
      }
      if (kind === 'share') {
        try {
          const file = new File([text], name, { type: BACKUP_MIME });
          await navigator.share({ files: [file], title: SHARE_TITLE });
        } catch (e) {
          if (!isAbort(e)) setError(SHARE_FAILED);
          return null;
        }
      }
      return finish(now, { savedText: snapshot.text });
    } finally {
      // 받기는 끝까지 동기로 달리므로, 같은 작업 안의 두 번째 클릭이 끼지 못하게 다음 마이크로태스크에서 푼다.
      queueMicrotask(() => {
        busyRef.current = false;
      });
      setBusy(false);
    }
  };

  return {
    shareable,
    busy,
    error,
    save: () => run('save'),
    share: () => run('share'),
  };
}
