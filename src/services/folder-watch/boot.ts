import { lazyChunk } from 'src/lib/lazy-chunk';
export const loadFolderWatch = lazyChunk(() => import('src/services/folder-watch/folder-watch'));
