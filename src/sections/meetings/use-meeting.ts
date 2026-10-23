import { useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

/** 살아 있는 약속과 최신 보관함 연산. 저장 실패는 기존 알림으로 알린다. */
export function useMeeting(id: string) {
  const library = useAtomValue(libraryAtom);
  const { run: runAction } = useLibraryAction();
  const run = useCallback<typeof runAction>(
    async (op) => {
      const result = await runAction(op);
      if (!result.ok) {
        const reason = (result.error as { reason?: string } | null)?.reason;
        toast.error(
          reason === 'host'
            ? '나는 지울 수 없어요'
            : reason === 'participants-full'
              ? '참석자는 10명까지예요'
              : '저장하지 못했어요. 다시 시도해 주세요',
        );
      }
      return result;
    },
    [runAction],
  );
  const saved = library.meetings?.[id];
  const meeting = saved !== undefined && saved.deletedAt === null ? saved : null;
  return { library, meeting, run };
}
