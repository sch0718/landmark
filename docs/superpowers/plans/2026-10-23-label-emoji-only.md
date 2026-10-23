# 라벨 이모지 전용 표시 구현 계획

**목표:** 승인된 `docs/superpowers/specs/2026-10-23-label-emoji-only-design.md`에 따라 화면과 편집에서 라벨 선 아이콘을 없앤다.

**구조:** `LabelGlyph`는 이모지만 출력하고, 플래너는 기존 SVG를 이름 있는 컴포넌트로 사용한다. 저장 스키마와 호환 처리에는 손대지 않는다.

**기술:** React 19, Vite, TypeScript, MUI 7, Vitest.

## 제약

- 주석과 UI 문구는 한국어, 사용자 문자열은 React 텍스트로 출력한다.
- 저장 형식, 지도, 공유 뷰어, 공용 시험 설정과 rollback 문서는 유지한다.
- 서버·E2E 실행과 커밋은 하지 않는다.

## 작업 순서

- [x] `label-glyph.test.tsx`에서 이모지 없음(undefined/null/빈 문자열), 배지·칩·타일의 이름만 표시와 빈 자리 제거를 검증한다. `labels-page.test.tsx`에서는 아이콘 선택기가 없고 색은 저장되는지 검증한다. 먼저 관련 Vitest를 실행하여 기존 구현의 실패를 확인한다.
- [x] `icons.tsx`의 `LabelGlyph`를 `{ emoji?: string | null; size?: number }`로 줄이고 `if (!emoji) return null`로 처리한다. 기존 span 스타일은 유지한다. `BedIcon`, `CarIcon`, `FootprintsIcon`을 내보내고 플래너에 기존 크기와 aria-hidden을 지정한다. 아이콘 시험도 세 SVG의 서로 다른 모양·크기를 검증하도록 고친다.
- [x] 표시 사용처에서 `name={label.icon.value}`를 제거한다. 칩의 래퍼와 overview 장식 상자는 이모지가 있을 때만 렌더링하고 타일 이름의 오른쪽 여백도 조건부로 바꾼다. 세로 목록은 기존 크기의 빈 칸으로 정렬하고 관리 줄의 32px 색 네모를 유지한다. `ColorBadge.icon`과 라벨 전용 SVG 스타일을 없앤다.
- [x] `IconPicker.tsx`, 편집기 연결, `setLabelIcon`과 해당 시험을 제거한다. 설명과 주석을 이모지 동작에 맞춘다. E2E 파일의 기존 기대를 검토한다.
- [x] 관련 시험을 통과시킨 뒤 `yarn typecheck`, `yarn lint`, `yarn vitest run`을 실행한다. diff와 남은 참조를 검토하여 변경 파일·빈 자리 결정·검사 결과를 보고한다.

## 검증 결과

- 관련 Vitest: 4개 파일, 82개 시험 통과.
- `yarn typecheck`: 통과.
- `yarn lint`: 통과.
- `yarn vitest run`: 213개 파일, 3,653개 시험 통과.
- `git diff --check`, 변경 파일의 U+2028/U+2029 검사: 통과.
- 별도 읽기 전용 코드 리뷰: 발견된 문제 없음.
- E2E 코드는 기존 아이콘 관련 기대가 없어 변경하지 않았으며 실행하지 않았다.
- 커밋 없이 작업 트리에 남겼다.
