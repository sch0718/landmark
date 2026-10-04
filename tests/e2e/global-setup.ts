import { copyFileSync } from 'node:fs';
import { E2E_DATA_FILE, E2E_FIXTURE_FILE } from './trip';

/** fixture TripData를 dev 서버가 내주는 `public/data/`에 둔다(커밋하지 않음 — .gitignore). */
export default function globalSetup(): void {
  copyFileSync(E2E_FIXTURE_FILE, E2E_DATA_FILE);
}
