# firebase-session 0.5.0 적용 설계

전제: 운영자 1명·소수 지인·Cloudflare 무료. 사용자에게 보이는 동작은 바꾸지 않고, 공용 패키지로 옮긴 코드의 랜드마크 사본을 걷어낸다.

## 왜 하나

`@sch0718/firebase-session@0.5.0`이 다음을 내보낸다.
- 세션 API 6개 처리기 `handleSessionRoute`
- 소셜 설정 조립 `socialLoginOptions`·`parseRedirectUris`
- 개발·시험 도우미 `/testing`·`/testing/d1`

랜드마크의 `dev-fake-social.ts`(265줄), `tests/helpers/sqlite-d1.ts`, 세션 라우트 6개, `redirectUrisFor`, 소셜 조립이 이것들의 원본이거나 사본이다. 0.3.0과 0.5.0 사이에 깨지는 변경은 없다. 0.4.0의 `googleSessionOnly`는 옵션 추가뿐이고 랜드마크는 쓰지 않는다.

## 바꾸는 것

1. **버전**
   - `@sch0718/firebase-session`을 0.3.0에서 0.5.0으로 올린다. `yarn add --exact`로 올리고, lockfile과 고지(`yarn build:notices`)를 함께 바꾼다.
   - `docs/development.md` 버전 표를 고친다.
   - `/testing/d1`이 Node 22.16 이상을 요구하므로 `engines.node`를 `>=22.16`으로 올린다. CI와 `.nvmrc`는 Node 24라서 그대로 둔다.
2. **세션 라우트** (`src/server/library-sync/router.ts`)
   - `SYNC_ROUTES`에서 세션 6개를 지우고 `create()`·`revoke()`를 지운다.
   - `handleSync`는 출처 검사, DB 확인, `ensureSchema` 다음에 아래를 처리한다.
     - off 차단: `LIBRARY_SYNC === 'off'`이고 요청이 `POST /v1/session` 또는 `POST /v1/session/social`이면 503 `off`. 지금처럼 생성 두 경로만 막고, 나머지 네 경로는 off에서도 연다. 메서드가 다르면 지금처럼 405로 둔다.
     - 처리: `handleSessionRoute(ctx.request, sessionAuthFor(ctx, deps), { path, onRoute, beforeCreate, onRevoke, log })`를 부른다.
       - `path`: 접두어를 뗀 경로
       - `onRoute`: 로그 패턴을 채운다.
       - `beforeCreate`: `consumeLoginLimit(ctx, deps.now())`를 부른다. `SyncHttpError`는 패키지 `HttpError(status, code, extra)`로 바꿔 던진다. 그대로 두면 패키지가 500으로 바꾼다.
       - `onRevoke`: `library_devices`에서 철회된 세션의 기기 기록을 지운다. 대상이 `others`면 `<>` 현재 세션, `current`면 `publicSessionId(ctx.sessionHash)`, 객체면 그 `id`다.
       - `log`: 설정 안내 문구만 `deps.log`로 남긴다. 일반 내부 오류는 남기지 않아 지금과 같다.
     - 응답이 오면 아래를 하고 그 응답을 쓴다. `null`이면 기존 라우터로 간다.
       - 생성 경로가 200이면 `ctx.waitUntil(purgeSessions(...))`와 `ctx.waitUntil(pruneLimits(...))`를 건다.
       - `Cache-Control`을 지금 값 `private, no-store`로 맞춘다.
   - 상태 코드가 바뀌는 곳
     - `DELETE /v1/sessions`의 쿼리가 `others=1` 하나가 아니면 422 `invalid`에서 400 `bad-request`로 바뀐다. 인증도 쿼리보다 먼저 한다. 앱은 이 코드를 보지 않는다(`client.revokeSession`만 쓴다).
     - `DELETE /v1/sessions/:id`는 이제 `:id`를 디코딩한다. 디코딩에 실패하면 404다. 세션 id는 base64url이라 실제 값은 바뀌지 않는다.
