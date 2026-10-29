import { lazyChunk } from 'src/lib/lazy-chunk';
import { readBootFlag } from 'src/services/library-sync/boot';
import { readServerBackupLocal } from './storage';
export function readAutoBackupFlag(storage?: Storage): boolean {
  try {
    return readBootFlag(storage) && readServerBackupLocal(storage ?? localStorage).auto;
  } catch {
    return false;
  }
}
export const loadAutoBackup = lazyChunk(() => import('src/services/server-backup/auto-backup'));
