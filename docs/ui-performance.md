# 반응형 UI 성능 실측

## 현재 PoC 기준 — 2026-10-05 사용자 결정

PR #5의 재검토에서 사용자가 성능 기준 완화와 과한 검증 축소를 승인했다. 500곳·CPU4x 스트레스 환경의 상호작용 목표를 p95 **300ms 이하**, 조작군별 30회 측정 중 원 duration **100ms 초과 작업 최대 5회**로 조정한다. 기존 기준은 p95 200ms·긴 작업 2회 미만이었다. 다운로드 예산은 유지한다. 성능 측정은 매 PR의 필수 CI가 아니라 성능 관련 제품 변경 때 수동으로 수행한다.

아래 f9f8fc2 측정의 p95 최대 135.5ms·긴 작업 최대 3회는 완화된 PoC 범위로 수용한다. 기존 **FAIL 기록과 원자료는 당시 기준의 결과로 보존**한다. 이번 변경은 제품 소스를 수정하지 않았고 최신 커밋의 성능은 재측정하지 않았다. 따라서 이 결정을 최신 성능 실측 PASS나 Timeline 최적화 완료로 해석하지 않는다. 이전 성능 FAIL은 이번 PoC 병합의 차단 조건에서 제외한다.

실물 iPhone/Android와 유효 키 Naver SDK는 여전히 미검증이다. [기기 확인 기록](ui-device-checks.md)에 한계를 유지하고 실제 여행 사용 전 기본 지도·검색·메모 저장·시트 조작을 확인한다. 현재 PoC에서 추가 장비 검증이나 정밀 성능 테스트를 구현 완료의 필수 조건으로 삼지 않는다.

CI는 [검증 범위](ui-validation.md)의 핵심 사용자 흐름을 사용한다. 이후 기록의 단위/E2E 수와 엄격한 예산은 각 과거 측정 시점의 결과다.

## Task12 활성 geometry 캐시 소유권 수정 후 최종 검증

제품 BASE/측정 HEAD는 `f9f8fc202e51b3e17bf6b4bfe68146e52af511e5`다. Task11 Approved 소스는 같은 활성 host의 geometry remount에서 과거 compatible cache를 소비하지 않고 첫 measured 진입·새 host·진짜 view 왕복 복원을 구별한다. local ownership은 실제 commit에서만 기록하고 Provider cache에 DOM host를 넣지 않는다. Task12 제품·테스트 추가 변경은 없다. Timeline 범위 선택은 pending이며 수정하지 않았다.

같은 production fake·500곳/2일/하루50방문·390×844·Chromium153.0.8010.12·CPU4x·각 군5워밍업+30표본·DOM capture 출발→완료 다음RAF·원 LongTask duration으로 **한 완전 실행**을 판정했다. AppleM4/macOS26.1(25B78)/Node22.18.0 환경이다. 비용 context에는 Profiler/counter/다른 heavy 검사를 넣지 않았다. 최신 helper는 pixel gap·가로 bounds·정확 key/이름/순서·연속 행·상하 coverage를 강제한다. 비일정140 snapshot 모두 grid gap/columnGap10 또는 list0 및 모든 카드 가로 포함을 충족했다. 예산·fixture·assertion·timeout을 바꾸거나 선택적 재실행하지 않았다.

| **조작군** | **median ms** | **p95 ms** | **max ms** | **>100ms 수** | **판정** |
| :--- | ---: | ---: | ---: | ---: | :--- |
| 검색 | 45.95 | 60.4 | 63.1 | 0 | PASS |
| 필터 | 30.60 | 56.0 | 63.1 | 0 | PASS |
| 장소→일정 | 75.60 | 122.0 | 135.4 | 3 | FAIL |
| 일정→장소 | 36.50 | 49.5 | 54.5 | 0 | PASS |
| 장소→지도 | 107.25 | 135.5 | 139.5 | 0 | PASS |

**전체 성능 예산은 FAIL**이다. 모든 p95≤200ms는 PASS지만 장소→일정의 >100ms 원 LongTask3건은 군별2개 미만 기준을 충족하지 못한다. day16/26/31의 start는18217.2/21599.9/23334.2ms, 원 duration127/106/104ms다. 별도 `longtask-events.json`·`trace-analysis.json`에 원값과 sample별 phase union을 보존했다. 겹치는 phase를 합산하거나 원인을 Timeline/useSortable/특정 함수로 확정하지 않는다. 스크롤15회 wheel500px/50ms의 원 LongTask는0건이다. 이전 실행의 PASS 군을 조합해 현재 결과를 바꾸지 않는다.

| **항목** | **기준 gzip B** | **현재 gzip B** | **증가 B** | **판정** |
| :--- | ---: | ---: | ---: | :--- |
| 전체 JS | 276873 | 299000 | 22127 | PASS (20%·75KiB 이내) |
| 초기 JS, 세 뷰 각각 | 276873 | 299000 | 22127 | PASS (15%·50KiB 이내) |
| CSS | 0 | 0 | 0 | PASS (10KiB 이내) |
| 같은 HEAD 아이콘 제외→포함 | 297977 | 299000 | 1023 | PASS (10KiB 이내) |

세 뷰 초기 요청은 각각 문서1·JS3·여행JSON1, 외부0이며 fake map instance는 장소/일정0·지도1이다. noicons는 같은 HEAD archive에서 정적 import10개만 제외했다. 별도 counter20cycle 모두 before/after와 동일한 RO2/targets4/events653/global8/tracked11/marker500/mapId1이다. 전체 CI60파일678테스트·tracked lint·최종 fake build 복원은 exit0이다.

전체 native 첫 시작은 localhost5173 포트 경합으로 **test0실행/exit1**이었다. 해당 로그를 보존하고 listener 해제를 확인한 뒤 실제 전체를 실행했다. 실제 전체는 **68 first PASS/3 조건부 skip/0 FLAKY, exit0**다. production은 기존10+Task11신규3=13개×3문맥의 **39 first PASS/0 FAIL/0 FLAKY/0 skip, exit0**다. W6의 안정후/in-flight trusted 입력·390→320→390 과거cache 미복귀, desktop 정상 trailing 여백도 포함한다. 이미 승인된 Task11 focused33을 불필요하게 반복하지 않았다. helper 대기만으로 W6를 해결했다고 주장하지 않으며 승인된 source ownership 수정과 실제 회귀를 연결한다.

Task10의 정상geometry strict dayLong4 FAIL 및 production29PASS1FLAKY는 역사로 그대로 보존한다. 당시 폭 변경 원인 Cannot verify는 후속 whole-review에서 실제 W6 제품 결함으로 확인됐고 Task11 source fix/Task12 회귀를 별도로 추가했다. 과거 실패를 소급 PASS로 바꾸지 않는다. Task8 gap80 결과는 정상 grid 완료 인증에 사용하지 않는다. Task10 새 일정12stableRAF 캡처 교정·복원오차2·원 assertion/timeout은 유지한다.

