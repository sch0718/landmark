import Alert from '@mui/material/Alert';
import { useAtomValue } from 'jotai';
import { persistenceAtom } from 'src/stores/library-state';

/** localStorage를 쓸 수 없어 메모리에만 두는 중이면 알린다(스펙 §6.3 `StorageUnavailable`). */
export function StorageBanner() {
  const persistence = useAtomValue(persistenceAtom);
  if (persistence !== 'memory') return null;
  return (
    <Alert severity="warning" variant="filled" role="status" sx={{ borderRadius: 0, flex: 'none' }}>
      이 브라우저에 저장할 수 없어 새로고침하면 사라져요
    </Alert>
  );
}
