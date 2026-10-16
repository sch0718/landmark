# 영업시간·휴무 경고 (묶음 F6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여행 시간표의 장소 행과 지도 카드에서, 도착(시작) 시각이 네이버 영업시간 밖이거나 휴무일이면 확인 날짜와 함께 경고하고, 모르면 `영업시간 확인 필요`로 남긴다.

**Architecture:** 서버 함수 `/api/hours`가 네이버 장소 홈 HTML(`pcmap.place.naver.com`)의 `"newBusinessHours":[…]` 배열만 괄호를 맞춰 떼어 `PlaceHours`로 정규화한다(엣지 캐시 1일). 앱은 Effect 서비스 `HoursLookup`이 보관함 밖 기기 캐시 `tripmap:hours:v1`(7일)을 두고 받으며, 결과를 Jotai `hoursStatesAtom`에 쓴다. 판정은 순수 함수(`src/domain/trips/hours.ts`)가 `computeSchedule`의 시각과 Day 날짜로 하고, 화면은 행 한 줄(`HoursNotice`)과 카드 칸(`HoursSection`)뿐이다. 보관함 저장 형식은 바꾸지 않는다.

**Tech Stack:** TypeScript 6, React 19, MUI 7, Jotai, Effect 4.0.2, Cloudflare Pages Functions(웹 표준 API만), Vitest 5(jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-business-hours-design.md`

## Global Constraints

- 출발점: F1~F5(`v0.12.0`)가 병합된 `main`. 브랜치 `feat/business-hours`, 병합 뒤 태그 `v0.13.0`.
- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`(git 훅에도 필요). 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 작업 하나 = 커밋 하나(리뷰 수정은 같은 작업 이름으로). 구현 PR은 병합 커밋으로 넣는다.
- 파일에 U+2028/U+2029 원문자 금지. 커밋 전 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 저장 형식·키를 바꾸지 않는다: `schemaVersion` 2, `tripmap:library:v2`, `tripmap:prefs`, `tripmap:routes:v1`, 공유 형식. `PlaceSchema`에 필드를 더하지 않는다. 새 키는 `tripmap:hours:v1` 하나.
- 서버 코드(`src/server/*`, `functions/api/*`)는 상대 경로 import·웹 표준 API만. 바깥 호스트는 `ALLOWED_HOSTS` 정확 일치(`pcmap.place.naver.com`은 이미 있다 — 목록을 바꾸지 않는다). 네이버 요청에 `Origin` 헤더를 넣지 않는다.
- 값: 서버 엣지 캐시 86,400초, 캐시 키 `https://cache.landmark/hours/naver/<sid>`, sid `^\d{1,15}$`, 이동 최대 2번(대상 `https://pcmap.place.naver.com/<영문 소문자>/<같은 sid>/home`만). 앱 캐시 300곳·400,000자, 다시 받기 7일(`7 * 86_400_000`ms), 동시 요청 2, 앱 시한 12,000ms.
- 첫 요청 주소 `https://pcmap.place.naver.com/place/<sid>/home`, 헤더 `User-Agent: BROWSER_USER_AGENT`, `Accept-Language: ko-KR,ko;q=0.9`, `Referer: https://map.naver.com/`.
- 고정 문구(스펙 §2.4 — 글자까지 같게):
  - 경고: `휴무일 — <설명>`(설명 없으면 `휴무일`), `임시 휴무 — <원문>`, `<시각> 도착 — 영업 시작 <시각>`, `<시각> 도착 — 영업 종료 <시각>`, `<시각> 도착 — 브레이크타임 <시작>~<끝>`, `<시각> 도착 — 라스트오더 <시각>`, `머무는 중 영업 종료 <시각>`, `머무는 중 브레이크타임 <시작>~<끝>`, `영업시간 확인 필요`. 고정 시각을 기다리면 `도착` 대신 `시작`. 앞 시각은 `formatClock`(자정 뒤 `다음 날 01:10`), 규칙 시각은 네이버 값 그대로(`24:00` 포함). 경고 문구의 규칙 시각은 방문 날짜의 다음 날일 때만 `02:00(다음 날)`(`24:00`은 그대로), 카드 규칙 줄은 자정을 넘는 끝에 늘 `(다음 날)`.
  - 카드: `영업시간`, `Day <N> · <MM.DD(요일)> · <규칙>`(규칙: `11:00~21:00` / `휴무 — <설명>` / `휴무` / `확인 필요`), `브레이크타임 <시작>~<끝>`, `라스트오더 <시각>`(둘 이상이면 `, `로), 둘을 ` · `로 잇는다, `네이버 안내: <freeText>`, `다가오는 임시 휴무: <원문들 , >`, `정기 휴무: <원문>`, `다른 운영 시간도 있어요: <이름들 , >`, `<day> <시작>~<끝>`(계산하지 않는 규칙), `공휴일 영업시간은 계산에 넣지 않아요`, `시각은 Day <N>을 고르면 확인해요`, `<M>월 <D>일 확인 · 네이버`, ` · 새로 받지 못했어요`, 버튼 `다시 확인` / 받는 중 `확인 중…`.
  - 확인 필요 이유(카드, `영업시간 확인 필요 — ` 뒤): `네이버 장소만 영업시간을 받아요` / `네이버에 영업시간이 없어요` / `네이버에서 장소를 찾지 못했어요` / `영업시간을 받지 못했어요` / `인터넷에 연결되지 않았어요`.
- 색: 경고 칩은 `var(--tm-label-orange-fill)` 바탕 · `var(--tm-label-orange-text)` 글자 · 굵게 700. 확인 필요는 `var(--tm-text-muted)` 12px. 새 토큰 없음.
- 터치 대상 44px, 버튼 이름 한국어, 카드 칸 제목 `h3`.
- E2E는 `E2E_PORT=5175`(5173은 다른 프로젝트의 개발 서버 — 절대 끄지 않는다, 5174는 지도 미리보기 서버). `pkill` 금지.

## Review Focus

1. **네이버가 요청을 막아 빈 페이지·다른 HTML을 줌**(잦은 요청, Cloudflare IP) → 502로 끝나고 캐시에 남지 않으며, 앱은 `영업시간 확인 필요 — 영업시간을 받지 못했어요`와 `다시 확인`. 정보 없음(`days: []`)과 섞이면 안 된다. Task 1(키 없음 → 502)·Task 2(오류 저장 안 함) 테스트로 고정, Task 8에서 미리보기 배포로 실제 확인.
2. **자정을 넘는 일정·영업**(도착 `다음 날 01:10`, 바 18:00~02:00, 24시간 영업) → 다음 날 도착은 다음 날 요일로, 전날 밤 구간 안이면 경고 없음, 00:00~24:00 매일은 자정에 끊기지 않음. Task 3 테스트로 고정.
3. **고정 시각을 기다리는 장소**(09:00 도착, 11:00 고정, 영업 10:00부터) → 경고 없음. 기다린 뒤 브레이크타임이면 `11:00 시작 — …`. Task 3 테스트로 고정.
4. **받은 적 있는 장소를 다시 받다 실패**(오프라인·서버 오류) → 옛 정보와 옛 확인 날짜로 계속 판정하고 ` · 새로 받지 못했어요`. 옛 정보가 지워지면 안 된다. Task 5(상태 갱신)·Task 6(카드) 테스트로 고정.
5. **같은 장소를 여러 Day·여러 여행에서 동시에 요청 / `다시 확인`을 연달아 누름** → 서버 요청은 하나로 합쳐지고, 나중에 시작한 요청의 답이 이긴다(번호 `seq`). Task 4·5 테스트로 고정.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/server/hours.ts` | 타입 `PlaceHours` 등, 질의 읽기, HTML에서 배열 떼기, 정규화, 요청·이동 |
| `src/server/cache-key.ts`, `functions/api/hours.ts` | 서버 함수 진입점과 캐시 키 |
| `src/domain/trips/hours.ts` | 순수 판정·문구 |
| `src/services/errors.ts`, `src/services/hours-lookup.ts`, `src/services/library-store.ts`, `src/lib/effect/runtime.ts` | 앱 서비스·기기 캐시·용량 초과 때 캐시 지우기 |
| `src/stores/place-hours.ts`, `src/sections/trips/planner/use-place-hours.ts` | 상태 atom과 요청·읽기 훅 |
| `src/sections/trips/planner/HoursNotice.tsx`, `DayTimeline.tsx`, `TripPlannerPage.tsx` | 행 한 줄 |
| `src/sections/trips/planner/HoursSection.tsx`, `MapCard.tsx` | 카드 칸 |
| `tests/fixtures/naver/pcmap-*.html`, `tests/fixtures/hours/api/daily.json`, `tests/e2e/business-hours.spec.ts` | 녹화·E2E |

---

### Task 1: 서버 — 네이버 장소 홈에서 영업시간 읽기

**Files:**
- Create: `src/server/hours.ts`, `tests/unit/server/hours.test.ts`, `tests/fixtures/naver/pcmap-home-11733192.html`, `tests/fixtures/naver/pcmap-home-11815720.html`
- Modify: `tests/fixtures/naver/README.md`(녹화 절 추가)

**Interfaces:**
- Consumes: `ApiError`(`./http`), `makeRequester`·`BROWSER_USER_AGENT`·`notFound`·`Deps`(`./request`).
- Produces:
  ```ts
  export type HoursSpan = { start: string; end: string };
  export type HoursDay = {
    day: string;
    open: (HoursSpan & { endsNextDay: boolean }) | null;
    closed: boolean;
    breaks: HoursSpan[];
    lastOrders: string[];
    note: string | null;
  };
  export type PlaceHours = {
    sid: string; fetchedAt: string; days: HoursDay[];
    irregularClosed: string[]; regularClosed: string | null; note: string | null; otherSchedules: string[];
  };
  export function parseHoursQuery(url: URL): string;            // sid. 틀리면 ApiError('BAD_REQUEST')
  export function extractBusinessHours(html: string): unknown[] | null; // 틀리면 ApiError('UPSTREAM_ERROR')
  export function toPlaceHours(sid: string, raw: unknown[] | null, fetchedAt: string): PlaceHours;
  export function resolveHours(sid: string, deps: Deps, now?: () => Date): Promise<PlaceHours>;
  ```

**fixture 만들기**(네트워크 1~2번, 간격 5초). 받은 HTML 전체(약 380KB)는 넣지 않고, 배열과 그 앞뒤 모양만 남긴 작은 HTML로 만든다:

```html
<!doctype html><html><head></head><body><script>window.__APOLLO_STATE__ = {"ROOT_QUERY":{"placeDetail({\"input\":{\"deviceType\":\"pcmap\",\"id\":\"<sid>\",\"isNx\":false}})":{"kinQna":{"__typename":"KinQna","answerList":null},"newBusinessHours":<배열>}}};
        !function(n,t){var a="]}[{";}("c92712568d67","ntm");
        </script></body></html>
```

`<배열>`은 2026-10-16 녹화값(`__typename` 뺌). 다시 녹화하면 값이 다를 수 있으니 테스트는 이 파일 값만 쓴다.

```json
11733192 (단천면옥):
[{"name":"기본","businessStatusDescription":{"status":"영업 중","blindDescription":"14시 30분에 브레이크타임","description":"14:30에 브레이크타임","showEndsNextDay":null},"businessHours":[{"day":"금","businessHours":{"start":"11:00","end":"21:00"},"breakHours":[{"start":"14:30","end":"16:30"}],"description":null,"lastOrderTimes":[{"type":"영업시간","time":"19:40"}],"showEndsNextDay":false},{"day":"토","businessHours":{"start":"11:00","end":"21:00"},"breakHours":[{"start":"14:30","end":"16:30"}],"description":null,"lastOrderTimes":[{"type":"영업시간","time":"19:40"}],"showEndsNextDay":false},{"day":"일","businessHours":{"start":"11:00","end":"21:00"},"breakHours":[{"start":"14:30","end":"16:30"}],"description":null,"lastOrderTimes":[{"type":"영업시간","time":"19:40"}],"showEndsNextDay":false},{"day":"월","businessHours":{"start":"11:00","end":"21:00"},"breakHours":[{"start":"14:30","end":"16:30"}],"description":null,"lastOrderTimes":[{"type":"영업시간","time":"19:40"}],"showEndsNextDay":false},{"day":"화","businessHours":{"start":"11:00","end":"21:00"},"breakHours":[{"start":"14:30","end":"16:30"}],"description":null,"lastOrderTimes":[{"type":"영업시간","time":"19:40"}],"showEndsNextDay":false},{"day":"수","businessHours":null,"breakHours":null,"description":"정기휴무 (매주 수요일)","lastOrderTimes":null,"showEndsNextDay":null},{"day":"목","businessHours":{"start":"11:00","end":"21:00"},"breakHours":[{"start":"14:30","end":"16:30"}],"description":null,"lastOrderTimes":[{"type":"영업시간","time":"19:40"}],"showEndsNextDay":false}],"comingIrregularClosedDays":[],"comingRegularClosedDays":"","freeText":""}]

11815720 (88생선구이):
[{"name":"","businessStatusDescription":{"status":"영업 중","blindDescription":"15시 0분에 브레이크타임","description":"15:00에 브레이크타임","showEndsNextDay":null},"businessHours":[{"day":"매일","businessHours":{"start":"08:30","end":"20:15"},"breakHours":[{"start":"15:00","end":"16:30"}],"description":null,"lastOrderTimes":null,"showEndsNextDay":false}],"comingIrregularClosedDays":[],"comingRegularClosedDays":"","freeText":"라스트오더 점심14:30 /저녁19:30"}]
```

README에 더할 절: 녹화일 2026-10-16, 명령 `curl -s -A "$UA" -H "Accept-Language: ko-KR,ko;q=0.9" -H "Referer: https://map.naver.com/" "https://pcmap.place.naver.com/restaurant/<sid>/home"`, 배열만 남기고 줄였다는 것, `/place/<sid>/home`은 식당이면 302로 `/restaurant/…`로 간다는 것, 요청 간격을 두라는 것(잦으면 빈 응답).

- [ ] **Step 1: 실패하는 테스트** (`tests/unit/server/hours.test.ts`, `// @vitest-environment node`)
  - `extractBusinessHours(fixture 11733192)` → 길이 1 배열, `[0].businessHours.length === 7`. 뒤 스크립트의 `"]}[{"`에 속지 않는다.
  - `extractBusinessHours`: `"newBusinessHours":null` → `null`; `"newBusinessHours":[]` → `[]`; `__APOLLO_STATE__` 없음 → `UPSTREAM_ERROR`; `__APOLLO_STATE__`는 있는데 키 없음 → `UPSTREAM_ERROR`; 닫는 괄호 없음 → `UPSTREAM_ERROR`; 문자열 안의 `]`·`\"` 가 든 freeText(`"a]\"b"`) → 바르게 읽음.
  - `toPlaceHours('11733192', <배열>, T)` → `days[5]`가 `{ day: '수', open: null, closed: true, breaks: [], lastOrders: [], note: '정기휴무 (매주 수요일)' }`, `days[0]`이 `{ day: '금', open: { start: '11:00', end: '21:00', endsNextDay: false }, closed: false, breaks: [{ start: '14:30', end: '16:30' }], lastOrders: ['19:40'], note: null }`, `irregularClosed: []`, `regularClosed: null`, `note: null`, `otherSchedules: []`, `fetchedAt: T`.
  - 88생선구이 → `days: [{ day: '매일', … breaks: [{start:'15:00',end:'16:30'}], lastOrders: [] }]`, `note: '라스트오더 점심14:30 /저녁19:30'`.
  - 정규화 경계: `end: '24:00'` 그대로, `end: '24:30'`·`start: '9:00'` → `open: null, closed: false`; `showEndsNextDay: true` → `endsNextDay: true`; `businessHours: null`·`description: null` → `closed: false`; `description: '브레이크타임 별도'`·`businessHours: null` → `closed: false`(설명에 `휴무` 없음); `breakHours: 'x'` → `[]`; 항목 둘(`name: '기본'`, `name: '수영장'`) → 첫 항목 계산, `otherSchedules: ['수영장']`; `comingIrregularClosedDays: ['2026-10-21 임시휴무', { date: '10월 22일', text: '내부 공사' }, 3]` → `['2026-10-21 임시휴무', '10월 22일 내부 공사']`; `raw: null`·`[]` → `days: []`.
  - `parseHoursQuery`: `?sid=11733192` → `'11733192'`; 없음·`abc`·16자리·`1 2` → `BAD_REQUEST`.
  - `resolveHours`(가짜 `fetch`): `/place/11733192/home`이 302 `Location: /restaurant/11733192/home?entry=x` → 두 번째 요청 주소가 쿼리 없는 `https://pcmap.place.naver.com/restaurant/11733192/home`, 결과 `fetchedAt`은 `now()`. 모든 요청 `redirect: 'manual'`·`Origin` 헤더 없음·세 헤더 있음. 이동 3번 → `UPSTREAM_ERROR`. 다른 호스트·다른 sid·`http:`로 이동 → `UPSTREAM_ERROR`. 네이버 404 → `NOT_FOUND`. 박물관처럼 이동 없이 200 → 그대로 읽음.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/hours.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3:** 구현. 괄호 맞추기는 `"newBusinessHours":` 뒤 공백을 건너 첫 글자가 `[`면 깊이·문자열 안 여부·이스케이프를 세며 짝 `]`까지 자른 뒤 `JSON.parse`(실패하면 `UPSTREAM_ERROR`). 첫 글자가 `n`이고 `null`이면 `null`. 시각 꼴 `START = /^([01]\d|2[0-3]):[0-5]\d$/`, `END`는 그것 또는 `'24:00'`. 요청은 `makeRequester(deps)`로 `acceptRedirect: true`, 3xx면 `Location`을 `new URL(location, current)`로 풀어 검사 후 쿼리·해시를 지운다. 본문은 `res.text()`.
- [ ] **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(server): 네이버 장소 홈에서 요일별 영업시간 읽기`

---

### Task 2: 서버 함수 `/api/hours`

**Files:**
- Create: `functions/api/hours.ts`
- Modify: `src/server/cache-key.ts`
- Test: `tests/unit/server/functions.test.ts`(새 `describe`)

**Interfaces:**
- Consumes: Task 1의 `parseHoursQuery`·`resolveHours`; `handleGet`·`globalFetch`.
- Produces: `export function hoursCacheKey(sid: string): string` → `` `${CACHE_ORIGIN}/hours/naver/${sid}` ``. `GET /api/hours?sid=<sid>[&fresh=1]` → 200 `PlaceHours`.

- [ ] **Step 1: 실패하는 테스트**
  - `hoursCacheKey('11733192')` → `'https://cache.landmark/hours/naver/11733192'`.
  - 허용 출처 + `sid=11733192`(가짜 fetch: `/place/…` 302 → `/restaurant/…` 200 fixture) → 200, 본문 `days.length === 7`, 브라우저 응답 `Cache-Control: private, no-store`.
  - 가짜 `caches.default`로: 1일(`max-age=86400`) 저장, 같은 sid 다시 → 바깥 요청 0번, `fetchedAt`이 처음 값 그대로. `fresh=1` → 캐시를 보지 않고 다시 받아 같은 키(`fresh` 없음)에 저장.
  - `sid=abc` → 400 `BAD_REQUEST`, 바깥 요청 없음. 키 없는 HTML → 502, 저장 안 함. 출처 없음 → 403.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/functions.test.ts` → FAIL
- [ ] **Step 3:** `functions/api/hours.ts`: `readInput: parseHoursQuery`, `maxAgeSeconds: 86_400`, `cacheKey: hoursCacheKey`, `bypassCache: (url) => url.searchParams.get('fresh') === '1'`, `resolve: (sid) => resolveHours(sid, { fetch: globalFetch })`. 첫 줄 주석은 다른 함수와 같은 꼴.
- [ ] **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(api): /api/hours — 네이버 영업시간(엣지 캐시 1일)`

---

### Task 3: 판정과 문구

**Files:**
- Create: `src/domain/trips/hours.ts`, `tests/unit/domain/trips/hours.test.ts`

**Interfaces:**
- Consumes: `import type { HoursDay, HoursSpan, PlaceHours } from 'src/server/hours'`, `formatClock`·`type PointTime`(`src/domain/trips/schedule`).
- Produces:
  ```ts
  export type Weekday = '일' | '월' | '화' | '수' | '목' | '금' | '토';
  export function weekdayOf(date: string): Weekday;
  export type DayRule =
    | { kind: 'open'; day: HoursDay }
    | { kind: 'closed'; note: string | null }
    | { kind: 'unknown' };
  export function dayRuleFor(hours: PlaceHours, date: string): DayRule;
  /** 그 날짜가 든 임시 휴무 원문. 없으면 null. */
  export function irregularMatch(hours: PlaceHours, date: string): string | null;
  export type Visit = { startMin: number; endMin: number; waited: boolean };
  export function visitOf(point: PointTime, stop: { fixedTime: string | null }): Visit;
  export type VisitCheck =
    | { kind: 'ok' }
    | { kind: 'unknown' }
    | { kind: 'closed-day'; note: string | null }
    | { kind: 'irregular-closed'; text: string }
    | { kind: 'before-open'; visit: Visit; opensAt: string }
    | { kind: 'after-close'; visit: Visit; closedAt: string }
    | { kind: 'break'; visit: Visit; span: HoursSpan }
    | { kind: 'last-order'; visit: Visit; lastOrder: string }
    | { kind: 'closes-during-stay'; closesAt: string }
    | { kind: 'break-during-stay'; span: HoursSpan };
  /** 날짜만(후보·다른 Day의 장소): ok·unknown·closed-day·irregular-closed만 나온다. date는 Day 날짜. */
  export function checkDate(hours: PlaceHours, date: string): VisitCheck;
  /** date는 Day 날짜, visit은 그 Day 축의 분. */
  export function checkVisit(hours: PlaceHours, date: string, visit: Visit): VisitCheck;
  /** ok는 null, unknown은 '영업시간 확인 필요', 그 밖은 Global Constraints의 경고 문구. */
  export function visitMessage(check: VisitCheck): string | null;
  /** '11:00~21:00' | '18:00~02:00(다음 날)' | '휴무 — 정기휴무 (매주 수요일)' | '휴무' | '확인 필요' */
  export function ruleText(rule: DayRule): string;
  /** '브레이크타임 14:30~16:30 · 라스트오더 19:40'. 둘 다 없으면 null. */
  export function ruleExtras(day: HoursDay): string | null;
  /** 계산하지 않는 규칙(요일·매일이 아닌 day) 줄: '공휴일 10:00~17:00'. */
  export function uncountedRules(hours: PlaceHours): string[];
  ```
- `visitOf`: 고정 시각이 있고 `point.slackMin >= 0`이면 `startMin = 고정 시각 분`, `waited: true`(단, 고정 = 도착이면 `waited: false`), 아니면 `startMin = arriveMin`. `endMin = departMin`.
- 판정 순서·자정 처리는 스펙 §3.2~3.3 그대로. 구간은 `X`(=`Day 날짜 + floor(startMin/1440)`)와 `X-1`의 규칙에서 만들어 절대 분으로 옮긴 뒤, 끝 = 다음 시작인 구간을 이어 붙인다. `X-1`이 Day 날짜보다 앞이어도 같은 방법(요일만 본다).
- 임시 휴무 날짜 꼴: `(\d{4})-(\d{1,2})-(\d{1,2})`, `(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})`, `(\d{1,2})월\s?(\d{1,2})일`(연도는 대상 날짜의 연도).

- [ ] **Step 1: 실패하는 테스트** — 단천면옥 정규화 값(Task 1 기대값을 테스트 안에 상수로)과 손으로 만든 `PlaceHours`로:
  - `weekdayOf('2026-10-21')` → `'수'`, `weekdayOf('2026-10-16')` → `'금'`(`TZ`를 바꿔도 같음: `process.env.TZ` 없이 UTC 계산).
  - `dayRuleFor`: 수요일 → `closed`(설명), 금요일 → `open`, `매일`만 있는 곳 → 아무 날 `open`, 금요일 항목 없고 `매일`도 없음 → `unknown`, `open: null`·`closed: false` → `unknown`, `days: []` → `unknown`.
  - `checkVisit`(단천면옥, `2026-10-16` 금):
    - 10:30 도착 → `before-open`, 문구 `10:30 도착 — 영업 시작 11:00`.
    - 15:40 → `break`, `15:40 도착 — 브레이크타임 14:30~16:30`.
    - 19:50 → `last-order`, `19:50 도착 — 라스트오더 19:40`.
    - 21:10 → `after-close`, `21:10 도착 — 영업 종료 21:00`.
    - 14:00 도착·15:00 떠남 → `break-during-stay`, `머무는 중 브레이크타임 14:30~16:30`.
    - 18:00 도착·21:30 떠남(라스트오더 전 도착) → `closes-during-stay`, `머무는 중 영업 종료 21:00`.
    - 12:00 도착·13:00 떠남 → `ok`, 문구 `null`.
    - `2026-10-21`(수) 12:00 → `closed-day`, `휴무일 — 정기휴무 (매주 수요일)`.
    - 화요일 Day에 `arriveMin` 1500(다음 날 01:00, 수요일) → `closed-day`.
  - 자정 넘김(`매일 18:00~02:00`, `endsNextDay: true`): 금 Day 1500분(다음 날 01:00) → `ok`; 금 Day 150분(02:30, 전날 밤 영업이 02:00에 끝남) → `after-close`, 문구 `02:30 도착 — 영업 종료 02:00`; 금 Day 600분(10:00) → `before-open`, `10:00 도착 — 영업 시작 18:00`; 23:00 도착·다음 날 03:00 떠남 → `closes-during-stay`, `머무는 중 영업 종료 02:00(다음 날)`; 끝이 시작보다 이른데 `endsNextDay: false`여도 같은 결과.
  - 24시간(`매일 00:00~24:00`): 23:30 도착·다음 날 00:30 떠남 → `ok`.
  - `24:00`(구십도씨처럼 `11:00~24:00`): 23:50 → `ok`, 다음 날 00:10 도착 → `after-close`, 문구 `다음 날 00:10 도착 — 영업 종료 24:00`.
  - 라스트오더 둘(`11:00~21:00`, 브레이크 `15:00~17:00`, 라스트오더 `14:30`·`20:00`): 14:40 → `last-order 14:30`, 17:30 → `ok`, 20:10 → `last-order 20:00`.
  - 고정 시각: 09:00 도착·11:00 고정(`slackMin` 120)·영업 10:00~ → `visitOf`가 `startMin 660, waited true`, `checkVisit` → `ok`; 14:00 도착·15:00 고정·브레이크 15:00~16:30 → `break`, 문구 `15:00 시작 — 브레이크타임 15:00~16:30`; 늦은 고정(`slackMin` < 0) → `startMin = arriveMin`, `waited false`.
  - 임시 휴무: `irregularClosed: ['2026-10-17 내부 공사']` → `2026-10-17` `irregular-closed`(문구 `임시 휴무 — 2026-10-17 내부 공사`), `2026.10.17`·`2026. 10. 17`·`10월 17일` 꼴도 같음, 날짜 없는 `'추석 연휴'` → 맞지 않음, 휴무일보다 임시 휴무가 먼저.
  - 모르는 `day`(`공휴일`)만 있음 → `unknown`; `uncountedRules` → `['공휴일 10:00~17:00']`; 휴무 `공휴일` → `['공휴일 휴무']`.
  - `checkDate`: 수요일 → `closed-day`, 금요일 → `ok`, `days: []` → `unknown`.
  - `ruleText`·`ruleExtras`: `'11:00~21:00'`, `'18:00~02:00(다음 날)'`, `'휴무 — 정기휴무 (매주 수요일)'`, 설명 없음 `'휴무'`, `'확인 필요'`, `'브레이크타임 14:30~16:30 · 라스트오더 19:40'`, 라스트오더 둘 `'라스트오더 14:30, 20:00'`.
  - NaN·음수 분 → `unknown`(던지지 않음).
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/trips/hours.test.ts` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trips): 도착 시각과 영업시간을 맞춰 보는 판정`

---

### Task 4: 앱 서비스 `HoursLookup`과 기기 캐시

**Files:**
- Create: `src/services/hours-lookup.ts`, `tests/unit/services/hours-lookup.test.ts`
- Modify: `src/services/errors.ts`, `src/services/library-store.ts`(`putItem`의 캐시 지우기), `src/lib/effect/runtime.ts`(`AppLayer`), 테스트 런타임 다섯 곳(`tests/unit/sections/shell/harness.tsx`, `tests/unit/sections/library/use-library-query.test.tsx`, `tests/unit/sections/trips/planner-timeline.test.tsx`, `tests/unit/stores/library-state.test.tsx`, `tests/unit/theme/theme-root.test.tsx` — `grep -rln "RouteLookup" tests/unit | xargs grep -l ManagedRuntime`로 다시 확인)
- Test: `tests/unit/services/library-store.test.ts`(용량 초과)

**Interfaces:**
- Consumes: `type PlaceHours`(Task 1).
- Produces:
  ```ts
  // src/services/errors.ts
  export const HOURS_LOOKUP_ERROR_CODES = ['NOT_FOUND', 'UPSTREAM_ERROR', 'TIMEOUT', 'BAD_REQUEST', 'FORBIDDEN_ORIGIN', 'OFFLINE'] as const;
  export type HoursLookupErrorCode = (typeof HOURS_LOOKUP_ERROR_CODES)[number];
  export class HoursLookupError /* TaggedError 'HoursLookupError' { code, seq: number } */ {
    get userMessage(): string; // NOT_FOUND '네이버에서 장소를 찾지 못했어요', OFFLINE '인터넷에 연결되지 않았어요', 그 밖 '영업시간을 받지 못했어요'
  }
  // src/services/hours-lookup.ts
  export const HOURS_CACHE_KEY = 'tripmap:hours:v1';
  export const HOURS_CACHE_MAX = 300;
  export const HOURS_CACHE_MAX_CHARS = 400_000;
  export const HOURS_STALE_MS = 7 * 86_400_000;
  export const HOURS_TIMEOUT_MS = 12_000;
  export const HOURS_MAX_CONCURRENT = 2;
  /** 서버 응답·저장 항목이 PlaceHours 모양이면 그 부분만, 아니면 null. */
  export function toPlaceHoursValue(value: unknown): PlaceHours | null;
  export type HoursAnswer = { hours: PlaceHours; seq: number };
  export class HoursLookup extends Context.Service<HoursLookup, {
    /** 캐시에 있는 것(오래됐어도). 없으면 null. 요청하지 않는다. */
    peek(sid: string): PlaceHours | null;
    /** 캐시가 7일 안이고 refresh가 아니면 캐시(seq 0), 아니면 서버(`refresh`면 `&fresh=1`). */
    place(sid: string, options?: { refresh?: boolean }): Effect.Effect<HoursAnswer, HoursLookupError>;
  }>()('tripmap/HoursLookup') {
    static layerWith(options: { fetch: typeof fetch; storage: Storage | null; base?: string; now?: () => Date }): Layer.Layer<HoursLookup>;
    static readonly layer: Layer.Layer<HoursLookup>;
  }
  // tests: harness 기본값
  // `PENDING_HOURS_LOOKUP`: peek → null, place → Effect.never (행에 아무것도 안 보여 기존 화면 테스트가 그대로 통과)
  ```
- 동작은 `RouteLookup`을 본뜬다: 요청 번호 `seq`(1부터), 진행 중 표는 `sid` / `sid|fresh`(보통 호출은 진행 중인 refresh에 먼저 합류), `Semaphore` 2, `Effect.timeoutOrElse` 12초 → `TIMEOUT`, 응답 처리(JSON 아님 → 5xx면 `UPSTREAM_ERROR` 아니면 `OFFLINE`, `error` 본문 → 코드 변환(목록 밖은 `UPSTREAM_ERROR`), `error` 없는 404 → `OFFLINE`, 모양 틀림 → `UPSTREAM_ERROR`), `FORBIDDEN_ORIGIN`·`OFFLINE` 콘솔 경고는 세션에 한 번. 캐시에 넣을 때 더 새 `fetchedAt`이 이미 있으면 그것을 지키고 돌려준다. 저장은 받을 때마다 바로(모으지 않음), 실패하면 오래된 절반을 지우고 한 번 더, 또 실패하면 메모리만.
- `library-store.ts`: `dropRouteCache`를 `dropCaches`로 바꿔 `ROUTE_CACHE_KEY`·`HOURS_CACHE_KEY` 중 있는 것을 모두 지우고, 하나라도 지웠으면 다시 쓴다. F1이 `putItem`에 더한 다음 단계(그래도 넘치면 `PREVIOUS_KEY` 사본을 지우고 다시 — `replace` 안이거나 쓰는 키가 사본이면 건너뜀)는 그대로 그 뒤에 둔다. 병합본의 `putItem`을 먼저 읽고 F1의 시험(`일반 update가 용량 초과일 때 경로 캐시 → 사본 순으로 지움`)이 그대로 통과하게 한다.

- [ ] **Step 1: 실패하는 테스트** (`hours-lookup.test.ts`, 가짜 `fetch`·메모리 `Storage`·고정 `now`)
  - 첫 `place('11733192')` → 요청 `/api/hours?sid=11733192` 1번, `seq: 1`, 저장소에 `entries['11733192']`(+`usedAt`). 같은 서비스로 다시 → 요청 없음, `seq: 0`.
  - `now`를 `fetchedAt` + 7일 − 1ms → 요청 없음, + 7일 → 요청 1번(`fresh` 없음). `refresh: true` → `&fresh=1`.
  - 같은 sid 동시 셋 → 요청 1번, 셋 다 같은 답. 서로 다른 sid 다섯 동시 → 동시에 나가는 요청이 2개를 넘지 않음.
  - 보통 요청 진행 중 `refresh` → 둘째 요청(`fresh=1`)이 따로 나가고 `seq`가 더 큼. 늦게 온 보통 응답의 `fetchedAt`이 더 오래되면 캐시는 새것을 지킨다.
  - 오류: `{error:{code:'NOT_FOUND'}}` 404 → `NOT_FOUND`, 502 HTML → `UPSTREAM_ERROR`, 200 HTML → `OFFLINE`, `fetch` 거부 → `OFFLINE`, 모양 틀린 200 JSON → `UPSTREAM_ERROR`, 응답 없음 12초(가짜 시계 `TestClock`) → `TIMEOUT`. 실패에도 그 요청의 `seq`.
  - 저장소: 깨진 JSON → 빈 캐시, 모양 틀린 항목만 버림, 301곳 → 가장 오래 안 쓴 것 하나 지움, 40만 자 넘음 → 넘친 만큼 오래된 것부터, `setItem`이 늘 던짐 → 답은 오고 메모리에만.
  - `peek`: 캐시 없음 `null`, 8일 된 것도 그대로.
  - `toPlaceHoursValue`: Task 1 결과는 통과, `days[0].open.start: 9` 같은 틀린 값 → `null`.
  - `HoursLookupError.userMessage` 세 문구.
  - `library-store.test.ts`: 보관함 저장이 용량 초과일 때 `tripmap:hours:v1`만 있어도 지우고 다시 써서 성공. 영업시간 캐시와 F1 사본이 함께 있으면 캐시를 먼저 지우고, 그것으로 들어가면 사본은 남는다.
- [ ] **Step 2:** `yarn vitest run tests/unit/services` → FAIL
- [ ] **Step 3:** 구현. `AppLayer`에 `HoursLookup.layer`를 더하고, 테스트 런타임 다섯 곳에 `PENDING_HOURS_LOOKUP`(harness는 `hoursLookup?: Layer.Layer<HoursLookup>` 옵션, 기본값 그것)을 넣는다.
- [ ] **Step 4:** PASS + `yarn test` 전체 + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(services): 영업시간 조회와 기기 캐시(tripmap:hours:v1, 7일)`

