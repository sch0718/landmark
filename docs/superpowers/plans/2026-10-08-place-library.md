# 장소 보관함 (하위 프로젝트 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 빌드 타임 여행 뷰어를, 라벨(복수)·메모로 장소를 모으고 라벨·지역별로 보는 로컬 우선 "장소 보관함" 앱으로 바꾼다(Effect 4 기반, 테마 3종, 데스크톱 3단·모바일 하단 탭).

**Architecture:** 브라우저 localStorage의 `Library` 문서 하나가 원본이다. 모든 쓰기는 `LibraryStore.update(f)`(잠금 → 최신본 재읽기 → 변경 함수 → 검증 → 저장)를 거친다. 도메인 규칙은 `src/domain/library/`의 순수 함수, 실패·의존성이 있는 작업은 Effect 서비스(`ManagedRuntime` + `AppLayer`), 화면은 React + Jotai + MUI(새 토큰 테마)다.

**Tech Stack:** React 19, Vite 8, TypeScript 6, `effect@4.0.2`(Schema 포함, Zod 대체), `@effect/vitest@4.0.2`, Jotai, MUI 7, dnd-kit, sonner, `@tanstack/react-virtual`, unplugin-icons + `@iconify-json/lucide`, `pretendard`, `@fontsource/gowun-batang`, Vitest 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-place-library-design.md` (r3 승인). 각 태스크는 스펙의 절 번호(§)를 근거로 든다. 실행자는 스펙과 이 계획을 함께 읽는다.

## Global Constraints

- Node 24(`.nvmrc`). 커밋 훅(lint-staged)은 Node 24에서만 동작한다. 셸에 Node 18이 잡혀 있으면 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"` 후 커밋한다.
- `effect`·`@effect/vitest`는 **정확히 `4.0.2`**로 고정한다(`^` 없이). 정식판이 2026-10-01에 나와 패치가 빠르다(스펙 §1.4).
- Zod는 이 계획이 끝나면 `package.json`에 없다(§2.3, §6.2).
- 기존 스키마 오류 문구는 바꾸지 않는다. 기존 테스트가 문구를 검사한다(§6.2).
- 동기 순수 함수는 평범한 함수로 둔다. 실패하거나 의존성이 있는 작업만 Effect(§6.4). 기본은 `Effect.fnUntraced`, 사용자 동작 한 번에 한 번 실행되는 단위는 `Effect.fn('영역/동작')`.
- 보관함 문서는 `LibraryStore.update`로만 쓴다. 화면이 오래된 전체 문서를 저장하는 코드는 없어야 한다(§6.1).
- "저장됨" 표시는 `update` 성공 후에만(§6.1).
- 길이 초과를 조용히 자르지 않는다(§4.6).
- 저장 키: `tripmap:library:v2`, `tripmap:library:v2:corrupt-<ISO>`, `tripmap:prefs`. 옛 `tripmap:edit:<publicId>`는 읽기만(§3).
- 한도: 메모 10,000자(v2), 라벨 이름 1–30자, 옛 편집 레이어 메모 2,000자는 그대로. 길이는 `String.length`(UTF-16 코드 단위)(§3, §4.6).
- ID: PlaceId = 영숫자 소문자 10자, LabelId = 영숫자 소문자 8자(§3).
- 라벨 색 8개(이 순서): `red, orange, yellow, green, teal, blue, purple, pink`. 라벨 아이콘 허용 목록(§5.4, 모두 Lucide 1.2.141에 있음 — 2026-10-08 확인): `utensils, soup, coffee, croissant, beer, wine, ice-cream-cone, fish, beef, salad, waves, mountain, trees, tent, camera, landmark, castle, church, shopping-bag, store, bed, hotel, car, train-front, footprints, baby, dog, music, palette, star, heart, flag`. 새 라벨 기본 아이콘은 `star`.
- 반응형 경계: ≥1280 3단, 768–1279 2단 + 상세 오버레이, <768 하단 탭(§4.1). 터치 대상 최소 44×44px, 하단 바는 `env(safe-area-inset-bottom)`을 더한다.
- 구글·네이버 포인트색(초록 `#03a65a`류, 구글 파랑)을 쓰지 않는다(§5.2).
- `rule_system_fe` 코드는 복사하지 않는다. 패턴만 참고(§6).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **두 탭에서 동시에 편집** — 오래된 상태의 탭 A·B가 각각 다른 장소의 메모를 저장해도 두 메모가 모두 남아야 한다. → Task 7 `LibraryStore` 테스트 "stale tabs keep both edits".
2. **사파리 사생활 보호 모드·localStorage 차단** — 앱이 죽지 않고 메모리 모드 배너가 떠야 한다. → Task 7 테스트 "falls back to memory when storage throws", Task 11 배너 테스트.
3. **저장된 문서가 손상됨(수동 수정·옛 버전)** — 조용히 새 문서로 덮어쓰지 않고 백업 키에 원문을 남긴 뒤 복구 화면. → Task 7 "backs up corrupt document", Task 11 복구 화면 테스트.
4. **메모 입력 중 탭 닫기·뒤로 가기** — 600ms 디바운스 중에 떠나도 저장되어야 한다. → Task 13 "flushes draft on unmount and visibilitychange".
5. **아주 긴 이름·메모, 이모지가 섞인 텍스트** — 카드·목록이 줄바꿈·말줄임으로 깨지지 않고, 자르는 위치의 서로게이트가 깨지지 않는다. → Task 9 서로게이트 경계 테스트, Task 12 "long name and memo do not overflow card" 테스트.

---

## File Structure

```
package.json                              effect·@effect/vitest·lucide·글꼴 추가, zod·mdi 제거(Task 17), effect:source 스크립트
scripts/effect-source.mjs                 .reference/effect 얕은 clone (Task 1)
docs/convention.md                        Effect·보관함 쓰기 규칙 (Task 1)
src/lib/effect/runtime.ts                 AppLayer, ManagedRuntime, startEffect, forkEffect (Task 8)
src/lib/effect/error-reporter.ts          console + 토스트 보고기 (Task 8)
src/lib/effect/atom.ts                    effectAtom (Task 8)
src/schema/parse.ts                       safeParse / parseOrThrow (Task 2)
src/schema/common.ts                      Effect Schema로 이전 (Task 3)
src/schema/{trip-source,trip-data,edit-layer}.ts  Effect Schema로 이전 (Task 3), Task 17에서 src/schema/legacy/로 이동
src/schema/library.ts                     Library v2 (Task 4)
src/schema/prefs.ts                       UI 선호 (Task 7)
src/domain/library/lww.ts                 필드 비교·갱신 (Task 5)
src/domain/library/region.ts              주소 → 지역 (Task 5)
src/domain/library/query.ts               필터·검색·정렬·개수 (Task 5)
src/domain/library/ops.ts                 변경 함수(장소·라벨) (Task 6)
src/domain/library/legacy-import.ts       옛 여행 → 가져오기 계획·적용 (Task 9)
src/services/errors.ts                    태그 오류 (Task 7)
src/services/id-gen.ts                    IdGen (Task 7)
src/services/library-store.ts             LibraryStore (Task 7)
src/services/prefs-store.ts               PrefsStore (Task 7)
src/services/legacy-trip-source.ts        LegacyTripSource (Task 9)
src/stores/library-state.ts               Jotai 상태·동작 훅 (Task 8)
src/stores/library-ui.ts                  focusPlaceAtom 등 화면 간 선택 연동 (Task 15)
src/domain/library/links.ts               네이버 장소·길찾기 링크 (Task 13)
src/theme/tokens/{pastel,paper,night}.ts  토큰 (Task 10)
src/theme/{tokens.ts,create-app-theme.ts,ThemeRoot.tsx,fonts.ts}  (Task 10)
src/components/icons.tsx                  Lucide 아이콘 모음 + LabelIcon (Task 10)
src/sections/shell/*                      AppShell, NavRail, BottomTabs, AddSheet, StorageBanner, CorruptScreen (Task 11)
src/sections/library/*                    LibraryPage, FilterBar, views/{Bento,Cards,Tiles,List}, BulkBar (Task 12)
src/sections/place/*                      PlaceDetail, LabelPicker, MemoEditor (Task 13)
src/sections/labels/*                     LabelsPage, LabelEditor, MergeDialog (Task 14)
src/sections/map/LibraryMap.tsx           (Task 15)
src/sections/settings/*                   SettingsPage, LegacyImportDialog, LegacyImportPage (Task 16)
src/routes/{paths.ts,router.tsx}          새 라우트 (Task 11, 16)
tests/unit/**                             태스크별 테스트
tests/e2e/library.spec.ts                 (Task 18)
```

---

### Task 1: Effect 도입 기반 (의존성·참고 소스·규칙 문서)

근거: §6.4, §6.5, §8(번들 전후 비교).

**Files:**
- Modify: `package.json`, `.gitignore`, `.prettierignore`, `eslint.config.mjs:7`
- Create: `scripts/effect-source.mjs`, `docs/convention.md`, `tests/unit/lib/effect-smoke.test.ts`

**Interfaces:**
- Produces: `yarn effect:source` → `.reference/effect/`(gitignore). `effect`, `@effect/vitest` 사용 가능.

- [ ] **Step 1: 번들 기준선 측정(Zod·MDI 상태)**

Run: `VITE_MAP_ADAPTER=fake yarn build && node scripts/measure-ui-assets.mjs dist/assets > .cache/bundle-before.json`
Expected: `.cache/bundle-before.json`에 JSON(파일별·합계 gzip 바이트). `.cache/`는 이미 gitignore다. Task 17에서 비교한다.

