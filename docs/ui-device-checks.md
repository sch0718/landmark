# 실물 기기 확인 기록

구현 검증 책임자는 Codex 구현 담당자다. 미실행 등록 일시는 2026-10-05 06:24:15 KST이다. 실물 기기를 실제로 조작한 확인자는 없다. 아래 항목은 모두 **미실행**이다. 브라우저 자동화 결과는 [성능 기록](ui-performance.md)과 Playwright report에 별도로 기록한다. WebKit의 iPhone 에뮬레이션을 실물 Safari 확인으로 취급하지 않는다.

현재 측정 제품 소스: `f9f8fc202e51b3e17bf6b4bfe68146e52af511e5` (가변 행 가상화, fake marker 재사용, viewport snapshot 캐시, retained content memo와 fresh day0 복원 생략 및 Task9 pixel gap·모바일 고정 열 및 Task11 활성 geometry 캐시 소유권). Task4 강화 측정은 `79c0bd0692b4c7e54be89836bdc523be9c2ce8aa`였다. 첫 Task4 측정 소스는 `d2a45831ea6e29d91947ef94f2dec5b0d8ac95ab`다. 과거 자동화 소스는 `b0e2199fcb36eeb43e07a39d8713b3b92557fb35`다. Task4 Chromium/WebKit 자동화 성공을 실물 확인으로 취급하지 않으며, 실제 기기 확인 시 일시·최종 검증 커밋을 갱신한다.

| **대상** | **확인 일시 / 확인자·역할** | **모델 / OS / 브라우저 정확한 버전** | **모드 / 방향** | **결과** | **근거 / 문제** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| iPhone Safari 실물 | 미실행 / 실제 조작자 없음; Codex는 구현 검증 담당 | 미확인 / 미확인 / 미확인 | 지도·일정·장소 / 세로·가로 | 미실행 | 실물 접근 없음, 스크린샷 없음 |
| Android Chrome 실물 | 미실행 / 실제 조작자 없음; Codex는 구현 검증 담당 | 미확인 / 미확인 / 미확인 | 지도·일정·장소 / 세로·가로 | 미실행 | 실물 접근 없음, 스크린샷 없음 |
| 유효 키 Naver SDK | 미실행 / 실제 조작자 없음 | 기기·OS·브라우저 미확인 | 지도 / 세로·가로·데스크톱 | 미실행 | 실제 타일·마커·클러스터·idle redraw·지도 가림 미확인 |

두 실물 대상에서 아래 사례를 각각 확인하고, 결과를 PASS / FAIL / 미실행으로 기록한다. 실패 사례는 수정 후 동일 기기로 다시 확인한다.

| **사례** | **iPhone Safari** | **Android Chrome** | **기록할 근거** |
| :--- | :--- | :--- | :--- |
| 가상 키보드로 검색·메모 편집, 닫은 뒤 툴바·하단 탐색 | 미실행 | 미실행 | 화면 이동·입력 가림·복구 스크린샷 |
| 주소창 펼침·접힘 | 미실행 | 미실행 | visual viewport 및 화면 경계 |
| safe-area와 홈 표시줄 | 미실행 | 미실행 | 하단 버튼·시트의 실제 가림 |
| 세로→가로→세로 회전 | 미실행 | 미실행 | 선택 뷰·초안·지도 위치 유지 |
| 한 손 엄지로 뷰 전환·시트 드래그·빠른 추가 | 미실행 | 미실행 | 실제 조작자와 실패 단계 |
| 실제 지도 타일·마커·클러스터·상세 가림 | 미실행 | 미실행 | 유효 키 SDK 화면 및 delayed idle redraw |
| 편집 링크/파일 내보내기→다른 기기 가져오기→병합 | 미실행 | 미실행 | 공유 시트·파일 저장·가져오기 사례 |

## 자동화에서 남은 미확인 항목

2026-10-05 Task 10의 macOS WebKit 자동화에서 같은 단계의 fullPage/viewport 캡처 간 툴바 픽셀이 누락되는 경우가 있었다. scrollY=0, header.y=0, visualViewport.offsetTop=0 및 툴바 경계 assertion은 통과했으나 **캡처/paint 원인은 미확정**이다. 좌표 통과만으로 실제 표시 기능이 정상이라고 확정하지 않는다. 실물 Safari에서 검색 focus·뷰 전환 직후 직접 보고 확인해야 한다.

- 자동화 대상: iPhone 13 설정, 390×844; 검색 focus는 390×664도 확인. 실물 모델/OS 버전의 증거가 아니다.
- 근거: `outputs/implementation/2026-10-05/task-10-report.md`, `screenshots/task-10-capture-comparison-390x844/`, `screenshots/task-10-final-focus-mobile.json` (문서 작업공간의 외부 검증 자료).
- 해당 캡처 항목 상태: **미확인**. 실물 재현 여부, 실제 픽셀 표시 및 SDK 가림을 후속 기록한다.

Task4 자동화의 mobile 엔진은 WebKit 26.6이며 Chromium iPhone UA 에뮬레이션이 아니다. 가상 목록의 바닥 content 축소 후 위치 유지 검사는 WebKit PageUp으로 확인했고, 실제 Safari/Android touch momentum과 native scrollend fallback의 실물 동작은 미확인이다.

Task8의 새 일정 복원 focused 3contexts는 WebKit 26.6 목록 내부 버튼 focus 후 PageDown, desktop/narrow Chromium 153.0.8010.12 wheel을 사용했다. 첫 전체 실행과 fixture/input 교정 실패 이력은 성능 기록·Task8 보고서에 별도로 남겼다. 실물 touch 조작을 확인한 결과가 아니다.

Task10은 새 일정 WebKit 입력의 중간 캡처를 진단한 뒤 해당 테스트만 12연속 stable RAF로 교정했다. 첫 전체58 PASS/1 FAIL/3 skip과 수정 후 전체59 PASS/3 skip은 별개다. Task8 focused3 PASS는 flake 부재를 보장하지 않는다. Production29 PASS+1 FLAKY의 mobile500 폭320→390 첫 실패는 offset0→38295·row121 복귀가 저장 trace에 보이나 함수 원인과 안정 후 실제 입력 안전성은 Cannot verify다. 실물 검사 시 폭 변경 직후 첫 카드/스크롤 위치를 직접 확인한다.

Task12 실제 native68 first PASS/3 skip/0 FLAKY, production39 first PASS/0 FLAKY다. Task10 폭 변경의 당시 Cannot verify는 이후 W6 제품 결함으로 확인됐으며 Task11 ownership 수정과 Task12 trusted 안정후/in-flight 입력 회귀를 별도로 확인했다. 과거 실패는 유지한다. 실물 touch·SDK·paint 인증으로 취급하지 않는다.