---

### Task 5: 상태·요청 훅과 시간표 행 경고

**Files:**
- Create: `src/stores/place-hours.ts`, `src/sections/trips/planner/use-place-hours.ts`, `src/sections/trips/planner/HoursNotice.tsx`, `tests/unit/sections/trips/planner-hours.test.tsx`
- Modify: `src/sections/trips/planner/DayTimeline.tsx`(`StopRow`), `src/sections/trips/planner/TripPlannerPage.tsx`(요청 훅 한 번), `src/components/icons.tsx`(`AlertIcon`), `tests/unit/sections/trips/planner-fixtures.tsx`(`fakeHours`, `open`의 `hours` 옵션)

**Interfaces:**
- Consumes: Task 3의 `checkVisit`·`visitOf`·`visitMessage`, Task 4의 `HoursLookup`·`HoursLookupErrorCode`, `tripDates`(`src/domain/trips/query`).
- Produces:
  ```ts
  // src/stores/place-hours.ts
  export type HoursState = { hours: PlaceHours | null; pending: boolean; error: HoursLookupErrorCode | null; seq: number };
  export const hoursStatesAtom: PrimitiveAtom<Record<string, HoursState>>; // 키는 sid
  // src/sections/trips/planner/use-place-hours.ts
  export function naverSid(place: Place): string | null;
  /** 그 여행 모든 Day의 네이버 장소(고른 Day 먼저)를 묻는다. 상태가 없는 것만, OFFLINE은 online 때 다시. */
  export function useTripHoursRequests(tripId: string, dayIndex: number): void;
  export type PlaceHoursView =
    | { kind: 'unsupported' }
    | { kind: 'loading' }
    | { kind: 'known'; hours: PlaceHours; pending: boolean; error: HoursLookupErrorCode | null }
    | { kind: 'failed'; error: HoursLookupErrorCode; pending: boolean };
  /** request면 상태가 없을 때 그 장소 하나를 묻는다(후보 카드). refresh는 fresh=1. */
  export function usePlaceHours(place: Place, options?: { request?: boolean }): { view: PlaceHoursView; refresh(): void };
  // src/sections/trips/planner/HoursNotice.tsx
  export type Notice = { text: string; tone: 'warn' | 'muted' };
  export function noticeFor(view: PlaceHoursView, check: (hours: PlaceHours) => VisitCheck): Notice | null;
  export function HoursNotice({ notice }: { notice: Notice }): JSX.Element;
  // planner-fixtures.tsx
  export function fakeHours(answer: (sid: string, refresh: boolean) => PlaceHours | HoursLookupErrorCode | 'pending'): { layer: Layer.Layer<HoursLookup>; calls: { sid: string; refresh: boolean }[] };
  ```