- [ ] **Step 2: 의존성 추가**

Run: `yarn add effect@4.0.2 --exact && yarn add -D @effect/vitest@4.0.2 --exact`
Expected: `package.json`에 `"effect": "4.0.2"`, `"@effect/vitest": "4.0.2"`.

- [ ] **Step 3: 실패하는 스모크 테스트 작성** — `tests/unit/lib/effect-smoke.test.ts`

```ts
import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';

describe('effect 4 smoke', () => {
  it.effect('runs an Effect and decodes a Schema', () =>
    Effect.gen(function* () {
      const n = yield* Schema.decodeUnknownEffect(Schema.Number)(42);
      expect(n).toBe(42);
    }),
  );
});
```

- [ ] **Step 4: 실행 — 통과 확인**

Run: `yarn test tests/unit/lib/effect-smoke.test.ts`
Expected: PASS (의존성이 없었다면 Step 2 이전에는 import 실패).

- [ ] **Step 5: `scripts/effect-source.mjs` 작성**

`package.json`의 `dependencies.effect` 버전을 읽어 `git clone --depth 1 --branch effect@<버전> https://github.com/Effect-TS/effect-smol.git .reference/effect`를 실행한다. 대상 폴더가 있으면 지우고 다시 받는다. `package.json` scripts에 `"effect:source": "node scripts/effect-source.mjs"`.

- [ ] **Step 6: 무시 목록**

`.gitignore`에 `.reference/`, `.prettierignore`에 `.reference`, `eslint.config.mjs` ignores에 `'.reference'` 추가. (`tsconfig.app.json`의 include는 `src, pipeline, tests`뿐이라 수정 불필요.)

- [ ] **Step 7: 스크립트 확인**

Run: `yarn effect:source && ls .reference/effect/packages/effect/src/Schema.ts && git status --short .reference`
Expected: 파일이 있고, git status는 아무것도 출력하지 않는다. (clone이 네트워크 문제로 실패하면 보고하고 다음 단계 진행 — 참고 자료일 뿐이다. `node_modules/effect/ai-docs/`도 같은 용도로 쓸 수 있다.)

- [ ] **Step 8: `docs/convention.md` 작성**

스펙 §6.4의 세 줄 + 다음을 그대로 적는다: "Effect API는 `.reference/effect/`(없으면 `node_modules/effect/ai-docs`, `node_modules/effect/dist/*.d.ts`)로 확인한다. 기억에 의존하지 않는다(v4에서 이름이 바뀐 API가 많다)." / "보관함 문서는 `LibraryStore.update`로만 쓰고, 변경은 `src/domain/library/ops.ts`의 변경 함수로 표현한다."

- [ ] **Step 9: 커밋**

```bash
git add package.json yarn.lock .gitignore .prettierignore eslint.config.mjs scripts/effect-source.mjs docs/convention.md tests/unit/lib/effect-smoke.test.ts
git commit -m "chore: Effect 4.0.2 도입 — 참고 소스 스크립트와 작성 규칙"
```

---

### Task 2: 파싱 도우미 (Zod 호출 모양의 Effect Schema 래퍼)

근거: §6.2. Zod의 `safeParse`/`parse`/`issues` 호출부가 약 20곳이라, 같은 모양의 도우미를 먼저 만든다. **이 태스크는 기존 스키마를 건드리지 않는다**(기존 Zod 스키마와 공존해 중간 상태에서도 타입 검사·테스트가 그대로 통과한다).

**Files:**
- Create: `src/schema/parse.ts`, `tests/unit/schema/parse.test.ts`

**Interfaces:**
- Produces (`src/schema/parse.ts`):
  - `type Issue = { path: string; message: string }` — `path`는 `.`로 이은 경로, 루트는 `''`
  - `type ParseResult<A> = { success: true; data: A } | { success: false; issues: Issue[] }`
  - `type ParseOpts = { onExcessProperty?: 'ignore' | 'error' }` — Effect의 `ParseOptions` 그대로 전달
  - `safeParse<S extends Schema.Top>(schema: S, value: unknown, opts?: ParseOpts): ParseResult<S['Type']>`
  - `parseOrThrow<S extends Schema.Top>(schema: S, value: unknown, opts?: ParseOpts): S['Type']` — 실패 시 `Error(첫 issue의 "path: message")`
  - `is<S>(schema: S, value: unknown): boolean`

- [ ] **Step 1: 실패하는 테스트** — `tests/unit/schema/parse.test.ts`

```ts
const S = Schema.Struct({ a: Schema.Struct({ b: Schema.Number }) });
const Hhmm = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'HH:mm 형식이어야 합니다' }));
it('returns data on success', () => expect(safeParse(S, { a: { b: 1 } })).toEqual({ success: true, data: { a: { b: 1 } } }));
it('flattens nested issue path', () => {
  const r = safeParse(S, { a: { b: 'x' } });
  expect(r.success).toBe(false);
  expect(!r.success && r.issues[0]!.path).toBe('a.b');
});
it('keeps custom filter message', () => {
  expect(safeParse(Hhmm, '24:00')).toEqual({ success: false, issues: [{ path: '', message: 'HH:mm 형식이어야 합니다' }] });
});
it('rejects excess keys only with onExcessProperty error', () => {
  expect(safeParse(S, { a: { b: 1 }, x: 1 }).success).toBe(true);
  expect(safeParse(S, { a: { b: 1 }, x: 1 }, { onExcessProperty: 'error' }).success).toBe(false);
});
it('parseOrThrow throws with path', () => expect(() => parseOrThrow(S, {})).toThrow(/^a:/));
```

- [ ] **Step 2: 실행 — 실패 확인**

Run: `yarn test tests/unit/schema/parse.test.ts` → FAIL (`src/schema/parse` 없음)

- [ ] **Step 3: `parse.ts` 구현**

`Schema.decodeUnknownExit(schema)(value, { errors: 'all', ...opts })` + `SchemaIssue.makeFormatterStandardSchemaV1()`로 `{ path, message }[]`를 만든다. 경로 요소는 `String()`으로 이어 붙인다.

- [ ] **Step 4: 실행 — 통과 확인, 전체 회귀 없음**

Run: `yarn typecheck && yarn test`
Expected: PASS(기존 테스트 수 그대로 + 5).

- [ ] **Step 5: 커밋** — `feat(schema): Effect Schema 파싱 도우미`

---

### Task 3: 스키마 이전 — 공통·여행 원본·여행 데이터·편집 레이어, Zod 제거 (한 검증 단위)