측정 UTC `2026-10-05T10:12:57.130Z`, 제품 tree SHA256 `4278b5ce2b7213e179b89b2db94175b5e2462d1f1b12f012a8f9cae41d5e7506`, source SHA256 `8e77be5749ae82b0d761428c3757727d174c176324269ad6c584cb77315ca481`, test SHA256 `f253b793c89a0f17fe2d55e76dab8817f044bfc9e0e780722ec1f27a2b6feb7a`다. 측정 tracked dirty diff는 빈 SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`였다. helper `8b157e5ad649e81f5e94d50ec0b9ad0bbb210fc515b5405a09bb42da23205993`와 harness `73f1258cbdfbfa2497a38eccaa5ae7e372739b9e106819415d054777591de6d2`를 고정했다. before/다섯 군 during/after HEAD/tree/dirty 및 initial metadata가 일치한다. 이후 문서 dirty와 비용 당시 상태를 구별하며 제품·test는 BASE와 동일하다.

원자료는 문서 작업공간 `outputs/implementation/2026-10-05/task-11-measurements/`의 `latency-virtual-ownership-final/`, `ownership-final-provenance.json`, `ownership-final-native-started-artifacts/`, `ownership-final-production-artifacts/`, `ownership-final-lifecycle/`, `ownership-final-assets.json`, `ownership-final-noicons-*`, `virtual-command-logs/ownership-*`다. 전체 명령·exit·제한은 `virtual-task-12-report.md`에 남겼다. native mobile 실제 WebKit26.6, desktop/narrow Chromium이며 W1 PageUp/wheel·새 trusted 입력은 WebKit PageDown/Chromium wheel이다. 실물 iPhone/Android touch·유효 Naver SDK·WebKit capture/paint는 Cannot verify다. 영구clone/bundle 갱신과 전체 목표 최종 gate는 controller 후속이며 이 검증의 성능 FAIL을 전체 제품 승인으로 해석하지 않는다.

## 역사적 Task10 정상 pixel gap·가로 경계 측정

제품 BASE/측정 HEAD는 `35cddd0fb28af3053f15961e80826b5bff6d4528`다. Task9의 grid gap10px·모바일 2열/list 1열 및 모든 카드의 행/목록 가로 경계 검증을 적용했다. 제품 추가 변경 없이 한 번의 완전한 strict run을 보존했다. Task8의 실제 gap80px 결과는 역사적 FAIL이며 정상 grid 완료 인증으로 사용하지 않는다.

Apple M4/macOS26.1(25B78)/Node22.18.0/Chromium153.0.8010.12, production fake, 390×844, CPU4x, 500곳/2일/하루50방문, 각 군 5워밍업+30표본을 유지했다. DOM capture 출발→완료 다음 RAF, 원 LongTask duration, p95≤200ms·군별 >100ms 작업 2개 미만 예산을 유지했다. 비용 context와 counter/Profiler를 분리했으며 추가 strict 재실행은 하지 않았다. 비일정 140개 완료 snapshot 모두 실제 grid gap/columnGap10 또는 list0, 모든 카드 가로 경계, 연속 행·정확한 key/이름/순서·상하 coverage를 충족했다.

| **조작군** | **median ms** | **p95 ms** | **max ms** | **>100ms 수** | **판정** |
| :--- | ---: | ---: | ---: | ---: | :--- |
| 검색 | 28.60 | 35.2 | 36.1 | 0 | PASS |
| 필터 | 32.05 | 41.5 | 43.9 | 0 | PASS |
| 장소→일정 | 78.25 | 135.0 | 141.0 | 4 | FAIL |
| 일정→장소 | 43.50 | 78.4 | 99.2 | 0 | PASS |
| 장소→지도 | 117.40 | 161.2 | 241.9 | 1 | PASS |

**전체 상호작용 예산은 FAIL**이다. 모든 p95는 PASS이고 장소→일정의 >100ms 작업 4건이 실패 조건이다. 지도 max241.9ms 자체는 승인된 예산 항목이 아니다. day15/16/21/24의 원 LongTask start는 17302.3/17731.2/19451.5/20530.2ms, duration122/106/115/101ms다. FunctionCall union123.949/106.450/108.447/98.712ms, Layout6.904/7.254/8.767/7.950ms, Paint2.241/2.037/2.847/2.738ms다. day16 MinorGC union23.064ms, 나머지는 해당 sample에서 GC duration X 이벤트가 관측되지 않았다. 최대 개별 anonymous callback `index-aUEFvew3.js:9:136358`은 114.816/97.861/105.709/94.724ms다. 겹치는 phase를 합산하지 않으며 날짜 Timeline이나 특정 제품 함수의 원인으로 단정하지 않는다. 스크롤 15회 wheel500px/50ms의 원 LongTask는 0건이다.

| **항목** | **기준 gzip B** | **현재 gzip B** | **증가 B** | **판정** |
| :--- | ---: | ---: | ---: | :--- |
| 전체 JS | 276873 | 298843 | 21970 | PASS (20%·75KiB 이내) |
| 초기 JS, 세 뷰 각각 | 276873 | 298843 | 21970 | PASS (15%·50KiB 이내) |
| CSS | 0 | 0 | 0 | PASS (10KiB 이내) |
| 같은 HEAD 아이콘 제외→포함 | 297819 | 298843 | 1024 | PASS (10KiB 이내) |

초기 세 뷰 각각 문서1·JS3·여행JSON1, 외부 요청0, fake instance 장소/일정0·지도1이다. noicons는 같은 HEAD archive의 import10개만 제외한 사본이다. 별도 counter 20cycle 모두 before/after와 정확히 동일한 RO2/targets4/events653/global8/tracked11/marker500/mapId1이다. full CI 59파일/672테스트, tracked lint, 최종 fake build 복원은 exit0이다.

native 첫 전체는 **58 PASS/1 FAIL/3 skip, exit1**이며 새 일정 복원 WebKit 사례가 2RAF 중간 위치를 캡처했다. 별도 3회 진단에서 capture373→cleanup/restore572, capture294→cleanup/restore546을 확인했다. 마지막 기록과 실제 복원은 일치했다. 402px에서 약50ms 중간 정지 및 중간 scrollend도 관측되어 단일 scrollend를 종료로 쓰지 않았다. 승인된 새 사례의 캡처만 12연속 stable RAF로 교정했다. 제품·복원 오차2px·기존 assertion/timeout은 그대로다. 교정 후 focused3 PASS, **두 번째 전체 native59 PASS/3 skip, exit0**를 별도로 기록하며 첫 실패를 소급해 PASS로 바꾸지 않는다. Task8 focused3 PASS도 flake 부재를 보장한 결과가 아니다.

교정 후 production 신규10×3은 **29 PASS+1 FLAKY, exit0**다. mobile500 폭 변경 320→390에서 첫 n1001 조회가 원 timeout5000ms에 실패하고 retry가 통과했다. 저장 trace의 setter 직후 row0/offset0에서 다음 조회 시 offset38295·columns2·첫 row121/key n1243으로 바뀌고 renderer class가 변했다. 비동기 geometry remount/복원 순서는 후보이며 구체 호출 원인, 정확한 행 bounds 및 geometry 안정 후 실제 사용자 입력 안전성은 **Cannot verify**다. 추가 재실행/제품 수정/timeout·assertion 완화는 하지 않았다. 원 trace·screenshot·error·decoded snapshot을 보존했다.

측정 UTC `2026-10-05T04:23:40.716Z`, 제품 tree SHA256 `be976cf0ceebf149674cb5f2ba0e93e9116f4b69310d182e15f2ebcbe2c390ee`, 측정 tracked dirty diff는 빈 SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`다. source SHA256 `6d738bf56f85023ef072b974921c4cb8caa5e45b28298ab60f9da644691bfa22`, helper `8b157e5ad649e81f5e94d50ec0b9ad0bbb210fc515b5405a09bb42da23205993`, harness `73f1258cbdfbfa2497a38eccaa5ae7e372739b9e106819415d054777591de6d2`를 고정했다. before/다섯 군 during/after HEAD/tree/dirty metadata가 일치한다. 측정 test SHA `845a2e521cd63b8f366a7544c2b832cf7bde944cbcd29537b711378e7a850e64`와 이후 test-only timing 교정을 구분한다. 제품 src diff는 BASE와 동일하다.

