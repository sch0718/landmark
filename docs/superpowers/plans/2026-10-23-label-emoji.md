# 라벨 이모지 구현 계획

사용자가 승인한 설계 방향에 따라 현재 워크트리에서 직접 실행한다. 커밋·푸시·브랜치 조작은 하지 않는다.

**목표:** 기존 아이콘을 보존하면서 라벨 이모지 선택·추천·일괄 적용과 안전한 되돌리기를 제공한다.
**구조:** 선택 LWW 필드, 공통 LabelGlyph, lazy 생성/관리 모듈, 순수 일괄 연산.
**기술:** React 19, TS 6, Effect Schema 4, MUI 7, Vitest 5, Playwright.

- [x] 스키마/추천/생성 시험을 먼저 추가하고 실패를 확인한다. library.ts에 검증을 더하고
  label-emoji.ts에 추천 함수, label-create.ts에 생성 함수를 분리한다.
  명령: yarn vitest run tests/unit/domain/library/label-emoji.test.ts
- [x] LabelGlyph·배지·지도 시험의 실패를 확인하고 모든 라벨 표시 지점을 연결한다.
  명령: yarn vitest run tests/unit/components/label-glyph.test.tsx tests/unit/sections/map/markers.test.ts
- [x] label-emoji-ops.ts의 일괄 적용/되돌리기 시험을 먼저 쓰고 최신 필드 비교를 구현한다.
- [x] LabelsPage·LabelEditor 시험에 선택/키보드/미리보기/적용/되돌리기를 추가하고 실패 후 구현한다.
  EmojiPicker.tsx와 SuggestEmojiDialog.tsx는 LabelsPage에서만 로드한다.
  명령: yarn vitest run tests/unit/sections/labels/labels-page.test.tsx
- [x] 공유 v1/v2·백업·병합/정렬 보존을 검증하고 labels-emoji.spec.ts E2E를 세 프로젝트에 등록한다.
- [x] docs/rollback.md에 이전 버전 저장 시 이모지가 지워짐을 기록한다.
- [x] yarn lint, yarn build:ci와 금지 문자 검사를 실행하고 크기/시험 수/미실행 E2E를 보고한다.

추가 점검: 보관함·계획·당일 지도는 firstPlaceLabel/placeMarkerName을 함께 쓴다.
생성 모듈을 받지 못할 때 라벨 검색 입력을 보존하고 재시도할 수 있다.
단독 ‘회’는 Unicode 문자·숫자 경계를 검사해 ‘100회 방문’ 같은 횟수 표현을 제외한다.

검증 결과: yarn lint 통과. build:ci는 tsx IPC EPERM으로 직접 실행이 막혀 validate만
node --import tsx pipeline/cli/validate.ts로 바꾼 동일 파이프라인을 실행해 통과했다.
지도 코드 포함 크기는 실제 요청 없이 더미 지도 키를 빌드 단계에만 주어 확인했다.
E2E는 세 프로젝트 총 6건 수집 확인만 했으며 5173·5174 사용 금지로 실행하지 않았다.
최종 단위 시험 211파일·3,632건 통과, 실패 0. 첫 로딩 JS gzip 315,142바이트
(예산 327,680바이트), 금지 문자 0건, git diff --check 통과.
