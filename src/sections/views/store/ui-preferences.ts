import { isViewMode, type ViewMode } from 'src/stores/ui-store';

type UiStorage = Pick<Storage, 'getItem' | 'setItem'>;
const key = (id: string) => `trip-map:ui:${id}`;

export function readPreferredView(storage: UiStorage, publicId: string): ViewMode {
  try {
    const raw = storage.getItem(key(publicId));
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return 'map';
    const record = value as Record<string, unknown>;
    return record.version === 1 && isViewMode(record.view) ? record.view : 'map';
  } catch {
    return 'map';
  }
}

export function writePreferredView(storage: UiStorage, publicId: string, view: ViewMode): boolean {
  try {
    storage.setItem(key(publicId), JSON.stringify({ version: 1, view }));
    return true;
  } catch {
    return false;
  }
}
