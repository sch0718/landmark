# firebase-session 0.5.0 적용 계획

설계: `docs/superpowers/specs/2026-11-08-firebase-session-0.5-adopt-design.md`

## 순서

1. **버전**
   - `yarn add --exact @sch0718/firebase-session@0.5.0`
   - `package.json`의 `engines.node`를 `>=22.16`으로 바꾼다.
   - `docs/development.md`를 고친다. 바꿀 곳은 셋이다.
     - 버전 표
     - 34행의 Node 범위(`>=22.16`)
     - 163행의 `tests/helpers/sqlite-d1.ts` 안내를 패키지 `/testing/d1`로
   - `yarn build:notices`로 고지를 갱신한다.
2. **`src/server/library-sync/auth.ts`**
   - `redirectUrisFor`: 기본값 목록(변수가 없으면 `origin + '/auth/callback'`)을 만든 뒤 `parseRedirectUris`에 넘긴다.
   - `sessionAuthFor`: `social: socialLoginOptions({ allowedAccounts, kakao, naver, redirectUris, keys, fetch })`
     - 가짜가 켜지면 ID는 `FAKE_CLIENT_IDS.*`, 시크릿은 `FAKE_CLIENT_SECRET`, `keys`·`fetch`는 가짜 것이다.
   - 가짜 생성은 작은 함수 `fakeSocial(now)`로 묶는다.
     ```ts
     createFakeSocial({ basePath: '/api/sync/dev/fake-social', defaultSub: 'dev-me', approveResponse: 'refresh', now })
     ```
     `router.ts`도 이 함수를 쓴다.
3. **`src/server/library-sync/router.ts`**
   - 세션 6개 route와 `create`·`revoke`를 지운다.
   - `handleSync`의 출처·DB·`ensureSchema` 다음에 아래를 넣는다.
     ```ts
     if (ctx.env.LIBRARY_SYNC === 'off' && ctx.request.method === 'POST' && (path === '/v1/session' || path === '/v1/session/social'))
       throw new SyncHttpError(503, 'off');
     const session = await handleSessionRoute(ctx.request, sessionAuthFor(ctx, deps), {
       path,
       onRoute: (p) => { pattern = p; },
       beforeCreate: async () => {
         try { await consumeLoginLimit(ctx, deps.now()); }
         catch (e) { if (e instanceof SyncHttpError) throw new HttpError(e.status, e.code, e.extra); throw e; }
       },
       onRevoke: async (user, target) => { /* 기존 revoke()의 library_devices DELETE */ },
       log: (m) => { if (!/^@sch0718\/firebase-session: internal \S+$/.test(m)) deps.log(m); },
     });
     if (session) {
       if (session.status === 200 && ctx.request.method === 'POST') {
         ctx.waitUntil(purgeSessions(...));
         ctx.waitUntil(pruneLimits(...));
       }
       session.headers.set('Cache-Control', 'private, no-store');
       response = session;
     } else { /* 기존 라우터 */ }
     ```
   - `SyncHttpError`의 필드 이름(`status`·`code`·`extra`)은 `http.ts`를 보고 맞춘다.
4. **가짜 공급자**
   - `src/server/library-sync/dev-fake-social.ts`를 지운다.
   - `router.ts`의 `/dev/fake-social/` 분기는 2의 `fakeSocial(deps.now).handle(ctx.request, redirectUrisFor(ctx))`를 쓴다. 결과가 null이면 404다.
   - `src/services/library-sync/login.ts`
     - 로컬 `fakeAuthorizeUrl`을 지운다.
     - 패키지는 `navigate`의 반환값을 기다리지 않는다. 그래서 `beginSocialSignIn`을 부르기 전에 `import.meta.env.DEV && config.devFake`일 때 동적 import를 먼저 기다리고, 동기 `navigate`를 넘긴다. 아니면 `nav`다(패키지 README 예제와 같은 방식). import 실패는 기존 호출자의 `catch`로 간다.
       ```ts
       let navigate = nav;
       if (import.meta.env.DEV && config.devFake) {
         const { fakeAuthorizeUrl } = await import('@sch0718/firebase-session/testing');
         navigate = (url) => nav(fakeAuthorizeUrl(url, origin + '/api/sync/dev/fake-social'));
       }
       ```
5. **시험용 D1**
   - `tests/helpers/sqlite-d1.ts`를 지운다.
   - 23개 사용처의 `createSqliteD1()`을 `createTestD1()`(`@sch0718/firebase-session/testing/d1`)으로 바꾼다. 타입이 `MeetDb`와 맞지 않으면 사용처에서 `as unknown as MeetDb`가 아니라 기존 helper가 했던 만큼만 맞춘다.
   - `toEqual({ results ... })` 전체 비교는 `.results` 비교로 바꾼다. 위치는 `meet-db.test.ts` 등이다.
   - `run()` 반환값 전체를 `{ meta: { changes } }`와 비교하는 곳(`meet-db.test.ts:228`·`:237` 등)은 `.meta.changes` 비교로 바꾼다.
   - 타입 오류 두 곳은 시험 대역을 패키지 타입에 맞춰 고친다.
     - `tests/unit/server/agent-library-edit.test.ts:343`: `prepare` 대역이 `MeetStatement`를 반환해 `D1PreparedStatement`와 충돌한다.
     - `tests/unit/server/meet-handlers.test.ts:1799`: 배치 결과에 `results`·`success`가 없다. 기존 필드를 남기고 `meta.changes`만 바꾼다.
   - FK 위반으로 실패하는 시험은 users 행을 먼저 넣어 고친다.
6. **시험 정리**
   - `tests/unit/services/library-sync-login.test.ts`: 로컬 `fakeAuthorizeUrl` 시험을 지운다. `devFake` 분기 시험이 있으면 새 경로(`/api/sync/dev/fake-social/authorize?...&provider=kakao`)로 맞춘다.
   - `tests/unit/server/sync-library.test.ts`, `tests/helpers/sync-memory-server.ts`, `tests/e2e/sync-server.ts`, `backup-api.test.ts`, `agent-tokens.test.ts`
     - 가짜 공급자 import를 패키지로 바꾼다.
     - 패키지 `createFakeSocial`은 `basePath`가 필수이고 기본 응답은 302다. 그래서 직접 부르는 곳(`sync-library.test.ts:273` 등)도 2의 `fakeSocial(now)`를 쓰거나 `basePath: '/api/sync/dev/fake-social'`, `approveResponse: 'refresh'`를 명시한다.
     - 화면 경로가 바뀐 곳도 맞춘다.
   - `sync-dev-fake.test.ts`: 설계 4의 연결 시험만 남긴다.
   - 세션 경로 시험을 하나 더한다. `DELETE /v1/sessions?others=1&x=1`은 400 `bad-request`, 세션 응답의 `Cache-Control`은 `private, no-store`, 철회 뒤 `library_devices` 행이 지워지는지 본다(기존 시험이 이미 보면 더하지 않는다).

## 검증

- `yarn lint`
- `node scripts/build-notices.mjs --check`
- `yarn build:ci`
- `yarn test:e2e:ci`(@smoke만 돈다)와 로그인·동기화 시나리오 `yarn playwright test library-sync.spec.ts server-backup.spec.ts agent-inbox.spec.ts --project=desktop`
- 운영 번들(`dist/assets`)에 `dev-fake`·`createFakeSocial`이 없어야 한다.
- `yarn dev:sync`로 가짜 카카오 로그인을 한 번 직접 확인한다.
- 사람 확인(배포 뒤): 실제 카카오·네이버 로그인