- 요청 한 번(`lookupHours(store, sid, refresh)`): 시작할 때 `{ hours: prev?.hours ?? lookup.peek(sid), pending: true, error: prev?.error ?? null, seq: prev?.seq ?? 0 }`, 끝나면 성공 `{ hours, pending: false, error: null, seq }`, 실패 `{ hours: prev.hours(지우지 않음), pending: false, error: code, seq }` — `seq`가 지금보다 작은 답은 버린다(`useDayPlan`의 `lookupLeg`와 같은 규칙). 동시 수는 서비스가 막는다.
- `noticeFor`: `unsupported`·`failed` → `{ text: '영업시간 확인 필요', tone: 'muted' }`, `loading` → `null`, `known` → `check(hours)`가 `ok`면 `null`, `unknown`이면 muted, 그 밖 warn + `visitMessage`.
- `StopRow`에 `date: string`(그 Day 날짜)을 더해, `point`가 있으면 `noticeFor(view, (h) => checkVisit(h, date, visitOf(point, stop)))`를 체류·고정 줄 아래 `HoursNotice`로. 칩: 아이콘 `~icons/lucide/triangle-alert`(12px, `aria-hidden`)를 `src/components/icons.tsx`에 `AlertIcon`으로 더해 쓴다.

- [ ] **Step 1: 실패하는 테스트** (`planner-hours.test.tsx`, `open(lib, { hours: fakeHours(…) })` — `open`에 `hours` 옵션을 더한다)
  - Day 1(`2026-10-16` 금) 첫 장소(출발 09:00)에 단천면옥 값 → 행에 `09:00 도착 — 영업 시작 11:00`, 칩 글자색 `var(--tm-label-orange-text)`.
  - 출발 시각을 12:00으로 바꾸면 칩이 사라지고 `calls`가 늘지 않는다(다시 묻지 않음).
  - 카카오 장소 행 → `영업시간 확인 필요`(muted). `pending` → 줄 없음. `OFFLINE` → `영업시간 확인 필요`, `window` `online` 이벤트 → 다시 물음.
  - Day 2의 네이버 장소도 묻는다(고른 Day가 먼저: `calls[0]`이 Day 1 장소).
  - 같은 장소를 두 번 묻는 일 없음(다시 렌더해도 `calls` 그대로).
  - 성공 뒤 `refresh`가 `OFFLINE`으로 실패 → 옛 `hours`가 남아 칩이 그대로.
  - 늦게 끝난 작은 `seq`의 답이 큰 `seq`의 상태를 덮지 않음(`fakeHours`가 답 순서를 바꿔 줌).
  - 기존 `tests/unit/sections/trips/*` 그대로 통과(기본 `PENDING_HOURS_LOOKUP`).
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/trips` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat(planner): 시간표 행에 영업시간·휴무 경고`

