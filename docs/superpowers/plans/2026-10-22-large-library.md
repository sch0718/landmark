# 많은 장소·라벨 구현 계획

사용자가 지정한 기존 워크트리에서 파일만 수정한다. 커밋·푸시·브랜치 변경 없이 이 세션에서 순차 실행한다.

- [x] `scripts/bench-library.mts`: 백업 인자, 이전 계산 참조, 중앙값 측정. 지역 시험을 먼저 추가한다.
- [x] `region.ts`, `query.ts`: 기존 단일 지역 결과 보존, 17개 시·도 계층과 격자 캐시, 장소 레코드별 livePlaces 재사용. `region-hierarchy.test.ts`와 기존 지역·질의 시험을 실행한다.
- [x] `ChipScrollRow.tsx`, `LabelFilterDialog.tsx`, `LabelChips.tsx`, `RegionChips.tsx`: 단위 시험 뒤 검색·선택·정렬·두 단계 UI·넘침 버튼을 구현한다. lazy-routes와 build:ci 목록을 등록한다.
- [x] `LibraryMap.tsx`, `MapView.tsx`, 두 어댑터: 기본 마커 정체성 시험 뒤 선택 전달을 분리한다. 색인 재구성 횟수를 검증한다.
- [ ] `large-library.spec.ts`, Playwright 설정: 새 시드 라벨을 시험에서 추가하고 세 프로젝트에서 라벨·지역 거르기와 마커 수를 확인한다. 5178 실행에서 5174 공유 서버를 생략한다.
- [x] `yarn lint`, `yarn build:ci`, 기존·새 E2E, 성능 측정을 실행한다. 스펙에 숫자와 결과를 기록한다.

E2E 두 명령은 5178 listen EPERM으로 실행 차단됨. build:ci의 tsx IPC 제한은 동일 로더 직접 실행으로 데이터 검증 후 나머지 단계를 검증했다. 브라우저 실행 확인은 포트 권한이 있는 환경에서 필요하다.