원자료는 문서 작업공간 `outputs/implementation/2026-10-05/task-11-measurements/`의 `latency-virtual-geometry-final/`, `geometry-final-provenance.json`, `geometry-final-lifecycle/`, `geometry-final-assets.json`, `geometry-final-noicons-*`, `geometry-day-diagnosis-summary.json`, `geometry-production-failure-snapshots.json`, `virtual-command-logs/geometry-*`다. 전체 명령·실패·진단 JSON 경로는 `virtual-task-10-report.md`에 기록했다. mobile은 실제 WebKit26.6, desktop/narrow는 Chromium이며 W1 PageUp/wheel을 유지했다. 실물 iPhone/Android touch·유효 Naver SDK·WebKit capture/paint는 미확인이다.

## 역사적 Task8 측정 (정상 grid 완료 인증 제외)

실제 gap80px·가로 clipping을 허용한 이전 helper 결과이며 정상 grid 완료 인증에 사용할 수 없다. 아래 원 수치와 FAIL은 그대로 보존한다.

측정 제품 BASE/HEAD는 `17f75231fe42291f13c9d710df2df690adacc675`다. Task7은 새 일정 host의 캐시가 0일 때 불필요한 scrollTop setter를 생략하며, 양수 복원과 사용자 위치 기록·cleanup, 범용 훅의 기본 동작을 유지한다. Task8 제품 코드는 추가 변경하지 않았다.

승인된 shared hardened endpoint와 같은 production fake·500곳/2일/하루 50방문·DOM capture 출발·완료 다음 RAF·각 군 5워밍업+30표본·390×844·Chromium 153.0.8010.12·CPU4x를 유지한 완전한 한 번의 실행으로 판정했다. Apple M4/macOS26.1(25B78)/Node22.18.0 환경이며 비용 context에는 counter/Profiler를 넣지 않았다. 원 LongTask duration과 p95≤200ms·군별 >100ms 작업 2개 미만 예산을 유지했다.

| **조작군** | **median ms** | **p95 ms** | **max ms** | **>100ms 수** | **판정** |
| :--- | ---: | ---: | ---: | ---: | :--- |
| 검색 | 27.95 | 37.7 | 43.8 | 0 | PASS |
| 필터 | 28.20 | 55.7 | 78.9 | 0 | PASS |
| 장소→일정 | 67.05 | 105.1 | 139.4 | 1 | PASS |
| 일정→장소 | 62.75 | 136.3 | 163.3 | 4 | FAIL |
| 장소→지도 | 120.05 | 147.8 | 152.9 | 0 | PASS |

**전체 상호작용 예산은 FAIL**이다. 모든 p95는 기준 안이고 장소→일정은 긴 작업 1건으로 기준 안이다. 일정→장소의 places6/7/8/9 원본 작업 start는 24531.8/25197.1/25821.1/26646.4ms, duration 121/103/151/124ms다. FunctionCall union 105.370/89.698/135.295/98.634ms, Layout 13.813/7.284/13.487/5.878ms, Paint 3.921/1.980/5.016/5.262ms다. 최대 개별 callback은 `index-_mqvaio7.js:9:136358` anonymous 95.167/85.499/126.722/90.100ms다. trace의 sample 구간에서 GC 이름의 duration X 이벤트는 관측되지 않았다. phase는 서로 겹칠 수 있으며 구체 제품 함수 원인을 확정하지 않는다. root의 별도 `latency-places-profile-final/`은 계측 overhead가 있는 진단 자료로 예산 판정에 포함하지 않는다.

스크롤 15회 wheel 500px/50ms 구간의 원본 LongTask는 1건(52ms),  >100ms 0건이다. 실물 touch/FPS 확인으로 해석하지 않는다.

| **항목** | **기준 gzip B** | **현재 gzip B** | **증가 B** | **판정** |
| :--- | ---: | ---: | ---: | :--- |
| 전체 JS | 276873 | 298815 | 21942 | PASS (20%·75KiB 이내) |
| 초기 JS, 세 뷰 각각 | 276873 | 298815 | 21942 | PASS (15%·50KiB 이내) |
| CSS | 0 | 0 | 0 | PASS (10KiB 이내) |
| 같은 HEAD 아이콘 제외→포함 | 297789 | 298815 | 1026 | PASS (10KiB 이내) |

초기 세 뷰 각각 문서1·JS3·여행JSON1, 외부 요청0, fake instance 장소/일정0·지도1이다. noicons는 같은 HEAD archive의 import10개만 제거한 사본이다. full CI 59파일/668테스트 PASS, tracked lint PASS, production 기존 가상화 9×3=27 PASS다. 20cycle 모두 RO2/targets4/events653/global8/tracked11/marker500/mapId1로 before/after와 정확히 같다. 전체 검증 뒤 fake build를 다시 복원했다.

native 첫 전체 실행은 **57 PASS/2 FAIL/3 조건부 skip, exit1**이었다. 기존 56개는 모두 PASS였고 새 일정 복원 사례의 default 3방문 fixture가 desktop/WebKit에서 스크롤하지 못했다. 새 사례만 50방문·49legs의 schema 검증된 데이터로 교정하고 WebKit 목록 내부 button focus→PageDown, Chromium wheel로 검증한 최종 focused 실행은 **3 PASS, exit0**다. 이것을 단일 전체 suite PASS로 합산하지 않는다. 50방문 교정 중 StopId/legs schema 실패와 Playwright의 기존 dayjs ESM import 오류, WebKit host div focus의 입력 실패도 별도 로그로 보존했다. assertion/timeout/제품/schema를 변경하지 않았다. 기존 W1 바닥 축소는 WebKit PageUp과 Chromium wheel을 유지했다.

