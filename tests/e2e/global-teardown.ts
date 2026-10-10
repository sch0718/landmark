import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { E2E_DATA_FILE } from './fixtures';

/**
 * global setup이 둔 fixture를 지우고, e2e 지도 주소(localhost:5174)로 빌드한 보기 화면 틀을
 * 기본 지도 주소로 다시 빌드한다(`public/share-viewer.html`이 e2e 주소로 남지 않게).
 */
export default function globalTeardown(): void {
  rmSync(E2E_DATA_FILE, { force: true });
  const env = { ...process.env };
  delete env.VITE_SHARE_MAP_URL;
  const built = spawnSync('yarn', ['build:viewer'], { env, stdio: 'inherit' });
  if (built.status !== 0) {
    throw new Error(
      `보기 화면 틀을 기본 지도 주소로 다시 빌드하지 못했어요(yarn build:viewer, 종료 코드 ${String(built.status)})`,
    );
  }
}
