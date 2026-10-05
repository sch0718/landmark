# PoC 검증 범위

2026-10-05 PR #5 사용자 요청에 따라 동작 결함 검증을 우선한다.

## 자동 CI

- PR마다 실행하고 main에 push될 때 실행한다. 같은 feature 커밋의 push·PR 중복 실행을 제거한다.
- 데이터 검증·타입 검사·lint·전체 단위 테스트·빌드를 유지한다. URL 경쟁, 메모/일정 저장, 병합·되돌리기 회귀를 제거하지 않는다.
- E2E는 `yarn test:e2e:ci`의 `@smoke` 사례만 실행한다. 세 뷰·검색·상세, 메모 초안과 저장, 날짜 추가, URL/reload, 지도 키 없음, 반응형 시트/dock, 가상 목록 끝 항목과 marker 선택, 파일/링크 가져오기·되돌리기, 두 탭 동시 저장을 검증한다.
- desktop Chromium, mobile WebKit, 320px narrow-mobile을 유지한다. 실패 trace·스크린샷·보고서도 유지한다.

## 축소·제거한 반복 검사

- 500곳 두 번 전수 순회·7개 화면 폭 전환을 짧은 처음/끝/검색/marker 검사로 축소한다. 가변 높이·화면 폭별 세부 복원은 기존 단위 테스트와 수동 E2E에 남는다.
- 500곳 20회 왕복에서 브라우저 전역 이벤트/observer를 계측하던 E2E를 제거한다. 단위 테스트의 지도 mount/destroy·observer·구독 cleanup 검증을 유지한다.
- 테스트용 geometry helper의 정상 trailing 여백만 검사하던 E2E를 제거한다. 실제 목록 표시·overflow와 제품의 geometry 복원 회귀를 유지한다.
- 두 탭에서 동시에 20회씩 저장하던 테스트를 3회씩으로 축소한다. 모든 메모의 저장소 일치와 reload 후 표시를 유지한다.
- 기본 뷰 전환의 성공 스크린샷 6개를 제거한다. 실패 스크린샷은 Playwright 설정에서 생성한다.

## 필요할 때 실행

`yarn test:e2e`는 남겨둔 세부 E2E 전체를 실행한다. UI 스크롤/가상화/viewport를 변경할 때 사용하며, 이 설정이 main에 병합된 뒤 GitHub Actions의 Run workflow에서 `full_e2e=true`를 선택해 실행할 수도 있다. 성능 관련 변경 때는 [성능 기준](ui-performance.md)으로 측정한다.

URL 훅의 reducer 재작성과 추가 전이 표 테스트는 보류한다. 기존 실제 라우터 회귀와 상태 문서를 유지한다. jsdom/MUI 통합 테스트의 추가 분리는 테스트 실행 시간이 다시 문제가 될 때 검토한다. 실물 기기·실제 SDK 확인은 실제 여행 사용 전에 수행한다.
