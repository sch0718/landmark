import { useEffect } from 'react';
import { readAutoBackupFlag, loadAutoBackup } from 'src/services/server-backup/boot';
export function useAutoBackupBoot(): void {
  useEffect(() => {
    if (readAutoBackupFlag())
      void loadAutoBackup()
        .then((m) => m.startAutoBackup())
        .catch(() => {});
  }, []);
}