---

### Task 6: 지도 카드의 `영업시간` 칸

**Files:**
- Create: `src/sections/trips/planner/HoursSection.tsx`
- Modify: `src/sections/trips/planner/MapCard.tsx`(`plan: DayPlan` prop, 칸 넣기), `src/sections/trips/planner/TripPlannerPage.tsx`(`plan` 넘기기), `src/sections/trips/planner/format.ts`(`hoursCheckedLabel`)
- Test: `tests/unit/sections/trips/planner-hours.test.tsx`(카드 `describe`)

**Interfaces:**
- Consumes: Task 3의 `dayRuleFor`·`ruleText`·`ruleExtras`·`uncountedRules`·`checkDate`·`checkVisit`·`visitOf`, Task 5의 `usePlaceHours`·`noticeFor`·`HoursNotice`, `shortDate`(`src/sections/trips/trip-dates`), `dayEndpoints`·`tripDates`.
- Produces:
  ```ts
  // format.ts — `queriedLabel`과 같은 날짜 꼴. F7 보기 화면이 format.ts를 런타임으로 import하므로 새 import를 더하지 않는 순수 함수로 둔다
  export function hoursCheckedLabel(iso: string): string; // '10월 16일 확인 · 네이버'
  // HoursSection.tsx
  export function HoursSection(props: {
    trip: Trip; dayIndex: number; place: Place; plan: DayPlan;
    /** 그 장소가 있는 Day·순서. 후보면 null. */
    found: { dayIndex: number; index: number; stop: Stop } | null;
  }): JSX.Element | null;
  ```
