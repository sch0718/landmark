> **옛 화면 문서 — v2에서 대체됨.** 이 문서가 설명하는 `useViewQuerySync`·`useUrlPlaceDetailSync`와 일정·탐색 뷰는 v2(장소 보관함)에서 삭제됐습니다. 현재 라우팅은 `src/routes/paths.ts`와 `src/sections/shell/AppShell.tsx`를 보세요. 아래 내용은 기록으로만 보존합니다.

# URL·뷰·상세 동기화

`useViewQuerySync`는 URL과 뷰·날짜·선택 atom을 양방향으로 동기화한다. `useUrlPlaceDetailSync`는 URL의 장소를 상세 화면에 반영한다. 상세를 X로 닫아도 선택 atom과 URL은 유지한다.

## 쿼리 상태

`useViewQuerySync`의 `last`는 현재 여행·로드·원본 snapshot의 `session`과 다음 값을 보관한다.

| **값**        | **역할**                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| `url`         | React가 확인한 확정 URL. 요청만 한 URL로 미리 바꾸지 않는다.             |
| `locationKey` | 확정 탐색의 식별값. 외부 이동은 쿼리 문자열이 같아도 새로 처리한다.      |
| `pendingUrl`  | 마지막 UI 변경으로 요청한 REPLACE의 목적지.                              |
| `state`       | 마지막으로 URL에서 해석하거나 URL 쓰기로 요청한 atom 상태.               |
| `atoms`       | 직전 effect에서 관측한 atom 상태. 적용 직후의 재진입·중복 쓰기를 막는다. |
| `dates`       | 날짜 배열의 직렬화 값. 날짜가 바뀌면 URL을 다시 해석한다.                |

자신의 URL 쓰기 완료로 인정하려면 `pendingUrl`, REPLACE 탐색, `location.state.tripMapUiQuery`가 현재 쿼리와 모두 일치해야 한다. 마커만 같거나 외부 PUSH/POP인 경우는 외부 탐색으로 처리한다.

| **입력**                             | **쿼리 처리**                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| 여행이 없거나 로드가 준비되지 않음   | `last`와 준비 토큰을 초기화한다.                                                         |
| 여행·로드·원본 snapshot 교체         | 이전 세션을 버리고 URL을 다시 해석한다. ReadyTrip은 토큰이 새 세션과 일치할 때 표시한다. |
| 첫 진입·외부 URL/탐색 변경·날짜 변경 | URL을 atom에 적용한다. 뷰·날짜가 달라지면 일정 편집을 종료한다.                          |
| 자신의 대기 중 URL 쓰기 완료         | 확정 URL·탐색 식별값만 갱신한다. 대기 중 바뀐 최신 atom은 덮어쓰지 않는다.               |
| 새 UI atom 변경                      | 새 쿼리를 REPLACE하고 목적지를 `pendingUrl`로 기록한다.                                  |
| 같은 atom의 재렌더                   | URL을 다시 쓰지 않는다.                                                                  |

## 장소 상세 상태

`lastHandledUrlPlace`는 처리한 여행·로드·장소·탐색을 기록한다. `suppressed`는 X 닫기로 억제한 UI 쓰기, `invalidTrip`은 존재하지 않는 장소를 정리한 원본 snapshot이다. `dismissedPlace`는 URL 반영 전에 닫힌 장소를 기록한다.

| **입력**                                     | **상세 처리**                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 준비되지 않은 세션                           | 처리 기록·닫힌 장소를 초기화하고 상세를 닫는다.                                                      |
| 존재하지 않는 URL 장소                       | 선택과 장소/추가 상세를 정리한다. 같은 snapshot·탐색의 재렌더에서는 새 UI 선택을 다시 지우지 않는다. |
| UI 마커가 있는 URL의 장소가 최신 선택과 다름 | 오래된 UI 쓰기로 보고 상세에 적용하지 않는다.                                                        |
| 이미 처리한 장소의 재렌더                    | X 닫기 이후에도 상세를 다시 열지 않는다.                                                             |
| URL 반영 전에 X로 닫은 장소의 UI 쓰기 완료   | 억제한 탐색을 기록하고 닫힌 상태를 유지한다.                                                         |
| 새 URL 장소 또는 억제했던 장소로 외부 탐색   | 해당 장소 상세를 연다.                                                                               |
| 새로 처리할 URL에 장소가 없음                | 장소/추가 상세를 닫고 닫힌 장소 기록을 지운다.                                                       |

`selectedPlace` 구독은 effect를 재실행하기 위한 것이다. effect의 판정은 `store.get(selectedPlaceAtom)`으로 최신 값을 읽는다. 다른 URL effect가 같은 commit에서 선택을 바꾸면 렌더 시점의 값은 오래될 수 있으며, 이후 선택 구독에 의한 재실행도 필요하다. 상세 닫기 기록은 `detailAtom`의 실제 전이를 구독하며, cleanup에서 구독을 해제한다.

## 회귀 검증

- `tests/unit/sections/view-query-sync.test.tsx`: 실제 라우터/Suspense로 늦은 UI URL 완료 중 뷰·선택 변경, 같은 쿼리의 외부 REPLACE/PUSH/POP을 검증한다.
- `tests/unit/sections/url-place-detail.test.tsx`: 두 훅을 함께 사용해 X 닫기, 늦은 UI URL 완료, history, 잘못된 장소 정리를 검증한다.
- `tests/unit/components/trip-page.test.tsx`: 세션 교체·지연 로드와 실제 셸에서의 상세·뷰 전환을 검증한다.

ref를 단일 reducer로 바꾸려면 라우터 완료, atom 변경, 상세 닫기의 순서를 위 테스트로 보존해야 한다. 이번 리뷰 반영에서는 상태 전이를 설명하고 기존 동작을 유지한다.
