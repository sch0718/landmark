import { rmSync } from 'node:fs';
import { E2E_DATA_FILE } from './trip';

export default function globalTeardown(): void {
  rmSync(E2E_DATA_FILE, { force: true });
}