- 배치는 스펙 §2.2 그대로: `h3 영업시간`, 규칙 줄, 덧붙임 줄, 경고 칩(`HoursNotice`), 계산하지 않는 규칙 줄들과 `공휴일 영업시간은 계산에 넣지 않아요`(`공휴일`이 들어 있을 때만), `네이버 안내: …`, `다가오는 임시 휴무: …`, `정기 휴무: …`, `다른 운영 시간도 있어요: …`, 확인 날짜 줄(`aria-live="polite"`) + `다시 확인`(MUI `Button size="small"`, `minHeight: 44`).
- 시각: `found.dayIndex === dayIndex`면 `plan.schedule.points[(start !== null ? 1 : 0) + found.index]`로 `checkVisit`, 다르면 `checkDate`(그 Day 날짜) + `시각은 Day <N>을 고르면 확인해요`, 후보면 `checkDate`(고른 Day 날짜). 출발지·숙소로만 쓰인 장소(`found === null`이고 후보 아님)는 `null`.
- 확인 필요 카드: `unsupported` → `영업시간 확인 필요 — 네이버 장소만 영업시간을 받아요`(버튼 없음), `known`이고 `days: []` → `… — 네이버에 영업시간이 없어요` + 확인 날짜 줄, `failed` → `… — <HoursLookupError userMessage>`. `known`에 `error`가 있으면 확인 날짜 줄 끝에 ` · 새로 받지 못했어요`. `pending`이면 버튼 `확인 중…`·`disabled`.