근거: §6.2. `trip-data.ts`·`edit-layer.ts`가 Zod 객체 안에서 `common.ts`의 `Lng`·`Lat`·`PlaceKey`·`IsoDateTime`과 `checkPeriodAndDays(ctx, trip)`를 쓰므로, 공통 모듈만 먼저 바꾸면 중간 상태가 깨진다(리뷰 #15). 그래서 **4개 스키마와 모든 호출부를 이 태스크 하나에서 옮기고, 검증은 마지막에 한 번** 한다. 중간 단계에서 테스트를 지우거나 건너뛰지 않는다.

**Files:**
- Modify: `src/schema/{common,trip-source,trip-data,edit-layer}.ts`, `src/repositories/{trip-repo,edit-layer-repo,import-flow}.ts`, `src/domain/{merge,reconcile}.ts`, `pipeline/{apply-edit,collect,validate,build-places}.ts`, `src/sections/itinerary/view/StopEditPanel.tsx:78`, `src/sections/views/store/ui-preferences.ts`, 스키마를 `.safeParse`/`.parse`로 직접 부르는 테스트, `package.json`(zod 제거)

**Interfaces:**
- Consumes: Task 2의 `safeParse`, `parseOrThrow`, `Issue`, `ParseOpts`.
- Produces: 이름 유지 — `LIMITS`, `IsoDateTime`, `CalendarDate`, `HHmm`, `Lng`, `Lat`, `PlaceKey`, `StopId`, `PublicId`, `TripSourceSchema`, `TripDataSchema`, `EditLayerSchema`, 타입 `TripSource`, `TripData`, `Place`(옛), `EditLayer`, `PlaceEdit`, `DayEdit`. 관계 검증 `checkPeriodAndDays`·`checkUniqueStopIds`는 `(trip) => Schema.FilterIssue[]`로 바꾸고 `Schema.makeFilter` 안에서 부른다. 새 상수 `TRIP_DATA_PARSE: ParseOpts = { onExcessProperty: 'error' }`(`trip-data.ts`), `EDIT_LAYER_PARSE`(같은 값, `edit-layer.ts`). `pipeline/validate.ts`의 `Schema` 구조 타입은 `(v: unknown) => ParseResult<unknown>`을 받는 함수로 바꾼다.

- [ ] **Step 1: 이전 전 기준 기록**

Run: `yarn test 2>&1 | tail -5`
Expected: 통과 테스트 수를 기록한다(Step 6에서 비교).

- [ ] **Step 2: `common.ts` 이전**

각 스키마의 메시지를 `{ message: '<기존 문구>' }`로 그대로 옮긴다(`Schema.String.check(Schema.isPattern(re, { message }))`, `Schema.Number.check(Schema.isBetween({ minimum: 124, maximum: 132 }, { message }))` 등). `IsoDateTime`·`CalendarDate`의 함수형 검사는 `Schema.makeFilter`로. `LIMITS`는 그대로(v2 한도는 Task 4에서 별도 상수).

- [ ] **Step 3: `trip-source.ts`·`trip-data.ts`·`edit-layer.ts` 이전**

`z.object` → `Schema.Struct`, `.optional()` → `Schema.optionalKey`, `.nullable()` → `Schema.NullOr`, `z.record` → `Schema.Record`, `z.tuple` → `Schema.Tuple`, `z.enum`/`z.literal` → `Schema.Literals`/`Schema.Literal`, `discriminatedUnion('mode')` → `Schema.Union([...])`(멤버마다 `mode: Schema.Literal(...)`), `superRefine` → `.check(Schema.makeFilter(...))`(문구 유지), `z.infer` → `typeof X.Type`. `z.strictObject`(Folder·Place·ResetDay)는 `Schema.Struct`로 두고, Effect 4.0.2는 알 수 없는 키를 기본으로 버리며 거부는 디코드 옵션 `onExcessProperty: 'error'`로만 되므로(2026-10-08 `SchemaAST.d.ts` 확인) 이 스키마를 디코드하는 모든 호출부가 `TRIP_DATA_PARSE`·`EDIT_LAYER_PARSE`를 넘긴다. 최상위 객체도 엄격해지는 차이로 기존 fixture·테스트가 깨지면 fixture를 고치지 말고 원인(새는 필드)을 보고한다.

- [ ] **Step 4: 호출부 교체**

`X.safeParse(v)` → `safeParse(X, v[, OPTS])`, `X.parse(v)` → `parseOrThrow(X, v[, OPTS])`, `parsed.error.issues` → `parsed.issues`(`i.path.join('.')` → `i.path`). 테스트 추가(없으면): `tests/unit/schema/trip-data.test.ts`의 `rejects unknown key in folder and place`.

- [ ] **Step 5: Zod 제거**

Run: `yarn remove zod && git grep -n "zod" -- src pipeline tests`
Expected: 출력 없음.

- [ ] **Step 6: 전체 검증**

Run: `yarn lint && yarn typecheck && yarn test && yarn validate`
Expected: 모두 PASS. 통과 테스트 수가 Step 1 기록 이상(새 테스트만큼 증가). 문구가 다르면 스키마 쪽 문구를 기존 값으로 고친다(테스트를 고치지 않는다).

- [ ] **Step 7: 커밋** — `refactor(schema): 옛 스키마 4종을 Effect Schema로 이전하고 Zod 제거`

---

### Task 4: Library v2 스키마

근거: §3 전체.

**Files:**
- Create: `src/schema/library.ts`, `tests/unit/schema/library.test.ts`

**Interfaces:**
- Produces:
  - `LIBRARY_LIMITS = { memoChars: 10_000, labelNameChars: 30, libraryChars: 4_000_000 } as const` (`libraryChars` = 직렬화 JSON의 `String.length` 상한, 이 계획에서 정함)
  - `PlaceId`(`/^[a-z0-9]{10}$/`), `LabelId`(`/^[a-z0-9]{8}$/`), `LabelColor`(8개 리터럴), `LabelIcon`(허용 목록 리터럴), `LABEL_COLORS`, `LABEL_ICONS`(배열, Global Constraints 순서)
  - `FieldSchema(schema)` → `Schema.Struct({ value: schema, updatedAt: IsoDateTime })`
  - `PlaceSource = Union[{ kind: 'naver', sid: /^\d+$/ }, { kind: 'pin', legacy?: { publicId: PublicId, placeKey: PlaceKey } }]`
  - `PlaceSchema`, `LabelSchema`, `LibrarySchema`; 타입 `Place`, `Label`, `Library`, `PlaceSource`
  - `normalizeLabelName(name: string): string` — `trim` → 연속 공백을 하나로 → `toLocaleLowerCase('ko-KR')`
  - `emptyLibrary(): Library` — `{ schemaVersion: 2, places: {}, labels: {}, trips: {} }`
- `trips`는 `Schema.Record(Schema.String, Schema.Never)`(빈 객체만 허용).

- [ ] **Step 1: 실패하는 테스트**

테스트 이름과 단언:
- `accepts a minimal valid library` — `emptyLibrary()`와 장소 1·라벨 1인 문서가 `safeParse` 성공.
- `rejects duplicate live naver sid` — 같은 `sid`의 살아 있는 장소 2개 → 실패, 메시지 `네이버 장소가 중복됩니다: <sid>`. 하나가 `deletedAt`이면 성공.
- `rejects duplicate live legacy pin` — 같은 `publicId`+`placeKey` → 실패, 메시지 `옛 사용자 지정 장소가 중복됩니다: <publicId>/<placeKey>`. `legacy` 없는 핀 2개(같은 좌표) → 성공.
- `rejects duplicate live label name ignoring case and spaces` — `'맛집'`과 `' 맛집 '`, `'Cafe'`와 `'cafe'` → 실패, 메시지 `라벨 이름이 중복됩니다: <이름>`.
- `rejects labelIds pointing to missing or deleted label` — 메시지 `없는 라벨입니다: <labelId>`.
- `enforces memo 10000 and label name 1..30` — 10,000자 메모 성공, 10,001자 실패. 라벨 이름 `''`·31자 실패, 30자 성공.
- `rejects non-empty trips` — `trips: { x: {} }` 실패.
- `normalizeLabelName` — `'  Cafe   Latte '` → `'cafe latte'`.

- [ ] **Step 2: 실행 — 실패 확인** (`yarn test tests/unit/schema/library.test.ts` → FAIL)

- [ ] **Step 3: `library.ts` 구현** — 불변식은 `LibrarySchema.check(Schema.makeFilter(...))` 하나에서 위 순서로 검사하고 issue마다 `path`를 붙인다(`['places', id]`, `['labels', id]`).

- [ ] **Step 4: 실행 — 통과 확인**

- [ ] **Step 5: 커밋** — `feat(schema): Library v2 스키마`

---

### Task 5: 조회 도메인 — LWW·지역·필터·검색·정렬

근거: §3 규칙(LWW), §4.2.

**Files:**
- Create: `src/domain/library/{lww,region,query}.ts`, `tests/unit/domain/library/{lww,region,query}.test.ts`

**Interfaces:**
- Produces:
  - `lww.ts`: `type Field<T> = { value: T; updatedAt: string }`(이 타입은 `lww.ts`에만 둔다. `library.ts`의 스키마 함수 이름은 `FieldSchema`); `pickField<T>(a: Field<T>, b: Field<T>): Field<T>` — `updatedAt` 큰 쪽, 같으면 `JSON.stringify(value)`가 사전순으로 큰 쪽(순서 무관). `setField<T>(f: Field<T>, value: T, now: string): Field<T>` — 값이 같으면 `f` 그대로 반환(불필요한 갱신 방지).
  - `region.ts`: `regionOf(address: string): string`
  - `query.ts`:
    - `type LibraryQuery = { labelIds: string[]; mode: 'any' | 'all'; unlabeled: boolean; regions: string[]; text: string; sort: 'recent' | 'name' | 'label' }`
    - `DEFAULT_QUERY: LibraryQuery` (`labelIds: [], mode: 'any', unlabeled: false, regions: [], text: '', sort: 'recent'`)
    - `livePlaces(lib): Place[]` — `deletedAt === null && saved.value === true`
    - `liveLabels(lib): Label[]` — `deletedAt === null`, `order.value` 오름차순
    - `queryPlaces(lib: Library, q: LibraryQuery): Place[]`
    - `labelCounts(lib, q): Map<string | 'unlabeled', number>` — 라벨 칩 숫자(텍스트·지역 필터를 적용한 뒤, 라벨 필터는 빼고 센다)
    - `regionCounts(lib, q): Array<{ region: string; count: number }>` — 개수 내림차순, 같으면 이름순, `기타`는 마지막

- [ ] **Step 1: 실패하는 테스트**

`region.test.ts` 표 테스트(입력 → 기대):
| 주소 | 지역 |
|---|---|
| `강원특별자치도 강릉시 난설헌로 131` | `강릉` |
| `강원도 양양군 현남면 인구길 1` | `양양` |
| `제주특별자치도 서귀포시 성산읍` | `서귀포` |
| `서울특별시 강남구 강남대로 396` | `서울` |
| `부산광역시 해운대구 우동` | `부산` |
| `세종특별자치시 한누리대로 2130` | `세종` |
| `경기도 수원시 영통구 광교로` | `수원` |
| `''` / `Seoul` / `123` | `기타` |

규칙: 첫 토큰이 `특별시|광역시|특별자치시`로 끝나면 그 접미사를 뗀 첫 토큰, 아니면 두 번째 토큰에서 `시|군`을 뗀 값, 둘 다 아니면 `기타`.

`query.test.ts`:
- `any mode returns places with at least one selected label`, `all mode returns places with every selected label`
- `unlabeled returns only places without labels` — `unlabeled: true`면 `labelIds`는 무시한다(화면에서 둘은 서로 배타).
- `regions OR together and AND with labels`
- `text matches name, address, memo and label names case-insensitively` — 메모의 `오픈런`, 라벨 이름 `TV맛집`을 `tv맛`으로.
- `hides deleted and unsaved places`
- `sort recent/name/label` — `label`은 첫 라벨의 `order` 다음 이름, 라벨 없음은 마지막. `name`은 `localeCompare(_, 'ko')`.
- `labelCounts ignores label filter but applies text and region`

`lww.test.ts`: `pickField is commutative on ties`, `setField keeps identity when value unchanged`.

- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인** (`yarn test tests/unit/domain/library`)

- [ ] **Step 5: 커밋** — `feat(domain): 보관함 조회(필터·지역·검색·정렬)와 LWW`

---

### Task 6: 변경 함수 — 장소·라벨

근거: §3 규칙, §4.3, §4.4, §4.2 일괄 편집. 모든 화면 동작은 이 함수들로만 문서를 바꾼다(§6.1).

**Files:**
- Create: `src/domain/library/ops.ts`, `tests/unit/domain/library/ops.test.ts`

**Interfaces:**
- Consumes: Task 4 타입·`normalizeLabelName`·`LABEL_COLORS`, Task 5 `setField`.
- Produces: 모든 함수는 `(lib: Library, ...args, ctx: OpCtx) => Library` 또는 `OpResult`. 입력을 바꾸지 않는다.
  - `type OpCtx = { now: string; newId: (kind: 'place' | 'label') => string }`
  - `type OpError = { _tag: 'LabelNameTaken'; name: string } | { _tag: 'LabelNameInvalid'; name: string } | { _tag: 'NotFound'; id: string }`
  - `type OpResult = { ok: true; lib: Library; createdId?: string } | { ok: false; error: OpError }`
  - 장소: `setPlaceName(lib, placeId, name, ctx)`, `setPlaceCategory(lib, placeId, category: string | null, ctx)`, `setPlaceMemo(lib, placeId, memo, ctx)`, `toggleLabel(lib, placeId, labelId, ctx)`, `addLabels(lib, placeIds: string[], labelIds: string[], ctx)`, `removeLabels(lib, placeIds, labelIds, ctx)`, `deletePlaces(lib, placeIds, ctx)`, `restorePlaces(lib, placeIds, ctx)` — 이것들은 `Library`를 반환(없는 id는 건너뜀).
  - 라벨: `createLabel(lib, name, ctx): OpResult` — 색은 `LABEL_COLORS[살아 있는 라벨 수 % 8]`, 아이콘 `star`, `order`는 최대값+1. `renameLabel(lib, labelId, name, ctx): OpResult`, `setLabelColor`, `setLabelIcon`, `reorderLabels(lib, orderedIds: string[], ctx): Library`, `deleteLabel(lib, labelId, ctx): Library`, `mergeLabels(lib, fromId, intoId, ctx): Library`, `createAndAttachLabel(lib, placeId, name, ctx): OpResult` — 같은 이름(정규화)의 살아 있는 라벨이 있으면 그 라벨을 붙인다.

- [ ] **Step 1: 실패하는 테스트**
- `setPlaceMemo updates only memo field timestamp` — 다른 필드 `updatedAt` 불변.
- `setPlaceMemo is a no-op when unchanged` — 결과의 `places[id]`가 입력과 `===`.
- `toggleLabel appends to end and removes`
- `createLabel rejects taken name ignoring case/spaces` → `{ ok: false, error: { _tag: 'LabelNameTaken' } }`; `''`·31자 → `LabelNameInvalid`.
- `createLabel picks palette color by live label count`
- `deleteLabel tombstones label and removes it from every place with new updatedAt; places stay`
- `mergeLabels attaches into-label once and deletes from-label` — 두 라벨이 모두 붙은 장소는 `into` 하나만.
- `deletePlaces then restorePlaces round-trips deletedAt`
- `addLabels/removeLabels apply to many places`
- `createAndAttachLabel reuses existing normalized label`
- `every op result passes LibrarySchema` — 각 테스트 끝에 `safeParse(LibrarySchema, result).success`.

- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 5: 커밋** — `feat(domain): 장소·라벨 변경 함수`

---

### Task 7: 서비스 — 오류·IdGen·PrefsStore·LibraryStore

근거: §3 저장 키, §6.1 서비스 표와 `update` 계약, §6.3.

**Files:**
- Create: `src/services/{errors,id-gen,prefs-store,library-store}.ts`, `src/schema/prefs.ts`, `tests/unit/services/{library-store,prefs-store}.test.ts`
- Reference(재사용): `src/repositories/edit-layer-repo.ts`의 `isStorageAvailable`, `createMemoryStorage`

**Interfaces:**
- `errors.ts` (`Schema.TaggedError`):
  - `StorageUnavailable`, `StorageQuotaExceeded { bytes: number }`, `LibraryCorrupt { backupKey: string; issues: Issue[] }`, `LibraryInvalid { issues: Issue[] }`, `LegacyImportInvalid { message: string }`, `LegacyImportStale`, `LabelNameTaken { name: string }`
  - 각 클래스에 `userMessage: string` getter(토스트·화면 문구). 문구: `StorageQuotaExceeded` → `저장 공간이 부족해 저장하지 못했어요`, `LibraryInvalid` → `저장하지 못했어요(데이터 검증 실패)`, `LabelNameTaken` → `같은 이름의 라벨이 있어요`, `LegacyImportStale` → `보관함이 바뀌어 미리보기를 다시 계산했어요`.
- `id-gen.ts`: `class IdGen extends Context.Service<IdGen, { next(kind: 'place' | 'label'): string }>()('tripmap/IdGen')`; `IdGen.layer`(`crypto.getRandomValues`로 영숫자 소문자 10/8자), `IdGen.layerSequence(ids: string[])`(테스트용, 순서대로 반환).
- `prefs.ts`: `PrefsSchema = { theme: 'pastel'|'paper'|'night', mode: 'system'|'light'|'dark', libraryView: 'bento'|'cards'|'tiles'|'list', query: LibraryQuery }`, `DEFAULT_PREFS`(`pastel`, `system`, `bento`, `DEFAULT_QUERY`).
- `prefs-store.ts`: `PrefsStore` 서비스 `{ get: Effect<Prefs>; set(p: Prefs): Effect<void> }` — 읽기 실패·검증 실패면 `DEFAULT_PREFS`(오류 아님), 쓰기 실패는 무시하고 콘솔 경고(선호는 잃어도 되는 데이터).
- `library-store.ts`:
  - `class LibraryStore extends Context.Service<LibraryStore, { load: Effect<LoadResult, LibraryCorrupt>; update<E>(f: (current: Library) => Effect<Library, E>): Effect<Library, E | StorageQuotaExceeded | LibraryInvalid | LibraryCorrupt>; changes: Stream<Library>; resetWithBackup: Effect<Library> }>()('tripmap/LibraryStore')`
  - `type LoadResult = { library: Library; persistence: 'local' | 'memory' }`
  - `LibraryStore.layer` — `globalThis.localStorage`(사용 불가면 메모리 + `persistence: 'memory'`), `navigator.locks`(없으면 잠금 없이 같은 순서), `window` `storage` 이벤트로 `changes`
  - `LibraryStore.layerWith({ storage: Storage; locks?: LockManager; events?: EventTarget })` — 테스트용
  - 저장 키·잠금 이름 상수: `LIBRARY_KEY = 'tripmap:library:v2'`, `LIBRARY_LOCK = 'tripmap:library:v2'`, `corruptKey(iso) = 'tripmap:library:v2:corrupt-' + iso`

`update` 순서(§6.1 그대로): 잠금 → 저장소에서 최신본을 다시 읽어 검증(키가 없으면 `emptyLibrary()`, 손상이면 `LibraryCorrupt` — 쓰지 않음) → `f` → `LibrarySchema` 검증(실패 `LibraryInvalid`) → 직렬화 길이가 `LIBRARY_LIMITS.libraryChars` 초과면 `StorageQuotaExceeded` → `setItem`(예외가 `QuotaExceededError`면 `StorageQuotaExceeded`) → 잠금 해제 후 반환. 실패한 경우 저장소는 바뀌지 않는다.

`load`: 키 없음 → `emptyLibrary()`(쓰지 않음). JSON 파싱·검증 실패 → 원문을 `corruptKey(now)`에 복사하고 `LibraryCorrupt` 실패(원래 키는 지우지 않음). `resetWithBackup`: 손상된 원래 키를 `emptyLibrary()`로 덮어쓴다(백업은 `load`에서 이미 남김).

- [ ] **Step 1: 실패하는 테스트** — `tests/unit/services/library-store.test.ts` (`@effect/vitest`, jsdom localStorage와 `createMemoryStorage()`, `tests/fixtures/fake-locks.ts` 재사용)
- `load returns empty library without writing when key missing`
- `backs up corrupt document and fails with LibraryCorrupt` — `setItem(LIBRARY_KEY, '{bad')` → `load` 실패 태그 `LibraryCorrupt`, `corrupt-` 키에 `'{bad'`, 원래 키 그대로.
- `falls back to memory when storage throws` — `setItem`이 항상 throw하는 Storage → `load`의 `persistence === 'memory'`, 이후 `update` 성공.
- `update re-reads latest inside lock` — 저장소를 직접 바꾼 뒤 `update(identity)` 결과가 직접 바꾼 값.
- `stale tabs keep both edits` — 같은 저장소에 두 `LibraryStore`(탭 A·B)를 만들고, 둘 다 `load` 후 A는 `setPlaceMemo(p1)`, B는 `setPlaceMemo(p2)`를 `update`로 적용 → 저장소 최종본에 두 메모가 모두 있다.
- `invalid result writes nothing` — `f`가 중복 sid 문서를 반환 → `LibraryInvalid`, 저장소 원문 그대로.
- `quota error maps to StorageQuotaExceeded and writes nothing` — `setItem`이 `DOMException('', 'QuotaExceededError')` throw.
- `size limit rejects before writing` — `libraryChars` 초과 메모로 문서 키움(테스트에서 한도를 낮추는 `layerWith({ limits })` 옵션 허용).
- `changes emits on storage event for LIBRARY_KEY only`
- `prefs-store.test.ts`: `returns defaults on invalid json`, `round-trips prefs`.

- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 5: 커밋** — `feat(services): LibraryStore update 계약·손상 백업·메모리 대체, PrefsStore, IdGen`

---

### Task 8: 런타임·오류 보고·Jotai 연결

근거: §6.1(runtime, error-reporter, atom), §6.3 화면 처리, §6.1 dirty 초안.

**Files:**
- Create: `src/lib/effect/{runtime,error-reporter,atom}.ts`, `src/stores/library-state.ts`, `tests/unit/stores/library-state.test.tsx`

**Interfaces:**
- `runtime.ts`: `AppLayer = Layer.mergeAll(LibraryStore.layer, PrefsStore.layer, IdGen.layer, LegacyTripSource.layer)` — `LegacyTripSource`는 Task 9에서 추가하므로 이 태스크에서는 앞의 셋. `appRuntime = ManagedRuntime.make(AppLayer)`. `startEffect<A, E>(eff: Effect<A, E, AppServices>): Promise<A>`, `forkEffect(eff): void`(처리되지 않은 실패는 `withErrorReporting`으로 보고). 테스트에서 런타임을 바꾸는 `setAppRuntimeForTest(runtime)`.
- `error-reporter.ts`: `ErrorReporter.make`로 `console.error(cause)`, 실패 값에 `userMessage`가 있으면 `toast.error(userMessage)`.
- `atom.ts`: `effectAtom<A, E>(read: (get) => Effect<A, E, AppServices>)` — `atom(async get => startEffect(read(get)))`.
- `library-state.ts`:
  - `libraryLoadAtom` — `effectAtom(LibraryStore.load)` 결과(`LoadResult`) 또는 오류
  - `libraryAtom: PrimitiveAtom<Library>` — 로드 후 채움, `changes` 구독으로 갱신
  - `persistenceAtom: Atom<'local' | 'memory'>`
  - `useLibraryAction()` → `run(op: (lib: Library, ctx: OpCtx) => Library | OpResult): Promise<{ ok: true } | { ok: false; error: unknown }>` — `LibraryStore.update` 안에서 `ctx = { now: new Date(yield* Clock.currentTimeMillis).toISOString(), newId: IdGen.next }`로(시각은 Effect `Clock`에서 — 스펙 §6.1, 테스트는 `TestClock`) `op`를 실행하고, 성공하면 `libraryAtom`을 결과로 설정한다. `OpResult`의 `ok: false`는 `update`를 실패시켜 저장하지 않는다.
  - `useDraft<T>(key: string, saved: T)` → `{ value, setValue, dirty, status: 'idle' | 'saving' | 'saved' | 'error', commit(save: (v: T) => Promise<{ ok: boolean }>): Promise<void> }` — dirty면 `saved` 변경(다른 탭)을 화면 값에 반영하지 않고 `remoteChanged: true`를 노출.

- [ ] **Step 1: 실패하는 테스트** (`library-state.test.tsx`, 메모리 Layer 런타임 주입)
- `action updates atom only after store succeeds` — 실패하는 op(`LabelNameTaken`) 후 atom 불변, 결과 `ok: false`.
- `storage change event refreshes libraryAtom`
- `dirty draft is not overwritten by remote change and exposes remoteChanged`
- `draft status becomes saved only after successful commit; stays dirty with error on failure`
- `unhandled forked failure with userMessage shows toast` (sonner `toast.error` spy)

- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 5: 커밋** — `feat(effect): 앱 런타임·오류 보고·보관함 Jotai 상태`

---

### Task 9: 옛 여행 가져오기 — 계획·적용 도메인과 LegacyTripSource

근거: §4.6 전체(r3), §3 중복 규칙.

**Files:**
- Create: `src/domain/library/legacy-import.ts`, `src/services/legacy-trip-source.ts`, `tests/unit/domain/library/legacy-import.test.ts`, `tests/unit/services/legacy-trip-source.test.ts`
- Modify: `src/lib/effect/runtime.ts`(AppLayer에 추가)

**Interfaces:**
- Consumes: `TripData`, `EditLayer`(옛 스키마), `effectiveCategory`(`src/domain/place-category.ts`), Task 4·6.
- Produces (`legacy-import.ts`, 모두 순수 함수):
  - `type LegacySource = { trip: TripData; edit: EditLayer | null }`
  - `type LabelDecision = { kind: 'use'; name: string } | { kind: 'exclude' }` — 키는 옛 라벨 출처 `folder:<folderId>` 또는 `tag:<원문 태그>`
  - `type MemoDecision = 'truncate' | 'exclude-place'` — 키는 옛 `placeKey`
  - `type ImportChoices = { labels: Record<string, LabelDecision>; memos: Record<string, MemoDecision> }`
  - `type PlannedIds = { places: Record<string /*placeKey*/, string>; labels: Record<string /*정규화 이름*/, string>; now: string }`
  - `type ImportPlan = { ids: PlannedIds; places: PlannedPlace[]; labels: PlannedLabel[]; pending: PendingDecision[]; summary: { added: number; existing: number; newLabels: number; needsDecision: number } }`
  - `PlannedPlace = { placeKey; action: 'add' | 'merge' | 'exclude'; targetPlaceId: string; labelNames: string[] /*정규화*/; memo: string; category: string | null; fullMemo: string }`
  - `PlannedLabel = { normalizedName; displayName; action: 'create' | 'reuse'; labelId }`
  - `PendingDecision = { kind: 'label-name'; key; suggested: string; reason: 'empty' | 'too-long' } | { kind: 'memo-too-long'; placeKey; placeName; length: number }`
  - `planLegacyImport(lib: Library, src: LegacySource, choices: ImportChoices, ids: PlannedIds | null, newId: (k) => string): ImportPlan` — `ids`가 null이면 새로 만들고, 있으면 재사용(새로 필요한 ID가 생기면 `newId`로 만들되 그 사실이 의미상 차이가 된다)
  - `semanticKey(plan: ImportPlan): string` — `ids`의 생성값·`now`를 빼고 §4.6 r3 비교 대상만 정렬해 직렬화
  - `applyImportPlan(lib: Library, plan: ImportPlan): Library` — `pending`이 남아 있으면 throw(호출 측 버그)
  - `combineMemos(src, placeKey): string`, `truncateMemo(text: string, limit = 10_000): string`
  - 상수 `TRUNCATION_MARK = '…(원문 일부 생략)'`
- `legacy-trip-source.ts`: `LegacyTripSource` 서비스 `{ fromFile(file: File): Effect<LegacySource, LegacyImportInvalid>; fromPublicId(id: string): Effect<LegacySource, LegacyImportInvalid> }` — `fetch('/data/<id>.json')` + `safeParse(TripDataSchema)`, 같은 브라우저의 `tripmap:edit:<id>`를 **부작용 없는 전용 경로**로 읽는다: `getItem` → `JSON.parse` → `migrateEditLayer`(`src/repositories/edit-layer-repo.ts`에서 export됨, 순수 함수) → `safeParse(EditLayerSchema, _, EDIT_LAYER_PARSE)`. 키가 없거나, 파싱·검증 실패이거나, `schemaVersion > 1`이면 `edit: null`이고 **원문은 그대로 둔다**. 기존 `readEditLayer`는 무효 원문을 백업하고 원래 키를 지우므로 쓰지 않는다(리뷰 #15, 스펙 §3 "옛 키는 읽기만").

**적용 흐름(화면 Task 16이 사용):** 미리보기 = `planLegacyImport(현재 lib, src, choices, null)` → 사용자가 `pending`을 모두 정함 → 적용 = `update(latest => { const p = planLegacyImport(latest, src, choices, preview.ids); if (semanticKey(p) !== semanticKey(preview)) fail(LegacyImportStale); return applyImportPlan(latest, p) })`.

- [ ] **Step 1: 실패하는 테스트** (`legacy-import.test.ts`, `tests/fixtures/builders.ts`로 TripData 생성)
- `naver place becomes naver source; custom place becomes pin with legacy ref`
- `existing naver sid merges labels only, keeps name/category/memo`
- `existing legacy pin merges labels only`
- `reimporting same file twice creates no duplicates` (네이버·핀 모두; 두 번째 `summary.added === 0`)
- `folder name and tag become labels; reuses existing label by normalized name`
- `category uses effective category: edited string wins, null edit restores original`
- `memo: skips empty and null(deleted), dedupes identical, single memo has no header, multiple get [네이버 · 폴더] / [닉네임] headers separated by blank line`
- `label name empty-after-trim or >30 creates pending decision and blocks apply` — `applyImportPlan` throw.
- `label exclude keeps place without that label`
- `memo over 10000 creates pending; truncate yields length <= 10000 ending with TRUNCATION_MARK` — 입력 `'가'.repeat(10_001)` → 길이 정확히 `10_000`.
- `truncate does not split surrogate pair` — 본문 절단점은 `10_000 - 11 = 9_989`. 두 입력(각 10,001자 이상): (a) `'😀'`가 인덱스 `9_988`에서 시작(쌍이 절단점에 걸침) → 한 단위 앞에서 잘라 최종 길이 **`9_999`**, (b) `'😀'`가 인덱스 `9_989`에서 시작(쌍 전체가 절단점 뒤) → 보정 없음, 최종 길이 **`10_000`**. 두 경우 모두 결과에 고립 서로게이트가 없다(`/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/` 불일치).
- `memo exclude-place excludes the place`
- `semanticKey equal for unchanged library with reused ids` — 같은 lib·src·choices·ids로 두 번 계획 → 같은 key, `applyImportPlan` 성공.
- `semanticKey differs when another tab added a label with same name` — 미리보기 후 lib에 같은 이름 라벨 생성 → 재계획 key 다름.
- `imported places are saved: true and result passes LibrarySchema`
- `days are not imported` — 결과 `trips`는 `{}`.

- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 5: `LegacyTripSource` 테스트·구현** — `rejects invalid json with LegacyImportInvalid`, `reads edit layer of same publicId when present`(jsdom localStorage), `corrupt or future-version edit layer yields edit null and leaves storage untouched` — 손상 JSON과 `schemaVersion: 2` 두 경우, `setItem`·`removeItem` spy 호출 0회, 원래 키 원문 그대로, `fetch 404 → LegacyImportInvalid('여행 데이터를 찾지 못했어요')`.

- [ ] **Step 6: 커밋** — `feat(import): 옛 여행 가져오기 계획·적용(길이 초과 결정, 재계산 비교)`

---

### Task 10: 디자인 시스템 — 토큰·테마·글꼴·아이콘

근거: §5 전체, §4.7(테마 전환).

**Files:**
- Create: `src/theme/tokens/{pastel,paper,night}.ts`, `src/theme/tokens.ts`, `src/theme/create-app-theme.ts`, `src/theme/ThemeRoot.tsx`, `src/theme/fonts.ts`, `src/components/icons.tsx`, `tests/unit/theme/tokens.test.ts`, `tests/unit/theme/theme-root.test.tsx`
- Modify: `package.json`(`@iconify-json/lucide`, `pretendard`, `@fontsource/gowun-batang`), `src/app.tsx`(`theme` → `ThemeRoot`)

**Interfaces:**
- `tokens.ts`: `type Tokens = { bg: { base; surface; raised }; text: { primary; secondary; muted }; border; accent: { main; contrast }; label: Record<LabelColor, { fill; text; marker }>; radius: { sm; md; lg; xl }; shadow: { 1; 2 }; font: { body: string; display: string } }`; `type ThemeName = 'pastel' | 'paper' | 'night'`; `TOKENS: Record<ThemeName, { light: Tokens; dark: Tokens }>`.
- 값의 출처: 브레인스토밍 시안(`.superpowers/brainstorm/*/content/visual-style.html`). 파스텔 라이트: bg `#FAFAF7`, text `#18181B`, accent `#18181B`/contrast `#D9F99D`. 수첩 라이트: bg `#F6F1E7`, text `#2B2620`, accent `#C2492D`. 나이트 다크: bg `#0E1324`, text `#E8ECF8`, accent 그라데이션 시작 `#7C5CFF`. 나머지(각 테마의 반대 모드 포함)는 같은 인상으로 실행자가 정한다.
- `create-app-theme.ts`: `createAppTheme(name: ThemeName, mode: 'light' | 'dark'): Theme` — MUI 팔레트·shape·typography를 토큰에서, `cssVarsOf(tokens): Record<string, string>`(`--tm-bg-base` 등).
- `ThemeRoot.tsx`: `PrefsStore`의 `theme`·`mode`(system이면 `matchMedia('(prefers-color-scheme: dark)')` 구독)로 테마를 만들고 `<html data-theme=<name> data-mode=<light|dark>>`와 CSS 변수를 설정. `paper`일 때만 `fonts.ts`의 `loadDisplayFont()`(고운바탕 동적 import).
- `fonts.ts`: `import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'`(본문, 항상), `loadDisplayFont(): Promise<void>`.
- `icons.tsx`: 앱에서 쓰는 Lucide 아이콘을 `~icons/lucide/<name>`으로 import해 이름 붙여 내보낸다(`HomeIcon`(house), `MapIcon`, `RouteIcon`, `PlusIcon`, `SettingsIcon`, `SearchIcon`, `LinkIcon`, `MapPinIcon`, `FolderInputIcon`, `TagsIcon`, `TrashIcon`(trash-2), `UndoIcon`(undo-2), `GripIcon`(grip-vertical), `ExternalLinkIcon`, `NavigationIcon`, `XIcon`, `CheckIcon`, `ChevronLeftIcon`, 보기 아이콘 `LayoutDashboardIcon`, `RowsIcon`(rows-3), `LayoutGridIcon`, `ListIcon`, `SunIcon`, `MoonIcon`, `MonitorIcon`). `LabelGlyph({ name: LabelIcon, size?: number })` — 허용 목록 32개를 정적 import 맵으로(`LabelIcon`은 Task 4의 타입 이름이라 컴포넌트는 `LabelGlyph`).

- [ ] **Step 1: 실패하는 테스트**
- `tokens.test.ts`: `every theme and mode defines all token keys`(키 집합 비교), `label palette has 8 colors in each theme/mode`, `no Naver/Google accent` — 모든 `accent.main`이 `#03a65a`, `#1a73e8`, `#4285f4`가 아님(대소문자 무시), `text.primary on bg.base contrast >= 4.5`(WCAG 대비 계산 함수를 테스트 안에 둔다).
- `theme-root.test.tsx`: `applies data-theme and css vars from prefs`, `system mode follows prefers-color-scheme change`, `loads display font only for paper`.
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: 커밋** — `feat(theme): 테마 3종 토큰·Lucide 아이콘·글꼴`

---

### Task 11: 앱 뼈대 — 라우트·반응형 셸·추가 시트·저장소 배너·복구 화면

근거: §4.1, §4.7 경로, §6.3 화면.

**Files:**
- Create: `src/sections/shell/{AppShell,NavRail,BottomTabs,AddSheet,StorageBanner,CorruptScreen,TripsPlaceholder}.tsx`, `src/sections/shell/use-layout.ts`, `tests/unit/sections/shell/*.test.tsx`
- Modify: `src/routes/paths.ts`, `src/routes/router.tsx`, `src/app.tsx`

**Interfaces:**
- `paths`: `library: '/'`, `map: '/map'`, `place: (id) => '/place/' + id`, `labels: '/labels'`, `settings: '/settings'`, `trips: '/trips'`, `legacyTrip: (id) => '/t/' + id`. 이 태스크에서 `/t/:publicId`는 기존 `TripPage`를 그대로 둔다(Task 16에서 교체).
- `use-layout.ts`: `useLayout(): 'wide' | 'medium' | 'compact'` — `useMediaQuery('(min-width:1280px)')`, `'(min-width:768px)'`.
- `AppShell`: `wide` = `NavRail | <Outlet name=list> | <MapSlot> | <DetailSlot>`, `medium` = `NavRail | list | map` + 상세 오버레이(지도 위 오른쪽, 폭 360px), `compact` = 콘텐츠 + `BottomTabs`. 라우트 구조: `/`·`/place/:id`·`/map`이 같은 셸 안에서 목록·지도·상세 슬롯을 채운다(`/place/:id`는 wide/medium에서 상세 슬롯, compact에서 전체 화면 시트). 지도·목록 슬롯의 내용은 Task 12·13·15가 채운다 — 이 태스크에서는 자리 컴포넌트.
- `BottomTabs`: 5개(보관함·지도·＋·여행·설정), 가운데 ＋는 `AddSheet`를 연다. 높이 `56px + env(safe-area-inset-bottom)`.
- `AddSheet`: 링크 붙여넣기·지도에서 핀 찍기·네이버 폴더 가져오기 — 모두 비활성 + 보조 문구 `곧 제공돼요`.
- `StorageBanner`: `persistenceAtom === 'memory'`면 `이 브라우저에 저장할 수 없어 새로고침하면 사라져요`.
- `CorruptScreen`: `LibraryCorrupt`일 때 전체 화면. 문구 `데이터를 읽지 못했어요`, 버튼 `백업 파일 받기`(백업 키 원문을 `tripmap-backup-<ISO>.json`으로 다운로드), `새로 시작`(`resetWithBackup`).
- `TripsPlaceholder`: `/trips` — `여행 계획은 곧 제공돼요`.

- [ ] **Step 1: 실패하는 테스트**
- `renders bottom tabs below 768 and rail at 768+` (matchMedia mock)
- `wide layout shows list, map and detail slots side by side at 1280`
- `medium layout overlays detail over map`
- `add sheet lists three disabled options with 곧 제공돼요`
- `shows storage banner in memory mode`
- `corrupt screen offers backup download and reset` — 다운로드는 `URL.createObjectURL` spy, reset 후 보관함 화면.
- `bottom tab targets are at least 44px` (computed style)
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: 커밋** — `feat(shell): 반응형 뼈대·하단 탭·추가 시트·복구 화면`

---

### Task 12: 보관함 화면 — 필터·보기 4종·일괄 편집

근거: §4.2, §5.2.

**Files:**
- Create: `src/sections/library/{LibraryPage,FilterBar,RegionChips,SortMenu,ViewSwitcher,BulkBar,PlaceRow,PlaceCard}.tsx`, `src/sections/library/views/{BentoView,CardsView,TilesView,ListView}.tsx`, `src/sections/library/use-library-query.ts`, `tests/unit/sections/library/*.test.tsx`

**Interfaces:**
- Consumes: Task 5 `queryPlaces`, `labelCounts`, `regionCounts`, `DEFAULT_QUERY`; Task 8 `libraryAtom`, `useLibraryAction`; Task 7 `PrefsStore`(`query`, `libraryView` 저장); Task 6 `addLabels`, `removeLabels`, `deletePlaces`, `restorePlaces`.
- `use-library-query.ts`: `useLibraryQuery(): [LibraryQuery, (patch: Partial<LibraryQuery>) => void]` — 변경을 `PrefsStore`에 저장(300ms 디바운스).
- 동작 규칙:
  - 라벨 칩 여러 개 선택. `모두 포함` 토글이 `mode`를 `all`로. `미분류` 칩을 고르면 라벨 선택을 비우고, 라벨 칩을 고르면 `미분류`를 끈다.
  - 지역 칩은 `regionCounts` 순서, 여러 개 선택(OR).
  - 검색창 placeholder `이름·주소·메모·라벨 검색`.
  - 보기: 벤토(기본) — 라벨 블록, 블록 크기는 개수 1위 라벨이 2행을 차지하고 나머지 1행, 마지막에 `미분류` 블록. 블록을 누르면 `labelIds: [그 라벨]`로 바꾸고 카드 보기가 아니라 **현재 보기를 유지한 목록 모드**로 전환한다(벤토·타일은 "라벨 개요" 보기이므로, 라벨을 고르면 그 아래에 장소 목록을 `ListView`로 보여 준다). 카드 — 이름 아래 메모 3줄(말줄임), 라벨 칩. 타일 — 라벨 2열 타일. 목록 — 한 줄 행(이름·지역·첫 라벨 점).
  - 장소 목록은 `@tanstack/react-virtual` 가상화(기존 `VirtualPlaceRows`의 구조를 참고하되 새 컴포넌트).
  - 일괄 편집: 행을 Shift/Cmd(Ctrl)+클릭하거나 길게 누르면(500ms) 선택 모드. `BulkBar`에 `라벨 붙이기`, `라벨 떼기`, `삭제`, 선택 수. 삭제 후 토스트 `N곳을 지웠어요` + `되돌리기`(5초).
  - 장소를 누르면 `paths.place(id)`로 이동.
- 빈 상태: 장소 0곳 → `아직 저장한 장소가 없어요` + `옛 여행 가져오기` 버튼(설정의 가져오기 대화상자 열기). 필터 결과 0 → `조건에 맞는 장소가 없어요` + `필터 지우기`.

- [ ] **Step 1: 실패하는 테스트**
- `label chips filter with any/all and show counts`
- `unlabeled chip and label chips are mutually exclusive`
- `region chips filter`, `search filters by memo text`
- `view switcher renders each of 4 views and persists choice`
- `bento block selects label and shows list below`
- `shift-click and long-press enter selection; bulk add label applies to all selected`
- `bulk delete shows undo toast that restores`
- `long name and memo do not overflow card` — 300자 이름·이모지 메모, 카드 요소에 `overflow-wrap: anywhere`(또는 `text-overflow: ellipsis`) 스타일과 `scrollWidth <= clientWidth`(jsdom 한계로 스타일 단언만 해도 됨)
- `empty states`
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: 커밋** — `feat(library): 보관함 필터·지역·검색·보기 4종·일괄 편집`

---

### Task 13: 장소 상세 — 라벨 편집·메모 자동 저장·삭제

근거: §4.3, §6.1(저장됨·dirty).

**Files:**
- Create: `src/sections/place/{PlaceDetail,LabelPicker,MemoEditor,EditableText}.tsx`, `src/domain/library/links.ts`, `tests/unit/sections/place/*.test.tsx`
- Reuse: `src/models/place.ts`의 `naverPlaceUrl` 아이디어 — 새 함수 `naverPlaceUrlOf(place: Place): string | null`(v2 `Place`, `source.kind === 'naver'`일 때 `https://m.place.naver.com/place/<sid>`)을 `src/domain/library/links.ts`에 두고, 길찾기 링크 `naverDirectionsUrl(place)` = `https://map.naver.com/p/directions/-/<lng>,<lat>,<encodeURIComponent(name)>,,/-/car`. **이 URL 형식은 구현 시 실제 브라우저에서 열어 확인하고**, 동작하지 않으면 길찾기 버튼을 빼고 보고한다(근거 없는 링크 금지).

**Interfaces:**
- Consumes: Task 6 `setPlaceName`, `setPlaceCategory`, `setPlaceMemo`, `toggleLabel`, `createAndAttachLabel`, `deletePlaces`, `restorePlaces`; Task 8 `useLibraryAction`, `useDraft`.
- `MemoEditor`: 여러 줄, `maxLength` 10,000, 남은 글자 수는 9,000자 넘을 때만 표시. 입력 후 **600ms** 멈추면 `commit`. 언마운트·라우트 변경·`visibilitychange`(hidden)·`pagehide`에서 즉시 `commit`. 상태 문구: `저장 중…` / `저장됨` / `저장하지 못했어요 · 다시 시도`. `remoteChanged`면 `다른 탭에서 바뀌었어요` 안내(초안은 유지).
- `LabelPicker`: 살아 있는 라벨 칩(켜짐/꺼짐), 입력란 placeholder `새 라벨 이름`, Enter로 `createAndAttachLabel`. `LabelNameInvalid`면 입력란 오류 `1–30자로 입력하세요`.
- 삭제 버튼 → `deletePlaces` → 보관함으로 이동 + 토스트 `장소를 지웠어요` / `되돌리기`(5초, `restorePlaces`).
- 없는 id(`/place/zzz`)나 지운 장소 → `장소를 찾을 수 없어요` + 보관함으로 돌아가기.

- [ ] **Step 1: 실패하는 테스트** (fake timers)
- `memo saves 600ms after typing stops and shows 저장됨 only after success`
- `flushes draft on unmount and visibilitychange`
- `failed save keeps draft and shows retry`
- `remote change while dirty keeps draft and shows notice`
- `toggle label chip and create new label with Enter; invalid name shows error`
- `delete navigates back and undo restores`
- `unknown or deleted id shows not-found`
- `naver link only for naver source`
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: 커밋** — `feat(place): 장소 상세 라벨 편집·메모 자동 저장·삭제 되돌리기`

---

### Task 14: 라벨 관리 화면

근거: §4.4.

**Files:**
- Create: `src/sections/labels/{LabelsPage,LabelEditor,IconPicker,ColorPicker,MergeDialog,DeleteLabelDialog}.tsx`, `tests/unit/sections/labels/*.test.tsx`

**Interfaces:**
- Consumes: Task 6 `createLabel`, `renameLabel`, `setLabelColor`, `setLabelIcon`, `reorderLabels`, `deleteLabel`, `mergeLabels`; Task 10 `LabelGlyph`; dnd-kit `SortableContext`(기존 일정 화면의 dnd-kit 사용 방식 참고).
- 목록: 순서대로, 각 행에 드래그 손잡이·아이콘·이름·장소 수·색 점. 행을 누르면 `LabelEditor`(이름·색 8개·아이콘 32개).
- 삭제 확인: `‘<이름>’ 라벨을 지울까요? 장소 N곳에서 이 라벨이 빠져요. 장소는 지워지지 않아요.`
- 병합: 대상 라벨 선택 → `‘<A>’를 ‘<B>’로 합칠까요? 장소 N곳에 ‘<B>’가 붙고 ‘<A>’는 지워져요.`
- 키보드로도 순서 변경 가능(dnd-kit `KeyboardSensor`).

- [ ] **Step 1: 실패하는 테스트**
- `create, rename (taken name shows error), recolor, change icon`
- `reorder by keyboard sensor persists order`
- `delete dialog shows affected place count; places remain`
- `merge dialog shows count and merges`
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: 커밋** — `feat(labels): 라벨 관리(이름·색·아이콘·순서·병합·삭제)`

---

### Task 15: 지도 연동

근거: §4.5.

**Files:**
- Create: `src/sections/map/LibraryMap.tsx`, `src/sections/map/markers.ts`, `src/stores/library-ui.ts`, `tests/unit/sections/map/*.test.ts(x)`
- Reuse: `src/components/map/{MapView,MapAdapter,FakeMapAdapter,NaverMapAdapter,cluster}.ts(x)` 변경 없음

**Interfaces:**
- `markers.ts`: `toMarkers(places: Place[], labels: Record<string, Label>, tokens: Tokens, selectedId: string | null): MapMarker[]` — 색은 첫 라벨의 `tokens.label[color].marker`, 라벨 없으면 `tokens.text.muted`, `selected`, `clusterable: true`.
- `LibraryMap`: Task 12와 **같은 `useLibraryQuery()` 결과**로 거른 장소를 표시. 마커 클릭 → `paths.place(id)`로 이동하고 목록이 그 행으로 스크롤(가상 목록에 `scrollToId` 이벤트 — `src/stores/library-ui.ts`의 `focusPlaceAtom: { id, seq }`로 전달). 목록·상세에서 고르면 `MapView.focus`로 이동. 필터가 바뀌면 `fitKey`를 `JSON.stringify(query)`로.
- compact에서는 `/map` 탭이 지도 전체 화면 + 상단 필터 칩 한 줄.

- [ ] **Step 1: 실패하는 테스트** (FakeMapAdapter)
- `marker color follows first label and theme tokens`
- `map shows only filtered places`
- `marker click opens detail and focuses list row`
- `selecting a row focuses map`
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: 커밋** — `feat(map): 보관함 지도(라벨 색 마커·필터 공유·선택 연동)`

---

### Task 16: 설정·옛 여행 가져오기 화면

근거: §4.6, §4.7.

**Files:**
- Create: `src/sections/settings/{SettingsPage,ThemePicker,LegacyImportDialog,ImportPreview,LegacyImportPage}.tsx`, `tests/unit/sections/settings/*.test.tsx`
- Modify: `src/routes/router.tsx`(`/t/:publicId` → `LegacyImportPage`)

**Interfaces:**
- Consumes: Task 9 전체(흐름은 Task 9의 "적용 흐름" 그대로), Task 7 `PrefsStore`, Task 10 `TOKENS`(미리보기 카드).
- `SettingsPage`: 테마 카드 3개(미니 벤토 미리보기), 모드 3개(시스템·라이트·다크), 보관함 보기 4개, `옛 여행 가져오기`, 데이터 정보(`장소 N곳 · 라벨 M개 · 사용 용량 X KB` — 직렬화 길이 × 2바이트 근사, 표기 `약`).
- `LegacyImportDialog`: 입력 두 가지 — 파일 선택(`.json`), 링크 붙여넣기(`/t/<publicId>` 또는 publicId). 읽기 오류는 대화상자 안에 `LegacyImportInvalid.message`.
- `ImportPreview`: `summary`를 `새로 추가 N · 이미 있음 M(라벨만 합침) · 새 라벨 K · 확인 필요 J`로. `pending`마다:
  - 라벨 이름: 입력란(제안값) + `이 라벨 제외` 체크. 검증: 비었거나 30자 초과·기존/다른 새 라벨과 정규화 이름이 같으면 오류 문구.
  - 긴 메모: `최대 10,000자로 가져오기(생략 표시 포함)` / `이 장소 제외` 라디오 + `원문 받기(.txt)`(파일명 `<장소 이름>-memo.txt`).
  - 모든 결정이 끝나야 `가져오기` 버튼 활성.
  - 적용이 `LegacyImportStale`이면 새 미리보기로 바꾸고 문구 표시(사용자 결정은 유지).
  - 성공 토스트 `N곳을 가져왔어요`.
- `LegacyImportPage`(`/t/:publicId`): `fromPublicId`로 읽어 같은 미리보기를 페이지로 보여 준다. 실패하면 `이 링크의 여행을 찾지 못했어요`.

- [ ] **Step 1: 실패하는 테스트**
- `theme/mode/view changes persist via PrefsStore and apply immediately`
- `data info shows counts`
- `import from file shows preview summary`
- `pending label and memo decisions gate the import button`
- `memo txt download contains full original`
- `stale apply shows recomputed preview and keeps decisions`
- `/t/:publicId renders preview from fetched data; 404 shows not found`
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: 커밋** — `feat(settings): 설정과 옛 여행 가져오기(미리보기·결정·재계산)`

---

### Task 17: 옛 코드 정리·README·번들 비교

근거: §9, §8(번들 전후 수치).

**Files:**
- Delete: `src/pages/TripPage.tsx`, `src/pages/HomePage.tsx`, `src/layouts/*`, `src/sections/explore/**`(아래 유지 예외 제외), `src/sections/views/**`(아래 유지 예외 제외), `src/components/{NicknameDialog,ReconcileBanner}.tsx`, `src/theme/{theme,view-tokens}.ts`, 삭제한 모듈의 단위 테스트, `tests/e2e/{views,itinerary,concurrent,share}.spec.ts`
- Keep(§9): `src/sections/itinerary/**`, `src/sections/share/**`, `src/domain/{leg-index,day-totals,day-hash,merge,reconcile,revert,overlay,codec,place-category}.ts`, `pipeline/**`, `src/components/map/**`
- **Keep — 유지 코드의 의존 모듈(리뷰 #15)**: 위 유지 집합에서 import를 따라가면 삭제 후보 중 다음 4개에 닿는다(2026-10-08 `feat/place-library`에서 계산). 이 4개와 그 의존성은 지우지 않는다: `src/stores/trip-store.ts`, `src/stores/ui-store.ts`, `src/sections/views/store/view-session.ts`, `src/sections/explore/store/add-stop.ts`. (각각 `itinerary-state`·`DayTabs`·`ItineraryPanel`·`StopEditPanel`·`Timeline`·`ExportDialog`·`ImportDialog`가 참조.)
- Move: `src/schema/{trip-source,trip-data,edit-layer}.ts` → `src/schema/legacy/`(import 경로 일괄 수정)
- Modify: `package.json`(`@iconify-json/mdi` 제거 — 남은 `~icons/mdi` 사용처를 Lucide로 바꾼 뒤), `README.md`

**계약:** 유지 코드는 라우트에 연결되지 않지만 `tsconfig.app.json`이 `src` 전체를 포함하므로 **컴파일·린트·단위 테스트를 계속 통과해야 한다.** 삭제 후보마다 실제 참조를 확인하고, 유지 집합에서 닿는 모듈은 남긴다. 테스트를 지워서 통과시키지 않는다(삭제한 모듈 자신의 테스트만 지운다).

- [ ] **Step 1: 삭제 전 참조 재확인**

Run: 삭제 후보 각각에 `git grep -l "<모듈 경로(확장자 없이)>" -- src tests pipeline`
Expected: 결과가 삭제 후보 자신과 그 테스트뿐이면 삭제, 유지 코드에서 나오면 유지 목록에 추가하고 보고한다.

- [ ] **Step 2: 삭제·이동 후 검증**

Run: `yarn lint && yarn typecheck && yarn test && git grep -n "~icons/mdi\|from 'zod'" -- src tests pipeline`
Expected: PASS, grep 출력 없음. 유지 코드의 테스트가 실패하면 원인이 된 삭제를 되돌린다(테스트·유지 코드를 고치지 않는다).

- [ ] **Step 3: 번들 비교**

Run: `VITE_MAP_ADAPTER=fake yarn build && node scripts/measure-ui-assets.mjs dist/assets > .cache/bundle-after.json`
`docs/ui-performance.md` 끝에 `## 2026-10-08 v2 하위 프로젝트 1` 절을 추가하고 before/after 합계 gzip 바이트와 차이, 측정 명령을 적는다(수치는 실제 출력 그대로).

- [ ] **Step 4: README 갱신** — 첫 문단을 v2 컨셉(§1.2)으로, 개발 명령에 `yarn effect:source`, 화면 경로 표(`/`, `/map`, `/place/:id`, `/labels`, `/settings`, `/trips`, `/t/:publicId` = 옛 여행 가져오기), "여행 추가" 절은 "옛 파이프라인(하위 프로젝트 2·3에서 대체 예정)"으로 표시. E2E 프로젝트 목록은 Task 18 후 갱신.

- [ ] **Step 5: 커밋** — `refactor: 옛 탐색·뷰 화면 정리, 옛 스키마를 legacy로 이동, MDI 제거`

---

### Task 18: E2E·스크린샷·최종 검증

근거: §8 E2E와 완료 기준.

**Files:**
- Create: `tests/e2e/library.spec.ts`, `tests/e2e/legacy-import.spec.ts`, `tests/e2e/themes.spec.ts`, `tests/fixtures/library/seed.json`(장소 30·라벨 6, 강릉·속초·제주·서울 주소, 긴 이름·이모지 메모 1곳 포함)
- Modify: `playwright.config.ts`(projects), `tests/e2e/global-setup.ts`(옛 여행 fixture `e2etest000001.json` 복사는 유지 — 가져오기 E2E가 사용), `README.md`(E2E 절), `.github/workflows/ci.yml`(변경 필요 시에만)

**Interfaces:**
- 시드 주입: `page.addInitScript`로 `localStorage.setItem('tripmap:library:v2', <seed>)`.
- Playwright projects: `desktop`(Chromium 1280×800), `iphone`(`devices['iPhone 13']` WebKit 390×844), `galaxy`(Chromium, 360×780, `isMobile: true, hasTouch: true`, UA는 `devices['Galaxy S9+']` 계열). 각 spec의 핵심 흐름 테스트 이름에 `@smoke`.

- [ ] **Step 1: 테스트 작성**
- `library.spec.ts`
  - desktop `@smoke`: 라벨 칩 선택 → 목록·지도 마커 수가 함께 줄어듦 → 행 클릭 → 상세가 3단 오른쪽에 열림 → 마커 클릭으로 다른 장소 상세.
  - iphone·galaxy `@smoke`: 하단 탭 이동, 장소 열기(전체 화면 시트) → 새 라벨 추가 → 메모 입력 → `저장됨` → 뒤로 가기 → 카드에 메모 표시 → 새로고침 후에도 유지.
  - 두 탭: 같은 context에 페이지 2개, 서로 다른 장소 메모 저장 → 새로고침한 양쪽 모두에 두 메모.
- `legacy-import.spec.ts` (desktop `@smoke`): `/t/e2etest000001` → 미리보기 → 가져오기 → 보관함에 장소·라벨.
- `themes.spec.ts` (desktop·iphone): 테마 3 × 라이트/다크로 보관함 스크린샷을 `test-results/themes/<project>-<theme>-<mode>.png`에 저장(비교 단언 없음, 산출물).
- [ ] **Step 2: 실행**

Run: `yarn playwright install chromium webkit && yarn test:e2e`
Expected: 모두 PASS.

- [ ] **Step 3: 최종 검증(이 순서)**

Run: `yarn lint && yarn fm:check && yarn typecheck && yarn test && yarn validate && yarn build && yarn test:e2e:ci`
Expected: 모두 PASS. 출력 요약(테스트 수)을 기록한다.

- [ ] **Step 4: 커밋** — `test(e2e): 보관함·가져오기·테마 E2E와 모바일 프로젝트`

- [ ] **Step 5: 결과 보고 자료** — desktop 1280·iphone 390의 보관함·상세 스크린샷과 테마 스크린샷 경로, 번들 전후 수치(Task 17), "실물 기기는 하위 프로젝트 5에서 점검(미실행)"을 사용자에게 보고한다.