측정 UTC `2026-10-05T02:05:30.268Z`, 제품 tree SHA256 `5ea84e127c177067a298f680140d00bf806448f4f8fae369107a9dbd3de7413b`, dirty diff SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`(빈 tracked diff), endpoint SHA256 `2fb7011b5fa8bd9ba91adde9d43983947c0b3ad207bd840ae0e8e9d3829c9fb4`, harness SHA256 `73f1258cbdfbfa2497a38eccaa5ae7e372739b9e106819415d054777591de6d2`다. before/다섯 군 during/after 소스와 metadata 일치를 확인했다. 측정 이후 native test와 문서 변경은 원 측정 patch/hash와 구분한다. 원 Task4·강화 후속 FAIL 및 별도 진단 수치는 기존 역사적 기록에 남긴다.

원자료는 문서 작업공간 `outputs/implementation/2026-10-05/task-11-measurements/`의 `latency-virtual-final/`, `final-lifecycle/`, `final-assets.json`, `final-noicons-assets.json`, `final-provenance-verification.json`, `virtual-command-logs/final-*`다. 전체 명령/실패 이력은 `virtual-task-8-report.md`에 기록한다. 실제 mobile 엔진은 WebKit 26.6이며 실물 iPhone/Android·유효 Naver·WebKit capture/paint 제한은 계속 미확인이다.

## 역사적 Task4 강화 완료 조건 후 측정

측정 제품 HEAD는 `79c0bd0692b4c7e54be89836bdc523be9c2ce8aa`다. 승인된 viewport snapshot 캐시와 retained content memo를 포함한다. Task4 후속 작업은 측정 helper와 문서만 변경했으며 제품 코드를 추가로 바꾸지 않았다. 원래 Task4 결과와 실패 trace는 아래 역사적 기록 및 별도 artifact에 보존했다.

독립 검토 Warning1의 반례(host 390×844, x=500..600인 카드)는 이전 완료 조건에서 잘못 통과했다. shared predicate는 양수 2D 교차, 정확한 row key slice·이름·순서·track 위치, 연속 행과 gap/overlap, viewport 위·아래 coverage 및 초기 row0을 검사한다. grid는 실제 2열/gap10, list는 실제 1열/gap0으로 수집한다. map peek의 목록이 host 아래인 정상 상태만 별도 제외한다. Node 반례 RED 1건을 확인한 뒤 18개 사례 GREEN, Chromium/WebKit DOM 12개 사례 및 실제 제품 grid/list/map peek·half·full 10개 사례를 확인했다. 예산·assertion·timeout은 완화하지 않았다.

Apple M4·macOS 26.1(25B78)·Node v22.18.0·Chromium 153.0.8010.12·390×844·CPU4x, production fake, 500곳/2일/하루50방문, 각 군 워밍업5+표본30이다. DOM capture 출발과 완료 후 다음 RAF를 유지했다. 비용 context에 구독 counter/Profiler를 넣지 않았다. sample과 겹친 LongTask의 원본 duration을 사용한다.

| **조작군** | **median ms** | **p95 ms** | **max ms** | **>100ms 수** | **판정** |
| :--- | ---: | ---: | ---: | ---: | :--- |
| 검색 | 23.85 | 33.0 | 34.0 | 0 | PASS |
| 필터 | 27.55 | 40.3 | 42.2 | 0 | PASS |
| 장소→일정 | 81.55 | 112.4 | 167.3 | 3 | FAIL |
| 일정→장소 | 40.65 | 48.8 | 49.9 | 0 | PASS |
| 장소→지도 | 107.50 | 149.7 | 150.0 | 0 | PASS |

**전체 상호작용 예산은 FAIL**이다. p95≤200ms는 충족하지만 조작군별 >100ms 작업 2개 미만 조건을 장소→일정이 충족하지 못했다. day5/17/19 원본 duration은 101/160/104ms다. 해당 trace의 FunctionCall union은 92.010/152.704/95.976ms, Layout은 9.364/16.717/9.014ms, Paint는 2.085/2.891/2.594ms다. React microtask flush의 개별 FunctionCall은 89.411/145.748/90.471ms이고 Layout의 dirtyObjects713/total754가 관측됐다. phase는 겹칠 수 있다. 원 trace에는 실제 JS 함수 호출 스택/CPU Profile이 없어 특정 제품 함수나 날짜 Timeline 원인으로 확정하지 않는다. 15회 wheel(500px, 50ms 간격)의 원본 LongTask는 0건이다. 실물 touch 품질이나 FPS 판정은 아니다.

| **항목** | **기준 gzip B** | **최종 gzip B** | **증가 B** | **판정** |
| :--- | ---: | ---: | ---: | :--- |
| 전체 JS | 276873 | 298763 | 21890 | PASS (20%·75KiB 이내) |
| 초기 JS, 세 뷰 각각 | 276873 | 298763 | 21890 | PASS (15%·50KiB 이내) |
| CSS | 0 | 0 | 0 | PASS (10KiB 이내) |
| 같은 HEAD의 아이콘 제외→포함 | 297738 | 298763 | 1025 | PASS (10KiB 이내) |

초기 세 뷰마다 문서1·JS3·여행JSON1의 5요청, 외부 요청0, fake map instance 장소/일정0·지도1이다. noicons는 같은 HEAD archive에서 정적 import10개만 제거한 별도 사본이다. CI는 `VITEST_MAX_WORKERS=2 yarn build:ci` 59파일/664테스트 PASS, tracked ESLint PASS, 전체 native56 PASS/3 조건부 skip, production 신규9×3=27 PASS다. 모바일 엔진은 실제 WebKit26.6, desktop/narrow는 Chromium이며 W1은 각각 PageUp/wheel이다. 기존 5폭 CSS 및 60↔61·바닥 축소·복원 검사를 유지했다.

별도 counter context의 20회 모두 before/after와 동일했다: RO2/targets4, 연결 event653/global8/tracked11, marker click500, mapId1. 증가 허용치를 두지 않았다.

측정 시작 UTC `2026-10-05T01:36:35.164Z`. 제품 tree SHA256 `3dae125916ab6c56dee7b2e3c037190fa6652e6a64f0e4a41c40b5e1859f963e`, 측정 dirty diff SHA256 `7e9266033b527088a54779825d152caaa89f5e3cd0cd16b32231a6be59991511`, helper SHA256 `2fb7011b5fa8bd9ba91adde9d43983947c0b3ad207bd840ae0e8e9d3829c9fb4`, harness SHA256 `6c30891e1b7960c1ec3efea7a701b10f27321a1147c8e4216e299c14944ded90`다. 측정 전·다섯 군 도중·후 제품 source와 metadata가 일치한다. 문서 작업공간 `outputs/implementation/2026-10-05/task-11-measurements/`의 `latency-virtual-hardened/`, `hardened-lifecycle/`, `hardened-assets.json`, `hardened-noicons-assets.json`, `hardened-provenance-verification.json`, `virtual-command-logs/followup-*`가 원자료다. 전체 명령과 독립 검토 대응은 `virtual-task-4-followup-report.md`에 기록했다.

실물 iPhone/Android·유효 Naver SDK·WebKit 캡처/paint 제한은 미확인 상태를 유지한다.

## 역사적 첫 가상화 측정 (Warning1 완료 조건 약점)

이 기록의 위치 완료 조건은 독립 검토 Warning1에서 약점이 확인되어 강화 검증의 근거로 사용하지 않는다. 수치와 당시 FAIL은 그대로 보존한다. 제품 소스는 `d2a45831ea6e29d91947ef94f2dec5b0d8ac95ab`이며, 아래 Task11 기록은 역사적 FAIL snapshot이다. 이번 측정 시 테스트와 실행계획 문서가 수정된 상태의 diff SHA256은 `3bc7684f01f5f102d5033696ac9946f1125711cda4208ebcd7fe4f643a514184`, 테스트 SHA256은 `84968a91a2003f1c2222b61c9929b544162c0646c2f801f9b9e7bb7fb63b1d0a`이다. 전체 source hash는 `f05098a860805b25b978a1cb61c79b404230ba7340f6c137c2adfc6a9579da08`이고 측정 patch와 metadata를 보존했다. 실제 제품 코드는 측정 전후 동일하다. 측정 시작 UTC: `2026-10-04T23:58:58.104Z`.

기존과 같은 Apple M4·macOS 26.1(25B78)·Node v22.18.0·Chromium 153.0.8010.12·390×844·CPU 4배, production fake, fixture500곳/2일/하루50방문, 각 조작 워밍업5+표본30을 사용했다. native 모바일 프로젝트는 실제 WebKit 26.6이다. 비용 context에는 observer/listener counter patch를 넣지 않았다. 시작은 DOM input/click capture이며, 끝은 전체 결과수·host viewport와 교차하는 key/이름/순서/위치를 확인한 다음 RAF다. 지도에서는 500 marker와 목록 위치도 확인한다. MUI Chip은 div role=button이므로 실제 역할을 포함해 카테고리 선택을 확인했다. 원래 >100ms LongTask를 sample과 겹치는 원본 duration으로 중복 제거하며 clip해서 낮추지 않는다.

| **조작군** | **기존 p95 ms / >100ms 수** | **가상화 median ms** | **가상화 p95 ms** | **max ms** | **>100ms 수** | **판정** |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| 검색 | 388.5 / 16 | 28.6 | 43.0 | 51.0 | 0 | PASS |
| 카테고리 필터 | 421.8 / 30 | 28.9 | 57.8 | 61.4 | 0 | PASS |
| 장소→일정 | 139.9 / 5 | 65.6 | 107.0 | 112.3 | 0 | PASS |
| 일정→장소 | 559.2 / 30 | 41.1 | 76.7 | 97.8 | 0 | PASS |
| 장소→지도 | 515.9 / 31 | 57.2 | 139.4 | 146.2 | 2 | 긴 작업 FAIL |

**전체 상호작용 예산은 FAIL**이다. 다섯 p95는 200ms 이하이지만 장소→지도에 100ms 초과 작업이 2건 있으므로 기존의 조작군별 2개 미만 기준을 충족하지 않는다. `map-32`의 원본 LongTask는 138ms, `map-34`는 115ms다. 각 sample의 trace union에서 FunctionCall은 116.17/100.79ms, Layout은 49.34/31.75ms, Paint는 11.13/20.21ms이다. 다른 phase는 겹칠 수 있어 합산하지 않는다. 지도 복귀의 렌더/레이아웃/paint가 남은 비용이라는 추론이며, 특정 함수나 실 SDK 비용으로 확정하지 않는다. 예산·timeout·LongTask 조건은 완화하지 않았다.

15회 wheel(500px, 50ms 간격) 스크롤 구간에는 원본 LongTask 17건, >100ms 3건(120/142/127ms)이 있었다. 이전 full-mount 스크롤 snapshot의 0건과 차이가 있다. 가상 행의 반복 mount/측정 비용이 잔여 위험이라는 추론이며 FPS나 실물 touch 품질을 PASS로 선언하지 않는다.

| **자산 항목** | **기준 gzip B** | **현재 gzip B** | **증가 B** | **판정** |
| :--- | ---: | ---: | ---: | :--- |
| 전체 JS | 276873 | 298674 | 21801 | PASS (+7.8740%, 20%·75KiB 이내) |
| 초기 JS, 세 뷰 각각 | 276873 | 298674 | 21801 | PASS (15%·50KiB 이내) |
| CSS | 0 | 0 | 0 | PASS (10KiB 이내) |
| 아이콘만 | 297644 | 298674 | 1030 | PASS (10KiB 이내) |

자산 판정은 baseline/current/noicons JSON의 실제 gzipBytes로 계산했다. 초기 각 뷰는 문서1·JS3·여행 JSON1의 5요청, 외부 요청0이며 fake 지도 instance는 장소/일정0·지도1이다. icon 제외 사본은 같은 제품 HEAD git archive에서 정적 import10개만 제거했고 측정 제품 source로 쓰지 않았다.

전체 CI는 `VITEST_MAX_WORKERS=2 yarn build:ci`로 57파일/654테스트 PASS다. 현재 native E2E는 views51 PASS/3 조건부 skip 및 나머지 일정·동시저장·공유5 PASS(합계56 PASS/3 skip), production 신규회귀27 PASS다. 단일 결과 auto-fit의 실제 grid 양수 track1 assertion 추가 후 500곳 target을 native/production 각각3 PASS로 확인했다. 320/390/768/900/1280px CSS 열 수 비교, 가변높이·60↔61·연속 content anchor·선택 우선·바닥 content 축소 후 RAF 종료를 포함한다. W1 사용자 입력은 WebKit PageUp, desktop/narrow Chromium wheel이다.

별도 counter context에서 동일 day settled 상태로 장소→지도→일정20회 후 RO2/targets4, 연결된 event653/global8, scroll·scrollend·resize·change11, marker click500과 mapId1이 처음과 완전히 같았다. native/production cleanup 테스트도 증가 허용치 없이 통과했다.

문서 workspace `outputs/implementation/2026-10-05/task-11-measurements/`의 `latency-virtual/`(raw5+30·metadata·fixture·network·trace·phase·measured diff), `virtual-lifecycle/`, `virtual-assets.json`, `virtual-noicons-assets.json`, `virtual-command-logs/`, `virtual-provenance-verification.json`이 근거다. 초기 contract RED와 Chip/category selector harness 실패, 단일 CSS wrapper selector 오류·중단 후 port 잔존 오류도 별도 artifact로 보존했고 제품/예산 FAIL과 구분했다. 계약 RED는 e6b52fd 사본에서 새 endpoint 부재에 따른 deadline 실패이며 새로운 지연 수치가 아니다.

실물 iPhone/Android·touch momentum·유효 Naver SDK 및 기존 WebKit capture/paint 제한은 계속 미확인이다.

## Task11 및 이후 수정의 역사적 기록

## 범위와 환경

확인일: 2026-10-05 KST. 최종 지연 측정 시작: 06:11:36.591 KST. 확인자: Codex 구현 담당자. 비교 기준은 `3b36bdd9f1325f6c2264bdbd0e115d5f003c79f1`, 최종 검증 소스는 `b0e2199fcb36eeb43e07a39d8713b3b92557fb35`이다. Task 11 변경 전 소스는 `2b65f9afc1c71aa510211d102f824d1c534706c2`다.

동일한 macOS 26.1(25B78), Apple M4, Node v22.18.0, Yarn 1.22.22에서 `VITE_MAP_ADAPTER=fake yarn build`를 비교했다. 저장소가 권장하는 Node 24는 이 환경에 설치되어 있지 않았다. production dist를 로컬 정적 preview로 제공했고 source map은 측정에서 제외했다. Chromium 실제 버전은 153.0.8010.12, viewport는 **390×844**, CDP CPU 제한은 **4배**다. 이는 desktop Chromium 측정이며 실물 모바일 성능 수치가 아니다. WebKit CPU 제한은 가정하지 않는다.

초기 네트워크는 기준과 변경본 모두 기존 `tests/fixtures/trips/e2e.json`의 **42개 장소**를 사용한다. 상호작용은 별도의 메모리 응답으로 **500개 장소, 날짜 2개·하루 50개 방문**을 제공한다. 공개 fixture·schema·pipeline·`.env`는 변경하지 않았다. 아이콘 제거 측정은 같은 최종 UI 소스의 일반 git archive 사본에서 `~icons/mdi` 정적 import만 빈 컴포넌트로 대체했다. 브랜치 reset이나 worktree 생성은 하지 않았다.

## 다운로드 예산

KiB는 1024바이트다. CSS는 Emotion이 JS에서 처리하므로 별도 CSS chunk가 0바이트여도 스타일 처리 비용까지 0이라는 의미는 아니다.

| **항목** | **기준 gzip B** | **최종 gzip B** | **증가 B / KiB** | **예산** | **판정** |
| :--- | ---: | ---: | ---: | :--- | :--- |
| 전체 dist JS | 276873 | 287463 | 10590 / 10.34 | +20% 이내 및 +75KiB 이하 | PASS, +3.8249% |
| 전체 dist CSS | 0 | 0 | 0 / 0 | +10KiB 이하 | PASS |
| 초기 진입 JS/CSS, 지도·일정·장소 각각 | 276873 | 287463 | 10590 / 10.34 | +15% 이내 및 +50KiB 이하 | PASS, +3.8249% |
| 같은 최종 UI의 MDI 아이콘만 | 아이콘 제외 286547 | 포함 287463 | 916 / 0.89 | +10KiB 이하 | PASS |

| **청크 역할** | **기준 파일** | **기준 원본 B / gzip B** | **최종 파일** | **최종 원본 B / gzip B** |
| :--- | :--- | ---: | :--- | ---: |
| 진입 | `index-CEN34d6m.js` | 468262 / 147291 | `index-CzaxAZcT.js` | 468525 / 147382 |
| 여행 UI | `TripPage-CFpGkKes.js` | 413723 / 129214 | `TripPage-CPKuyEsu.js` | 444773 / 139713 |
| 런타임 | `rolldown-runtime-CbXtAM7H.js` | 589 / 368 | `rolldown-runtime-CbXtAM7H.js` | 589 / 368 |

위 세 파일은 전체 dist 합이면서 이번 여행 초기 진입에서 실제 요청한 파일 목록이기도 하다. 다른 코드 분할 구조에서는 전체 합과 초기 합이 같다고 가정하면 안 된다. 개발용 MDI 컬렉션 전체의 설치 크기를 사용자 다운로드로 계산하지 않았다. 최적화 전의 287421바이트·아이콘 911바이트는 중간 기록이며 최종 판정에 쓰지 않는다.

재현:

```bash
VITE_MAP_ADAPTER=fake yarn build
node scripts/measure-ui-assets.mjs dist/assets
node scripts/measure-ui-assets.mjs /path/to/baseline-fake-dist/assets
```

## 초기 요청과 지도 SDK

fake production 초기 지도·일정·장소는 각각 문서 1개, 위 JS 청크 3개, 여행 JSON 1개만 요청했다. 아이콘·이모지·사진 때문에 생긴 외부 요청은 **0회(PASS)**다. fake adapter의 SDK 요청 0회를 실제 Naver 로더 검증으로 취급하지 않는다.

SDK 요청 측정은 최적화 전 `2b65f9a`의 별도 Naver production 사본에서 수행했다. 이후 변경은 비활성 필터·마커 계산에 한정되며 MapView/SDK 로더는 수정하지 않았다. 이 사본에 비밀이 아닌 `measurement-placeholder` Client ID를 환경변수로 전달하고 SDK route를 abort했다. 장소·모바일 일정의 초기 SDK 요청은 각각 **0회**, 첫 지도 전환에서 **요청 시도 1회**, 오류 후 재진입에서도 누적 **1회**였다. 초기 숨김과 지연 요청 계약은 PASS이며, route abort에 따른 실패 UI도 확인했다. **성공적인 SDK 로드·실제 타일·지도 품질은 미실행**이다. 외부 SDK 스크립트·타일의 다운로드 크기는 제공하지 않은 유효 키로 추정하지 않는다. 기존 map lifecycle 단위 테스트와 빈 키 Naver E2E는 각각 mock/키 없음 계약을 검증한다.

## 상호작용 예산과 경계

최초 로드 완료 뒤 날짜 1(50개 방문)을 선택했다. 조작마다 **워밍업 5회 후 샘플 30회**를 별도로 수집했다. median은 정렬된 15·16번째의 평균, p95는 nearest-rank의 29번째, max는 최대값이다.

시작은 Playwright 호출 시간이 아니라 실제 대상 DOM의 `input`/`click` **capture 핸들러 시작**이다. React의 delegated handler 직전부터 event dispatch 비용을 포함하는 보수적 경계다. 검색은 99↔500개 카드, 카테고리 필터는 250↔500개 카드, 일정은 50개 방문 행, 장소는 500개 카드, 지도는 500개 fake marker와 선택 뷰를 확인하고 **그 결과를 확인한 다음 animation frame**에서 종료했다. nav 선택 버튼만 바뀐 시점에는 종료하지 않았다. frame 관찰은 자동화 기준이며 실제 기기의 paint/조작감 확인을 대체하지 않는다.

| **조작군** | **최적화 전 p95 ms** | **최종 median ms** | **최종 p95 ms** | **최종 max ms** | **100ms 초과 LongTask 수** | **판정** |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| 검색 | 385.5 | 209.6 | 388.5 | 426.9 | 16 | 지연 FAIL / 긴 작업 FAIL |
| 카테고리 필터 | 356.3 | 240.0 | 421.8 | 431.3 | 30 | 지연 FAIL / 긴 작업 FAIL |
| 장소→일정 | 118.4 | 75.4 | 139.9 | 161.0 | 5 | 지연 PASS / 긴 작업 FAIL |
| 일정→장소 | 592.7 | 403.8 | 559.2 | 594.9 | 30 | 지연 FAIL / 긴 작업 FAIL |
| 장소→지도 | 554.0 | 360.2 | 515.9 | 518.4 | 31 | 지연 FAIL / 긴 작업 FAIL |

지연 예산은 조작별 p95 **200ms 이하**, 긴 작업 예산은 동일 조작군에 원래 duration **100ms 초과 작업이 2회 미만**이다. **전체 상호작용 예산은 FAIL**이다. 워밍업은 판정에서 제외했다. LongTask는 `startTime <= sampleEnd && startTime + duration > sampleStart`로 구간과 겹치는 원본 entry를 포함하고 `startTime/duration/name`으로 중복 제거했다. DOM capture 전에 시작된 입력 task도 포함하며, duration을 sample 경계에 잘라 100ms 미만으로 낮추지 않았다.

지연 측정에는 event/observer 수명 계수 패치를 넣지 않았다. 수명 패치가 들어간 초기 수치는 GC 영향이 가능한 중간 자료로 분리했다. React private props를 직접 감싸려던 첫 계측은 callback 시작을 잡지 못해 timeout됐으므로 결과로 사용하지 않았다. fixture·날짜 selector·계수 hook 교정 중의 실패 실행도 원본 로그로 남겼으며 PASS로 표시하지 않았다.

## 최소 개선과 남은 병목

실측 후 `useExploreKeys`에 기본값 true의 enabled 조건을 추가하고 `useExploreMarkers`만 지도·탐색 모드에서 활성화했다. 장소 화면에서 검색할 때 숨긴 지도용 필터·마커 계산을 하지 않으며, 지도 복귀 시 현재 필터와 선택을 반영한다. 신규 2개 테스트의 예상 RED 후 관련 hook·map lifecycle·PlacesPanel **49개 GREEN**, 타입·ESLint를 확인했다. 카메라 key, 선택과 pending marker scroll, 메모 초안·편집 스키마 계약을 유지했다.

최소 개선 후에도 모든 조작군의 반복 긴 작업과 4개 조작군의 p95가 예산을 넘는다. 측정 간 변동이 있으므로 작은 수치 차이를 개선 효과로 단정하지 않는다. trace의 최악 샘플에서 FunctionCall 구간은 검색 337.7ms, 필터 312.9ms, 장소 진입 492.4ms, 지도 진입 482.9ms이고 Layout은 각각 40.3/41.1/55.7/56.1ms였다. 같은 phase는 구간 union으로 중첩을 제거하고 sample 범위에 clip했지만, **서로 다른 phase는 겹칠 수 있어 합산하지 않는다**. 이는 LongTask 원본 duration 판정과 별도 분석이다.

500개 카드/목록의 전체 mount와 fake 지도 500개 marker DOM 처리가 주요 잔여 비용으로 추론된다. 실 SDK의 실제 비용을 이 숫자로 확정하지 않는다. 새 전략을 임의 도입하지 않았다. 선택 가능한 후속 절충안은 다음과 같다.

- 가변 높이 카드·목록의 화면 범위 렌더: 표시 DOM을 줄일 수 있으나 선택된 장소의 scroll 대상, trip/view별 스크롤 복원, 긴 메모·날짜 chip 높이, 키보드 이동을 별도로 설계·회귀 검증해야 한다.
- 페이지화/더보기: 처음 표시하는 장소 수를 줄일 수 있으나 현재 전체 검색 결과의 탐색과 빠른 추가 흐름이 바뀐다.
- 현재 동작 유지: 500개 stress 데이터의 지연·반복 긴 작업 FAIL을 수용하는 결정이 필요하다. 예산을 상향하거나 FAIL을 PASS로 변경하지 않았다.

15회 휠 입력(회당 500px, 50ms 간격)의 스크롤 trace에는 50ms 초과 LongTask와 100ms 초과 반복 작업이 없었다. FPS 통과 수치를 계산하거나 실제 엄지 조작감을 PASS로 보고하지 않는다.

## 20회 순환과 최종 검증

수명 계수는 지연 측정과 분리한 context에서 지도→일정→장소→지도를 20회 순환했다. 실제 Naver SDK의 구독 수가 아니라 fake instance, 연결된 DOM·window/document 이벤트 등록과 ResizeObserver target을 계수한다. heap 수치는 수집하지 않았으며 통과 근거로 사용하지 않았다.

| **항목** | **순환 전** | **20회 후** | **판정** |
| :--- | ---: | ---: | :--- |
| ResizeObserver | 2 | 2 | PASS |
| 관찰 target | 2 | 2 | PASS |
| 연결된 DOM 이벤트 | 650 | 650 | PASS |
| window/document 이벤트 | 6 | 6 | PASS |
| marker click 이벤트 | 500 | 500 | PASS |

지도 instance ID는 `1`에서 `1`로 유지됐고, 20개 각 순환의 계수도 기준 수로 복귀했다. 수명 예산은 PASS다.

| **순서 / 명령** | **결과** |
| :--- | :--- |
| `yarn lint --ignore-pattern inspect-mobile.mjs --ignore-pattern verify-concepts.mjs` | PASS; 기존 미추적 scratch 두 파일만 제외 |
| `yarn typecheck` | PASS |
| `yarn test --maxWorkers=2` | 635 PASS / 54개 파일 |
| `yarn validate` | PASS; sandbox tsx IPC EPERM 후 승인된 단독 재실행 |
| `VITE_MAP_ADAPTER=fake yarn build` | PASS; 최종 산출물이 측정 산출물과 byte/gzip 동일 |
| `CI=1 yarn test:e2e` | 29 PASS / OS 조건 3 skip, 1.4분; desktop/mobile/narrow-mobile |
| `git diff --check` | PASS |

전체 검증은 브라우저 측정 종료 후 순차로 1회 실행했고 unit worker는 2개로 제한했다. 이전 Task 9f/10의 기본 다수 worker·브라우저 동시 부하 실패를 이번 PASS로 덮지 않으며, assertion·timeout을 올리거나 테스트를 삭제하지 않았다.

## 원시 근거와 재현 자료

원시 자료는 앱 저장소 밖의 문서 작업공간 `outputs/implementation/2026-10-05/task-11-measurements/`에 보존했다.

- `baseline-assets.json`, `baseline-initial-assets.json`, `optimized-assets.json`, `noicons-optimized-assets.json`, `environment.json`: 크기·환경 근거.
- `latency-optimized/initial-network.json`: 최종 42곳 fixture 초기 청크·요청 목록.
- `latency-unpatched/`와 `latency-optimized/`: 최소 개선 전/후의 counter 패치 없는 raw 5+30회 samples, LongTask, scroll, Chromium trace, phase 분석.
- `subscriptions-isolated/interactions.json`: 샘플 capture 없는 전용 20회 수명 계수.
- `sdk-network.json`: Naver placeholder의 0/1/1 요청과 abort 구분.
- `measure-latency.cjs`, `measure-latency-optimized.cjs`, `measure-subscriptions.cjs`, `measure-sdk.cjs`, `analyze-trace.cjs`, `reproduce-copies.sh`: 재현 스크립트. 로컬 5198/5199만 제공하며 외부 SDK는 abort한다.
- `test-assets.cjs`, `script-red.log`, `script-green.log`, `marker-red.log`, `marker-green.log`, `final-*.log`: script·TDD·최종 검증 근거.

실물 iPhone Safari/Android Chrome, 유효 키 Naver SDK, 미확정 WebKit capture/paint는 [별도 기기 확인 기록](ui-device-checks.md)에 미실행/미확인으로 남겼다. 자동화 성공으로 이를 실제 기능 정상이라고 확정하지 않는다.


## W1/W2 수정 후 검증과 자산 크기

2026-10-05의 후속 검증이다. 위 지연·초기 요청·아이콘 제외·20회 수명 수치는 `b0e2199fcb36eeb43e07a39d8713b3b92557fb35` 시점의 역사적 측정으로 유지한다. 이번 측정 소스는 `94e4469daf2655aa851f5443b8cee11e1c3daded` 기반 W1/W2 수정 커밋 `9b595a641e9fc5bde327822d874eeefab7c964db`다. 측정 당시 제품 파일의 Git blob은 `DetailSurface.tsx`가 `2b1ee8bb39ad20114b3cdbbd6281e508304c8552`, `StopEditPanel.tsx`가 `f2257501309c24b8673df025dfb95dc8c298dbbd`다.

`VITEST_MAX_WORKERS=2 VITE_MAP_ADAPTER=fake yarn build:ci`로 validate·typecheck·전체 unit **645/54파일 PASS**·production build를 한 번 검증했다. sandbox의 tsx 로컬 IPC EPERM으로 unit 시작 전 중단된 최초 시도 뒤 동일 명령을 필요한 권한으로 실행했다. 자산은 `node scripts/measure-ui-assets.mjs dist/assets`의 gzip 결과를 그대로 기록했다.

| **파일** | **원본 B** | **gzip B** |
| :--- | ---: | ---: |
| `TripPage-BDSi0ucx.js` | 445060 | 139806 |
| `index-CwFO9GB_.js` | 468525 | 147378 |
| `rolldown-runtime-CbXtAM7H.js` | 589 | 368 |
| 전체 JS | 914174 | 287552 |
| 전체 CSS | 0 | 0 |

JS gzip 합은 이전 역사적 측정의 287463B보다 **89B 증가**했고 기준 276873B보다 **10679B 증가**했다. 전체 dist JS 다운로드 예산은 유지한다. 이번에는 초기 진입 네트워크·아이콘 제외 build·stress 지연·수명을 재측정하지 않았으므로 이 자산 합을 새 초기 요청이나 새 아이콘 비용으로 해석하지 않는다. W3 상호작용 예산 FAIL은 여전히 사용자 결정 대기다.


### 같은 방문 재개방 초안 보호 후속 검증

위 9b595a6 검증 이후 W1의 동일 방문 재개방 초안 정리 guard를 보완했다. 이 측정은 `9b595a641e9fc5bde327822d874eeefab7c964db` 기반 후속 fix 커밋의 제품 소스이며, `StopEditPanel.tsx` Git blob은 `edc9e4da31f657e6510fc165976b073c1ed07fc5`다. `DetailSurface.tsx` blob은 위와 동일하다.

`VITEST_MAX_WORKERS=2 VITE_MAP_ADAPTER=fake yarn build:ci`는 validate·typecheck·전체 unit **645/54파일 PASS**·production build PASS(38.37초)다. 후속 소스의 전체 unit은 한 번 실행했다. `node scripts/measure-ui-assets.mjs dist/assets`로 다시 자산을 한 번 측정했다.

| **파일** | **원본 B** | **gzip B** |
| :--- | ---: | ---: |
| `TripPage-DBJb6aMh.js` | 445138 | 139833 |
| `index-BuUJ-u9y.js` | 468525 | 147380 |
| `rolldown-runtime-CbXtAM7H.js` | 589 | 368 |
| 전체 JS | 914252 | 287581 |
| 전체 CSS | 0 | 0 |

JS gzip은 직전 fix 287552B보다 **29B**, 역사적 b0e2199 측정 287463B보다 **118B**, 기준 276873B보다 **10708B** 증가했다. 전체 dist JS 다운로드 예산은 유지한다. 후속 자산 측정을 초기 요청·아이콘 제외·지연·수명 재측정으로 해석하지 않는다. 역사적 latency snapshot과 W3 FAIL은 그대로다.


## 2026-10-08 v2 하위 프로젝트 1

장소 보관함 v2(스펙 §8)의 번들 전후 비교다. 옛 탐색·뷰 화면, `@iconify-json/mdi`, 옛 green 테마를 지운 뒤 같은 방법으로 다시 쟀다. 전(before)은 Task 1에서 `.cache/bundle-before.json`에 남긴 기준선이고, 후(after)는 Task 17의 `.cache/bundle-after.json`이다. `.cache/`는 git에 올리지 않는다.

측정 명령(후):

```bash
VITE_MAP_ADAPTER=fake yarn build
node scripts/measure-ui-assets.mjs dist/assets > .cache/bundle-after.json
```

| **구분** | **전 원본 B** | **전 gzip B** | **후 원본 B** | **후 gzip B** | **gzip 차이 B** |
| :--- | ---: | ---: | ---: | ---: | ---: |
| JS | 1004167 | 316323 | 933064 | 295954 | -20369 |
| CSS | 0 | 0 | 170717 | 57243 | +57243 |
| **합계** | 1004167 | 316323 | 1103781 | 353197 | **+36874** |

| **파일(후)** | **원본 B** | **gzip B** |
| :--- | ---: | ---: |
| `index-B2qdjfer.js` | 933064 | 295954 |
| `index-NPFyShNs.css` | 48159 | 13685 |
| `400-CvrIouJK.css` | 58594 | 19804 |
| `700-wCuVfu9R.css` | 63964 | 23754 |

읽는 법:

- **JS는 gzip 20369B 줄었다**(316323B → 295954B). 옛 `TripPage` 청크(168654B)와 MDI 아이콘이 빠지고, 새 화면(보관함·지도·라벨·설정·가져오기)과 Effect 런타임이 들어왔다. 옛 `TripPage` 지연 로드 청크는 없어졌고 라우트는 한 `index` 청크에 묶여 있다.
- **합계는 gzip 36874B 늘었다.** 늘어난 것은 전부 CSS다. 기준선 때는 CSS가 0이었고, 이번에는 본문 글꼴 Pretendard의 부분 집합 CSS(`index` 청크 쪽)와 수첩 테마 제목 글꼴 고운바탕의 `@font-face` CSS(`400`·`700`)가 dist에 들어온다. 이 CSS는 글자 범위(`unicode-range`)별 선언이라 브라우저는 화면에 쓰는 범위의 `.woff2`만 내려받는다. 폰트 파일은 이 측정 대상이 아니다(스크립트가 `.js`·`.css`만 센다). 고운바탕 CSS는 수첩 테마를 고를 때만 지연 로드된다(`src/theme/fonts.ts`).
- 초기 진입 네트워크·상호작용 지연·수명은 이번에 다시 재지 않았다. 위 수치를 그런 값으로 해석하지 않는다.