- [ ] **Step 1: 실패하는 테스트**
  - Day 1 장소 카드(단천면옥, 15:40 도착이 되도록 출발 시각 15:40): `영업시간`(h3), `Day 1 · 10.16(금) · 11:00~21:00`, `브레이크타임 14:30~16:30 · 라스트오더 19:40`, `15:40 도착 — 브레이크타임 14:30~16:30`, `10월 16일 확인 · 네이버`(`fetchedAt` `2026-10-16T01:00:00.000Z`, 테스트 `TZ` 고정은 기존 planner 테스트와 같게), `다시 확인`.
  - `다시 확인` → `calls`에 `{ refresh: true }`, 답이 오기 전 버튼 `확인 중…`·비활성, 답이 오면 날짜 줄이 새 `fetchedAt`으로.
  - 여행을 `2026-10-20`(화)~`10-21`(수)로 잡고 Day 1을 고른 채 Day 2 장소 카드를 엶 → `Day 2 · 10.21(수) · 휴무 — 정기휴무 (매주 수요일)`, 칩 `휴무일 — 정기휴무 (매주 수요일)`, `시각은 Day 2를 고르면 확인해요`.
  - 후보 카드 → 그 장소 하나를 묻고(`calls`), 고른 Day 날짜로 규칙 줄.
  - 카카오 장소 카드 → `영업시간 확인 필요 — 네이버 장소만 영업시간을 받아요`, `다시 확인` 없음. 정보 없음 → `… — 네이버에 영업시간이 없어요`.
  - 성공 뒤 `다시 확인`이 `UPSTREAM_ERROR` → 옛 규칙 줄 그대로 + ` · 새로 받지 못했어요`.
  - `freeText`·`otherSchedules`·`공휴일` 규칙이 있는 값 → 각 줄과 `공휴일 영업시간은 계산에 넣지 않아요`.
  - 숙소로만 쓰인 장소 카드 → `영업시간` 칸 없음.
  - `다시 확인` 버튼 높이 44px 이상(계산된 `min-height`).
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat(planner): 지도 카드에 그날 영업시간·확인 날짜·다시 확인`

---

### Task 7: E2E

**Files:**
- Create: `tests/e2e/business-hours.spec.ts`, `tests/fixtures/hours/api/daily.json`

**Interfaces:**
- Consumes: `seedStorage`(`./fixtures`), 강릉 여행 만들기 흐름(`trip-planning.spec.ts`의 `createGangneungTrip`과 같은 단계 — 공용으로 옮기지 말고 이 파일에 짧게 다시 쓴다), `/api/route` 녹화 응답(`tests/fixtures/routes/api/car.json`).
- `daily.json`: `{ "sid": "0", "fetchedAt": "2026-10-16T01:00:00.000Z", "days": [{ "day": "매일", "open": { "start": "10:00", "end": "20:00", "endsNextDay": false }, "closed": false, "breaks": [], "lastOrders": [], "note": null }], "irregularClosed": [], "regularClosed": null, "note": null, "otherSchedules": [] }`. `page.route('**/api/hours?**')`가 `sid`를 질의 값으로 바꿔 돌려주고 질의(`sid`, `fresh`)를 모은다.

- [ ] **Step 1: 시험 작성** — `@smoke 도착 시각이 영업 전이면 행과 카드에 경고`: 강릉 여행 → `초당순두부 본점` Day 1에 넣기 → (좁은 화면은 `Day 1` 시트 탭) 행에 `09:00 도착 — 영업 시작 10:00` → 행을 눌러 카드 → `10월 16일 확인 · 네이버` → `다시 확인` → 모은 질의에 `fresh=1` → 카드 닫고 `출발 시각`을 `10:30`으로 → 경고가 사라짐. 세 프로젝트(desktop·iphone·galaxy).
- [ ] **Step 2:** `E2E_PORT=5175 yarn test:e2e tests/e2e/business-hours.spec.ts` → PASS(세 프로젝트)
- [ ] **Step 3:** `E2E_PORT=5175 yarn test:e2e` 전체 통과(기존 계획 시험은 `/api/hours`를 막지 않아 행에 `영업시간 확인 필요`가 더해질 뿐이다 — 행 버튼 이름을 `^…$`로 잡는 곳이 깨지면 그 시험에 `/api/hours`를 `pending`(응답하지 않음)으로 막는 한 줄을 더해 고친다).
- [ ] **Step 4:** 커밋 `test(e2e): 영업시간 경고`

---

### Task 8: 전체 확인과 배포 전 확인 (커밋 없음)

- [ ] **Step 1:** `yarn build:ci` 통과. 첫 로딩 gzip 값을 보고(2026-10-14 297,769 / 예산 327,680). 넘으면 멈추고 보고한다(스펙 §8의 대안: `HoursLookup`을 계획 화면 레이어로).
- [ ] **Step 2: 미리보기 배포에서 네이버 접속 확인** — PR 미리보기 주소(`https://<이름>.landmark-c5f.pages.dev`)에 `curl -s -H "Origin: https://<이름>.landmark-c5f.pages.dev" "https://<이름>.landmark-c5f.pages.dev/api/hours?sid=11733192"` 한 번 → 200이고 `days`가 7개. 502면 병합하지 말고 응답을 보고한다(스펙 §12-9).
- [ ] **Step 3: 되돌리기 확인** — 임시 브랜치(`git switch -c tmp/revert-check`)에서 Task 7 → 1 순서로 커밋을 하나씩 `git revert --no-edit`하며 그때마다 `yarn typecheck && yarn test` 통과를 확인한다. 끝나면 원래 브랜치로 돌아가 임시 브랜치를 지운다. 원격에는 올리지 않는다. 결과를 보고서에.
- [ ] **Step 4: 병합 뒤**(사용자가 병합 커밋으로 병합한 다음) `main`의 병합 커밋에 `v0.13.0` 태그, 별도 문서 PR로 `docs/rollback.md` 표에 `` | `v0.13.0` | `<병합 커밋 7자리>` | 영업시간·휴무 경고: 시간표 행·지도 카드, 기기 캐시 `tripmap:hours:v1` (#<PR>) | ✅ | ``를 더하는 커밋 `docs: 롤백 표에 v0.13.0`. 표 아래 설명에 "`tripmap:hours:v1`은 다시 받는 캐시라 옛 버전은 읽지도 지우지도 않는다" 한 줄.
