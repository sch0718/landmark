import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { E2E_DATA_FILE, E2E_FIXTURE_FILE, SHARE_MAP_URL } from './fixtures';

/**
 * 옛 여행 fixture를 dev 서버가 내주는 `public/data/`에 둔다(커밋하지 않음 — .gitignore).
 * 보기 화면 틀은 지도 주소를 e2e용 로컬 지도 페이지로 바꿔 다시 빌드한다. 앱 서버를 재사용해도
 * 틀은 매번 받아 가므로(`public/`) 이 주소를 가리킨다. 끝나면 global teardown이 기본 주소로 다시 빌드한다.
 */
export default function globalSetup(): void {
  copyFileSync(E2E_FIXTURE_FILE, E2E_DATA_FILE);
  const built = spawnSync('yarn', ['build:viewer'], {
    env: { ...process.env, VITE_SHARE_MAP_URL: SHARE_MAP_URL },
    stdio: 'inherit',
  });
  if (built.status !== 0) {
    throw new Error(`보기 화면 틀 빌드 실패(yarn build:viewer, 종료 코드 ${String(built.status)})`);
  }
}
