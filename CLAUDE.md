# 랜드마크

평소에 장소를 모아 두고 여행 때 꺼내 쓰는 장소 보관함(https://landmark.sch0718.dev). React PWA(`src/`) + Cloudflare Pages Functions·D1(`functions/`) + 장소 수집 파이프라인(`pipeline/`). 로그인 없이 보관함은 기기 localStorage에 두고, 동기화·약속 집계만 서버를 씁니다. 구조·환경변수·배포는 `docs/development.md`, 코드 작성 규칙은 `docs/convention.md`에 있습니다.

## 명령

```bash
yarn dev            # http://localhost:5173 (네이버 지도, .env.local 필요). 가짜 지도는 VITE_MAP_ADAPTER=fake yarn dev
yarn dev:full       # Vite + 서버 함수(/api/*), http://localhost:8788
yarn typecheck && yarn lint && yarn test
yarn test:e2e       # Playwright
yarn build:ci       # 배포와 같은 검사: validate → legacy-scan → typecheck → test → build → size
```

- 끝내기 전에 `yarn build:ci`를 돌립니다. GitHub CI와 Cloudflare Pages 배포가 이 명령으로 막히기 때문입니다.
- 공용 `@sch0718/*` 패키지는 GitHub Packages에서 받습니다. 토큰은 환경변수 `GITHUB_PACKAGES_TOKEN`으로만 넘기고 파일에 쓰지 않습니다.

## 지켜야 할 것

- Effect API는 `.reference/effect/`(없으면 `node_modules/effect/ai-docs`)로 확인하고 기억으로 쓰지 않습니다. v4에서 이름이 바뀐 API가 많습니다(`docs/convention.md`).
- 첫 로딩 예산: 의존성·대체 코드·폴리필을 더하면 `perf-budget.json`의 `initialJsGzipMax`를 넘지 않는지 확인합니다(`yarn size`). 넘으면 기능 감지 뒤 `import()`로 나눕니다. toolkit-web 패키지도 이 값을 기준으로 씁니다.

## 웹 화면

화면 작업 규칙은 `~/.claude/rules/modern-web.md`(웹 파일을 다룰 때 자동으로 실림)를 따르고, 이 저장소에서는 아래를 더합니다.

- 대상: `src/`, `index.html`. `functions/`, `pipeline/`, `scripts/`는 대상이 아닙니다.
- `yarn legacy-scan`은 검토를 마친 후보 목록 `legacy-scan-baseline.json`에 없는 새 후보가 나오면 실패합니다. 새 후보는 확인해 고치거나, 고치지 않을 이유(`reason`)를 적어 목록에 더합니다. 더는 나오지 않는 항목은 스크립트가 알려 주니 목록에서 뺍니다. CLI는 정확한 버전의 devDependency로 고정해 씁니다.