3. **소셜 설정** (`src/server/library-sync/auth.ts`)
   - `redirectUrisFor`의 거르기를 `parseRedirectUris`로 바꾼다. 변수가 없으면 요청 origin에 `/auth/callback`을 붙이는 기본값은 그대로 둔다. 2048자를 넘는 주소는 이제 거절된다.
   - kakao·naver 조립(62-87행)을 `socialLoginOptions`로 바꾼다. 가짜 공급자가 켜지면 ID·시크릿을 `FAKE_CLIENT_IDS`·`FAKE_CLIENT_SECRET`으로, `keys`·`fetch`를 가짜 것으로 넘긴다.
   - `devFakeEnabled`(로컬 요청이고 `SYNC_DEV_FAKE_SOCIAL === '1'`)와 `providerStatus`는 그대로 둔다.
4. **개발용 가짜 공급자**
   - `src/server/library-sync/dev-fake-social.ts`를 지운다.
   - `router.ts`와 `auth.ts`의 두 연결 위치는 `createFakeSocial({ basePath: '/api/sync/dev/fake-social', defaultSub: 'dev-me', approveResponse: 'refresh', now })`를 쓴다(`@sch0718/firebase-session/testing`). 패키지 `handle`은 전체 URL 경로를 보므로 basePath에 `/api/sync`를 넣는다.
   - 운영 Functions 번들에 testing 코드가 들어가는 것은 지금과 같다. 지금도 `dev-fake-social.ts`를 정적으로 불러오고, 실행 때 `devFakeEnabled`로 막는다.
   - 앱 `src/services/library-sync/login.ts`
     - 로컬 `fakeAuthorizeUrl`을 지우고 패키지 것을 동적 import한다.
     - 분기는 `import.meta.env.DEV && config.devFake`로 둔다. 빌드 때 DEV가 false라 운영 번들에서 빠진다.
     - 둘째 인자는 `origin + '/api/sync/dev/fake-social'`(절대 URL)이다.
   - 시험 고치기
     - `library-sync-login.test.ts`의 로컬 함수 시험을 지운다.
     - `sync-library.test.ts`의 `createFakeSocial` import를 패키지로 바꾼다.
     - `sync-dev-fake.test.ts`는 랜드마크 연결만 남긴다: 운영 요청 404, 가짜 로그인 흐름, off·출처 조건. 가짜 화면 세부는 패키지가 시험한다.
5. **시험용 D1**
   - `tests/helpers/sqlite-d1.ts`를 지우고 23개 사용처를 `createTestD1()`(`/testing/d1`, 마이그레이션 없이 빈 DB)로 바꾼다. 스키마는 지금처럼 `ensureSchema`가 만든다.
   - 동작 차이
     - `success`·`meta`가 열거 속성이 되어 `toEqual({ results })` 전체 비교가 깨진다. `.results` 비교로 바꾼다.
     - FK 검사가 켜진다(`schema-sql.ts:91`의 `REFERENCES users(id)`). FK를 어기던 시험은 시험 데이터에 users 행을 넣어 고친다. 스키마는 바꾸지 않는다.
     - `?N` 바인딩은 SQLite가 그대로 받는다. 기존 도우미의 재배치가 꼭 필요한 곳이 있으면 보고한다.
   - e2e 서버(`tests/e2e/*-server.ts`)도 같은 도우미를 쓰므로 함께 바꾼다.
6. 시험용 토큰 서명기는 랜드마크에 없어서 바꿀 것이 없다.

## 바꾸지 않는 것

- 다른 `SyncHttpError` 사용처(agent, backup 등), `syncJson`, 출처 검사, `/v1/status`
- 스키마(`schema-sql.ts`), `functions/` 진입점
- 클라이언트 `deviceLabel`. synctx와 같은 코드지만 두 곳뿐이라 공용화하지 않는다.

## 검증

- `yarn lint`, `node scripts/build-notices.mjs --check`, `yarn build:ci`(validate, typecheck, test, build, size, build:map)
- `yarn test:e2e:ci`
- `yarn dev:sync`로 가짜 카카오 로그인을 한 번 직접 해 본다.
- 사람 확인(배포 뒤): 실제 카카오·네이버 로그인, 설정의 「다른 기기 모두 로그아웃」 한 번. 패키지가 `URLSearchParams.size`를 쓰는데 운영 런타임에서는 확인하지 못했다.
