# 랜드마크 설계 — 내 근처 저장 장소 (묶음 F4)

- 작성일: 2026-10-16
- 상태: 설계 (리뷰 대기)
- 태그: `v0.11.0`
- 관련 문서: `2026-10-08-place-library-design.md`(§4.2 보관함 목록, §4.5 지도), `2026-10-14-design-qa-design.md`(접근성 기준), F 묶음 공통 지침(약속 C2). 충돌하면 이 문서가 우선한다.

## 1. 목적과 성공 기준

### 1.1 목적

여행지에서 **"지금 여기 근처에 저장해 둔 곳"** 을 바로 본다. 예: 강릉 중앙시장 앞에서 `맛집` 라벨 + `가까운 순` + `1km`를 고르면 저장해 둔 맛집 3곳이 가까운 순서로 나온다.

구글·네이버 지도와 다른 점: 바깥 검색 결과가 아니라 **내가 저장한 곳만**, 내가 붙인 라벨·메모와 함께 거리순으로 본다.

### 1.2 성공 기준

1. 보관함 정렬 메뉴에서 `가까운 순`을 고르면, 지금 필터(검색·라벨·지역)에 맞는 장소가 내 위치에서 가까운 순으로 정렬되고 행마다 직선거리가 보인다.
2. 반경(500m·1km·3km·5km·10km·전체)을 고르면 그 안의 장소만 남고, 몇 곳인지 보인다.
3. 지도 화면의 `내 위치 보기` 버튼을 누르면 지도에 내 위치 점과 정확도 원이 보이고 지도가 그리로 간다.
4. 위치 권한은 **사용자가 위 두 버튼 중 하나를 누를 때만** 묻는다. 앱을 열 때나 새로고침 때는 묻지 않는다.
5. 내 위치는 **어디에도 저장하지 않는다**(localStorage·공유 파일·백업·주소창·서버 모두). 새로고침하면 잊는다.
6. 권한 거부·위치 못 얻음·시간 초과·지원 안 함이 각각 알맞은 한국어 문구로 보이고, 목록은 그대로 쓸 수 있다.
7. F5(당일 모드)가 위치 서비스(`Geolocation`)와 지도 `setMyLocation`을 고치지 않고 그대로 쓴다(약속 C2).

## 2. 범위

### 2.1 하는 것

- 위치 서비스 `src/services/geolocation.ts`(약속 C2: `current`, `watch`).
- 지도 어댑터 `setMyLocation`(네이버·가짜), `MapView`의 `myLocation` prop과 지도 위 단추 자리.
- 보관함: 정렬 `가까운 순`, 근처 줄(상태·반경·다시 찾기·끄기), 행의 거리 표시, 반경 빈 상태.
- 지도: `내 위치 보기` 버튼, 내 위치 점·정확도 원, 근처 모드일 때 반경에 맞추기, 좁은 화면 지도의 근처 칩.

### 2.2 안 하는 것

- **계속 따라가기(watch)를 화면에 쓰지 않는다.** F4 화면은 누를 때 한 번만 위치를 얻는다. `watch`는 서비스에만 만들고 시험한다(F5가 쓴다).
- 실제 이동 거리·시간(경로 조회)은 보이지 않는다. **직선거리만** 보이고 `직선거리`라고 밝힌다(작업 공간 원칙: 이동 시간은 실제 경로 결과만).
- 내 위치를 주소로 바꾸지 않는다(네이버 주소 변환에 좌표를 보내게 되므로).
- 여행 계획 화면 지도의 내 위치(F5가 정한다).
- 반경·가까운 순 선택을 저장하지 않는다(§5.2).
- 영업 중 여부 표시(F6).

## 3. 지금 있는 것 (코드에서 확인, 2026-10-16)

- 정렬은 `LibraryQuery.sort`(`'recent' | 'name' | 'label'`, F2 뒤에도 그대로 — F2는 `다녀온 날순`을 메모리 atom으로 둔다)이고 `src/schema/prefs.ts`의 `Schema.Literals`로 `tripmap:prefs`에 저장된다. `PrefsStore.readPrefs`는 검증에 실패하면 **선호 전체를 기본값으로** 돌린다(테마·보기 방식까지). → `sort`에 새 값을 넣으면 옛 버전에서 선호가 초기화된다(§5.2).
- 보관함 목록과 지도는 같은 조건(`useLibraryQuery` → `queryPlaces`)으로 장소를 거른다(`LibraryPage`, `LibraryMap`).
- 지도 위 단추: 터치 전용 기기에서만 오른쪽 위에 `MapZoomButtons`(44px ＋/−, `top: 8, right: 8`). 그 밖의 기기는 네이버 SDK 확대·축소 막대(코드 주석상 왼쪽 위).
- 중간 폭(768~1279)에서는 장소 상세·추가 칸이 지도 오른쪽 360px(`DETAIL_WIDTH`)을 덮는다.
- 거리 계산: `src/domain/trips/geo.ts`의 `haversineM(a: LngLat, b: LngLat)`.
- 위치 API를 쓰는 코드는 아직 없다(`navigator.geolocation` 검색 결과 0건).
- 아이콘은 `~icons/lucide/*`. `locate-fixed`가 설치된 아이콘 묶음에 있다.

## 4. 화면

### 4.1 들어가는 길

1. **보관함 정렬 메뉴**: `최근 저장순`·`이름순`·`라벨순` 아래에 `가까운 순`을 더한다. 고르면 바로 위치를 묻는다(§4.4).
2. **지도 화면의 `내 위치 보기` 버튼**: 지도 오른쪽 위 단추 기둥(§4.3).

두 곳은 같은 내 위치 상태(메모리)를 쓴다. 목록에서 얻은 위치는 지도에 점으로도 보이고, 지도에서 얻은 위치는 목록이 근처 모드일 때 기준이 된다.

### 4.2 보관함: 가까운 순

**정렬 메뉴**: 단추 글자는 근처 모드면 `가까운 순`. 다른 정렬을 고르면 근처 모드가 꺼진다(얻은 위치는 지도 점으로 남는다). F2의 `다녀온 날순`도 저장하지 않는 메모리 정렬(`visitedSortAtom`, F2 설계서 §4.5)이다 — `가까운 순`을 고르면 `다녀온 날순`이 꺼지고, `다녀온 날순`을 고르면 근처 모드가 꺼진다(둘 중 하나만). 메뉴 순서: `최근 저장순`·`이름순`·`라벨순`·`다녀온 날순`·`가까운 순`.

**근처 줄**(`NearbyBar`): 근처 모드일 때 필터 줄 바로 아래, 목록 위에 붙는다. 두 줄이다.

- 1줄(상태, `role="status"`) + 오른쪽 단추
  - 찾는 중: `내 위치를 찾는 중…`. 5초가 지나도 못 얻으면 `내 위치를 찾는 중… 실내에서는 오래 걸릴 수 있어요`.
  - 얻음(반경 있음): `내 위치에서 3km 안 · 7곳 · 14:05 기준 · 3km 밖 23곳은 숨김`. 숨은 수는 필터 결과(반경으로 자르기 전 목록) 가운데 반경 밖인 곳의 수다. 0곳이면 ` · … 숨김`을 덧붙이지 않는다(§13 결정 11).
  - 얻음(전체): `내 위치에서 가까운 순 · 30곳 · 14:05 기준`(숨기는 곳이 없으므로 숨은 수도 없다)
  - 정확도가 1km보다 나쁠 때 둘째 문장: `위치 오차가 커요(약 2.4km)`
  - 실패: §6의 문구.
  - 오른쪽: `다시 찾기`(찾는 중에는 꺼짐, 실패 때는 글자가 `다시 시도`) · `×`(이름 `가까운 순 끄기`). 둘 다 44px.
- 2줄: 반경 칩 `500m` `1km` `3km` `5km` `10km` `전체`(묶음 이름 `반경`, 하나만 켜짐, 기본 `3km`). 기존 `ChipButton` 모양. 좁은 화면에서는 가로로 밀린다.
- 아래 문장은 1줄 끝에 작게: `직선거리`(거리가 길 따라 잰 값이 아님을 밝힌다).

**목록**:

- 위치를 얻기 전(첫 요청 중·실패)에는 이전 정렬 그대로 보인다. 행에 거리는 없다.
- 얻은 뒤: 필터 결과 → 반경 안만 → 가까운 순. 같은 거리면 이름(한국어) → id 순.
- 행(`PlaceRow`)·카드(`PlaceCard`)의 지역 자리에 거리를 보인다: `570m`, `2.4km`, `14km`. 화면 읽기 프로그램에는 `내 위치에서 570m`(앞말은 눈에만 숨김).
- `다시 찾기` 중에는 이전 위치 기준 목록을 그대로 두고, 새 위치가 오면 바꾼다.
- 벤토·타일 보기는 라벨 블록 아래 목록에 같은 정렬·거리가 적용된다. 라벨 블록의 개수는 반경과 상관없다(지금처럼 라벨 필터를 뺀 개수).

**거리 글자**(`formatDistanceM`):

| 직선거리 | 글자 |
|---|---|
| 1,000m 미만(10m 단위 반올림, 최소 10m) | `10m`, `570m` |
| 1km 이상 10km 미만(소수 한 자리) | `1.0km`, `2.4km` |
| 10km 이상(정수) | `10km`, `14km` |

반올림한 값이 다음 단계에 닿으면 다음 단계로 쓴다(995m → `1.0km`, 9,960m → `10km`).

**빈 상태**:

- 반경 안에 없음: `반경 3km 안에 저장한 곳이 없어요` + 버튼 `반경 넓히기`(한 단계 위로, `10km` 다음은 `전체`).
- `전체`인데 없음(필터 때문): 지금 빈 상태 그대로(`조건에 맞는 장소가 없어요` / `필터 지우기`). `필터 지우기`는 근처 모드도 끈다(§13 결정 11 (다), 2026-10-18). 필터를 풀었는데 켜 둔 반경 때문에 장소가 여전히 숨으면 안 되기 때문이다. 아래 "저절로 꺼지는 흐름"과 같이 `nearbyAtom.on`만 끄고 반경·내 위치는 그대로 둔다. 빈 상태와 단추가 사라지므로 포커스는 정렬 단추로 옮긴다(`×`와 같음). 반경 밖이라 숨은 장소 수는 근처 줄 상태 문장 끝에 보인다(위 1줄).

**근처 모드가 저절로 꺼지는 흐름**: 앱이 필터를 기본값으로 되돌리거나 "방금 넣은 장소"를 보이려고 목록을 거르는 흐름은 근처 모드도 끈다(사용자가 누르는 `필터 지우기`도 같다, 위). 켜 둔 반경 때문에 방금 넣은 장소가 숨으면 안 되기 때문이다(멀리 있는 폴더를 가져오면 3km 안에 하나도 없다). 끄는 것은 `nearbyAtom.on`뿐이고 반경·내 위치(지도 점)는 그대로 둔다.

| 흐름 | 자리(코드) |
|---|---|
| F1 백업에서 되살리기 적용 | `src/stores/backup-state.ts` `useRestoreActions().replace` 성공 뒤(필터를 기본값으로 둔 직후) |
| F3 다시 가져오기 토스트 `보관함에서 보기` | `src/sections/add-place/FolderResync.tsx` 토스트 `onClick`의 `patchQuery(…)` 뒤 |
| 네이버 폴더 가져오기(보관함으로) | `src/sections/add-place/FolderList.tsx` `submit`의 `patchQuery({ labelIds: [result.createdId!], unlabeled: false, text: '', regions: [] })` 뒤(지금 `main` 143행, F2가 `visited: 'all'`을 더함). 여행으로 넣는 경로(`toTrip`)는 필터를 건드리지 않으므로 그대로 |
| 공유 파일 가져오기 | `src/sections/share-import/SharePreview.tsx` `submit`의 `if (result.createdId !== undefined) { patchQuery(…) }` 안(지금 `main` 116행). 제목 라벨을 붙이지 않아 필터를 바꾸지 않으면 근처 모드도 그대로 |
| 사용자 `필터 지우기`(빈 상태 단추) | `src/sections/library/LibraryPage.tsx` `clearFilters`의 `patchQuery(…)` 뒤. 2026-10-18 §13 결정 11 (다)로 더함 |

### 4.3 지도: 내 위치 보기

**단추 기둥**: 지도 오른쪽 위 `top: 8, right: 8`에 세로로 쌓는다.

- 터치 전용 기기: `＋/−` 묶음(PR #16 그대로) → 8px 아래 `내 위치 보기`.
- 그 밖의 기기: `내 위치 보기` 하나(SDK 막대는 왼쪽 위라 겹치지 않는다 — 실제 SDK 위치는 화면으로 확인 필요, §11).
- 중간 폭에서 상세·추가 칸이 지도를 덮으면 기둥을 그 폭만큼 왼쪽으로 옮긴다(`right: 8 + 360`). 덮개가 단추를 가리지 않게 한다. ＋/−도 함께 옮겨진다.

**`내 위치 보기` 버튼**: 44×44, 표면색 바탕·테두리(＋/− 묶음과 같은 모양), 아이콘 `locate-fixed`. 이름 `내 위치 보기`(찾는 중에는 `내 위치를 찾는 중`, `aria-busy="true"`, 아이콘 자리에 작은 원형 진행 표시). 찾는 중에 다시 눌러도 요청을 더 만들지 않는다.

**누르면**:

1. 위치를 한 번 얻는다(§4.4).
2. 얻으면 내 위치 점과 정확도 원을 그린다. 근처 모드가 아니면 지도를 내 위치로 옮긴다(지금의 `focus`와 같은 줌 16). 근처 모드면 반경에 맞춘다(아래).
3. 눈에 안 보이는 알림(`role="status"`): `내 위치를 지도에 표시했어요`.
4. 실패하면 토스트(`toast.error`)로 §6 문구. 이전 점이 있으면 그대로 둔다.

**내 위치 점·정확도 원**:

- 점: 지름 18px, 파랑 `#1a73e8`, 흰 테두리 3px, 그림자. 테마와 상관없이 같다(지도 앱의 관례색, §12 결정 6). 누를 수 없고 클러스터에 들지 않으며 장소 마커 아래에 그린다(장소를 가리지 않게).
- 원: 반지름 = 정확도(m). 같은 파랑, 채움 불투명도 0.12, 선 불투명도 0.35·1px.
- 점은 이번 세션 동안 남는다(새로고침하면 없어진다). 다른 화면을 다녀와도 다시 보인다.

**근처 모드일 때 지도**:

- 목록과 같이 반경 안 장소만 마커로 보인다(같은 조건을 쓰므로).
- 근처 모드가 켜지거나, 반경이 바뀌거나, 새 위치가 오면 지도를 **반경 원을 감싸는 상자**(전체면 내 위치 + 마커 전부)에 맞춘다.
- 좁은 화면 지도 탭: 위 라벨 칩 줄 맨 앞에 칩 `내 근처 3km`(전체면 `내 근처`)와 그 옆 `×`(이름 `가까운 순 끄기`). F2가 같은 줄 맨 앞(`LabelChips`의 `leading` 자리)에 `방문` 칩 묶음을 두므로, 순서는 `내 근처` 칩 → `방문` 묶음 → 라벨 묶음이다(`leading`에 둘을 함께 넘긴다). 장소가 왜 적게 보이는지 알 수 있게 한다. 넓은·중간 화면은 옆 목록에 근처 줄이 보이므로 칩을 두지 않는다.

### 4.4 위치 얻기와 권한

- 권한은 **누를 때만** 묻는다: `가까운 순`을 고를 때, `다시 찾기`·`다시 시도`, `내 위치 보기`. 반경 칩·`반경 넓히기`는 위치를 다시 얻지 않는다(이미 얻은 위치로 다시 거른다).
- 매번 새로 요청한다. 다만 브라우저가 1분 안의 위치를 다시 쓰게 한다(`maximumAge: 60_000`) — 연달아 눌러도 빠르다.
- 정확도 우선(`enableHighAccuracy: true`), 브라우저 시한 15초(`timeout: 15_000`). 브라우저 시한은 **권한을 허락한 뒤부터** 센다. 앱은 따로 시한을 두지 않는다(권한 창을 오래 띄워 둔 사람을 시간 초과로 보지 않는다).
- 한 번에 요청은 하나다. 찾는 중에 다시 누르면(두 번 누름, 목록과 지도에서 함께 누름) 새 요청을 만들지 않고 진행 중인 요청을 함께 기다린다.
- 근처 모드를 끄면 진행 중인 응답이 와도 목록을 다시 근처 모드로 바꾸지 않는다(점만 갱신).

### 4.5 화면 크기별

| 폭 | 보관함 | 지도 |
|---|---|---|
| 좁음(<768) | 목록 탭: 필터 줄 아래 근처 줄 | 지도 탭: 오른쪽 위 ＋/−(터치) 아래 `내 위치 보기`, 칩 줄 앞 `내 근처 3km` 칩 |
| 중간(768~1279) | 왼쪽 목록 칸에 근처 줄 | 오른쪽 위 단추. 상세가 덮으면 360px 왼쪽으로 |
| 넓음(≥1280) | 왼쪽 목록 칸에 근처 줄 | 오른쪽 위 단추 |

**데스크톱**: 같은 흐름이다. 데스크톱 브라우저는 Wi-Fi·IP로 위치를 짐작해 오차가 수백 m~수 km일 수 있다. 1km보다 나쁘면 근처 줄에 `위치 오차가 커요(약 2.4km)`를 보이고 지도에는 큰 원이 그려진다. 데스크톱 화면을 위한 다른 동작은 없다.

## 5. 데이터·저장 형식과 호환·롤백

### 5.1 저장 형식

**바꾸지 않는다.** `tripmap:library:v2`(schemaVersion 2)·`tripmap:prefs`·`tripmap:routes:v1`·공유 형식 그대로.

### 5.2 메모리에만 두는 것

| 상태 | 자리 | 처음 값 |
|---|---|---|
| 내 위치(마지막 위치, 찾는 중, 마지막 오류) | Jotai `myLocationAtom` | 없음 |
| 근처 모드(켬/끔, 반경) | Jotai `nearbyAtom` | 끔, 3km |

- 새로고침·탭 닫기로 사라진다. 다른 탭과 나누지 않는다.
- `가까운 순`을 `LibraryQuery.sort`에 넣지 않는다. 넣으면 (1) 옛 버전이 `tripmap:prefs` 검증에 실패해 테마·보기 방식까지 기본값이 되고(§3), (2) 다음에 앱을 열 때 위치 없이 `가까운 순`으로 시작해 권한을 묻거나 빈 정렬을 보이게 된다. 근처 모드 동안에도 `LibraryQuery.sort`(저장되는 값)는 이전 정렬 그대로다.
- 반경도 저장하지 않는다(§12 결정 3).

### 5.3 개인정보

- 위치 좌표는 localStorage·sessionStorage·IndexedDB에 쓰지 않는다. URL·주소창·공유 파일(C4)·백업(C3)에 넣지 않는다. 앱 서버(`functions/api/*`)에 보내지 않는다. 콘솔에 찍지 않는다.
- 지도에 점을 그리면 네이버 지도가 그 지역의 지도 조각을 받는다. 이것은 지도를 그 지역으로 옮기는 것과 같고, 좌표를 따로 보내지는 않는다.
- 오류 보고(`appErrorReporter`)로 위치 오류가 흘러가지 않게, 위치 실패는 값으로 받아 처리한다(§6).

### 5.4 롤백

- 저장 형식이 그대로라 `v0.11.0` ↔ 이전 버전을 오가도 데이터는 그대로 읽는다. `docs/rollback.md` 표에 `✅`.
- 옛 버전으로 되돌리면 `가까운 순`·`내 위치 보기`만 사라진다. 저장된 정렬은 이전 값 그대로라 옛 버전에서 문제없다.
- 구현 PR은 병합 커밋으로 넣는다. 계획의 Task는 뒤에서부터 하나씩 되돌릴 수 있다(Task N은 그 앞 Task에만 기댄다). Task 1(위치 서비스)·2(지도 표시)는 F5가 쓰므로, F5가 병합된 뒤에는 F4만 되돌리려면 F5를 먼저 되돌려야 한다.

## 6. 오류 처리

`GeolocationError`(`src/services/errors.ts`, `reason`과 `userMessage`).

| reason | 언제 | 문구 |
|---|---|---|
| `denied` | 권한 거부(`code 1`) | `위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치 권한을 켜 주세요` |
| `unavailable` | 위치를 못 얻음(`code 2`), 좌표가 숫자가 아님 | `지금은 위치를 알 수 없어요. 잠시 뒤 다시 해 주세요` |
| `timeout` | 브라우저 시한 초과(`code 3`) | `위치를 찾는 데 시간이 너무 오래 걸려요. 다시 해 주세요` |
| `unsupported` | `navigator.geolocation` 없음, 또는 보안 연결(`isSecureContext`)이 아님 | `이 브라우저에서는 위치를 쓸 수 없어요` |

- 목록: 근처 줄 1줄에 문구 + `다시 시도`. 목록은 이전 정렬로 계속 쓸 수 있다.
- 지도: 토스트. 이전 점은 남긴다.
- 실패 뒤 다시 누르면 다시 묻는다(`denied`면 브라우저가 창 없이 곧바로 거부할 수 있다 — 문구가 설정을 안내한다).
- 위치 오류는 `startEffect(Effect.result(...))`로 값으로 받는다. 앱 오류 보고자(토스트·`console.error`)로 가지 않는다. 프로그램 오류(결함)는 `unavailable`로 보이고 `console.error`에 남긴다(지금 `FolderPreview`와 같다).

## 7. 구조

### 7.1 파일

| 파일 | 하는 일 |
|---|---|
| `src/services/geolocation.ts` (새) | 약속 C2. `GeoFix`, `Geolocation` 서비스(`current`, `watch`), `layerWith`, `layer` |
| `src/services/errors.ts` | `GeolocationError`, `GEOLOCATION_ERROR_REASONS` |
| `src/lib/effect/runtime.ts` | `AppLayer`에 `Geolocation.layer` |
| `src/components/map/MapAdapter.ts` | `MyLocation` 타입, `setMyLocation` |
| `src/components/map/NaverMapAdapter.ts` | 점(Marker)·원(Circle) 그리기·지우기 |
| `src/components/map/FakeMapAdapter.ts` | `data-testid="my-location"` 요소 |
| `src/components/map/MapView.tsx` | `myLocation`, `controls`, `controlsRight`, `extraFitPoints` prop |
| `src/components/map/MyLocationButton.tsx` (새) | `내 위치 보기` 버튼(모양만) |
| `src/components/icons.tsx` | `LocateFixedIcon` |
| `src/domain/nearby.ts` (새) | 반경 목록, 거리순·반경 거르기, 거리 글자, 반경 상자 |
| `src/stores/my-location.ts` (새) | `myLocationAtom`, `locateAtom`, `nearbyAtom` |
| `src/sections/nearby/use-nearby.ts` (새) | 필터 결과 + 근처 상태 → 보일 장소·거리 |
| `src/sections/nearby/NearbyBar.tsx` (새) | 근처 줄 |
| `src/sections/nearby/NearbyMapChip.tsx` (새) | 좁은 화면 지도의 `내 근처` 칩 |
| `src/sections/library/SortMenu.tsx`, `FilterBar.tsx`, `LibraryPage.tsx` | `가까운 순`, 근처 줄, 빈 상태 |
| `src/sections/library/views/PlaceList.tsx`, `PlaceRow.tsx`, `PlaceCard.tsx` | 거리 표시 |
| `src/sections/map/LibraryMap.tsx` | 버튼·점·맞추기·칩·토스트 |
| `src/stores/backup-state.ts`(F1), `src/sections/add-place/FolderList.tsx`, `src/sections/add-place/FolderResync.tsx`(F3), `src/sections/share-import/SharePreview.tsx`, `src/sections/library/LibraryPage.tsx`(`필터 지우기`) | 필터를 푸는 흐름에서 근처 모드 끄기(§4.2) |

### 7.2 인터페이스 (약속 C2)

```ts
// src/services/geolocation.ts
export type GeoFix = { lng: number; lat: number; accuracyM: number; at: number }; // at: 위치를 잰 시각(ms, position.timestamp)
export class Geolocation extends Context.Service<Geolocation, {
  readonly current: Effect.Effect<GeoFix, GeolocationError>;
  watch(onFix: (fix: GeoFix) => void, onError: (error: GeolocationError) => void): () => void;
}>()('tripmap/Geolocation') {
  static layerWith(options: { api: GeolocationApi | undefined; secure: boolean }): Layer.Layer<Geolocation>;
  static readonly layer: Layer.Layer<Geolocation>; // navigator.geolocation, window.isSecureContext
}
// GeolocationApi: getCurrentPosition·watchPosition·clearWatch만 좁게 선언한 구조 타입(DOM의 Geolocation과 이름이 겹쳐 따로 둔다)

// src/services/errors.ts
export const GEOLOCATION_ERROR_REASONS = ['denied', 'unavailable', 'timeout', 'unsupported'] as const;
export class GeolocationError extends Schema.TaggedError<GeolocationError>()('GeolocationError', {
  reason: Schema.Literals(GEOLOCATION_ERROR_REASONS),
}) { get userMessage(): string }

// src/components/map/MapAdapter.ts
export type MyLocation = { lng: number; lat: number; accuracyM: number };
interface MapAdapter { setMyLocation(fix: MyLocation | null): void; /* 나머지 그대로 */ }

// src/components/map/MapView.tsx (더하는 prop)
myLocation?: MyLocation | null;
controls?: ReactNode;          // 오른쪽 위 단추 기둥, ＋/− 아래
controlsRight?: number;        // 기둥을 왼쪽으로 옮길 px(덮개 폭). 기본 0
extraFitPoints?: [number, number][]; // fitKey 맞추기에 마커와 함께 넣을 좌표
```

- `current`: `getCurrentPosition`을 `{ enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }`로 한 번. 중단되면 결과를 버린다(브라우저 API에 취소가 없다). 자체 시한 없음.
- `watch`: `watchPosition`을 `{ enableHighAccuracy: true, timeout: 30_000, maximumAge: 10_000 }`로. 위치마다 `onFix`, 오류마다 `onError`. `denied`면 서비스가 스스로 `clearWatch`하고 더 부르지 않는다. 다른 오류 뒤에는 계속 지켜본다. 돌려준 함수를 부르면 `clearWatch`(두 번 불러도 안전). `unsupported`면 `onError`를 비동기로 한 번 부르고 아무것도 하지 않는 해제 함수를 준다.
- `setMyLocation`: 마운트 전에 불러도 기억했다가 마운트 때 그린다. 같은 값으로 다시 불러도 된다. `null`이면 지운다. `destroy`가 지운다.

### 7.3 상태와 화면 연결

```ts
// src/stores/my-location.ts
export type MyLocationState = { fix: GeoFix | null; locating: boolean; error: GeolocationError | null };
export const myLocationAtom: Atom<MyLocationState>;
export type LocateResult = { kind: 'fix'; fix: GeoFix } | { kind: 'error'; error: GeolocationError };
export const locateAtom: WritableAtom<null, [], Promise<LocateResult>>; // 한 번 얻기. 찾는 중이면 같은 요청을 기다린다
export type NearbyState = { on: boolean; radiusM: NearbyRadius };
export const nearbyAtom: PrimitiveAtom<NearbyState>; // { on: false, radiusM: 3000 }
export const nearbyOffAtom: WritableAtom<null, [], void>; // on만 false로(반경·위치는 그대로). §4.2 "저절로 꺼지는 흐름"이 부른다

// src/domain/nearby.ts
export const NEARBY_RADII = [500, 1000, 3000, 5000, 10_000, null] as const; // null = 전체
export type NearbyRadius = (typeof NEARBY_RADII)[number];
export const DEFAULT_RADIUS_M = 3000;
export const ACCURACY_WARN_M = 1000;
export function nearbyPlaces(places: readonly Place[], from: LngLat, radiusM: NearbyRadius): { places: Place[]; distances: Map<string, number> };
export function formatDistanceM(m: number): string;
export function radiusLabel(r: NearbyRadius): string;      // '500m' | '1km' | … | '전체'
export function nextRadius(r: NearbyRadius): NearbyRadius;  // 10km → null, null → null
export function radiusBox(center: LngLat, radiusM: number): [LngLat, LngLat]; // 남서·북동
```

- 보관함과 지도는 `useNearby(filtered: Place[])`를 함께 쓴다. 근처 모드이고 위치가 있으면 `nearbyPlaces` 결과를, 아니면 받은 목록을 그대로 돌려준다.
- 지도 `fitKey`에 근처 키(`반경:위치 시각`, 근처 모드가 아니면 없음)를 더한다. 근처 모드면 `extraFitPoints`로 `radiusBox`(전체면 내 위치)를 넘긴다.

## 8. 시험

### 8.1 단위 (Vitest, jsdom)

위치를 흉내 내는 방법: **서비스 가짜**. `tests/unit/helpers/fake-geolocation.ts`가 `GeolocationApi` 모양의 가짜를 만든다(요청을 쌓아 두고 시험이 `succeed(i, coords)`·`fail(i, code)`로 답한다, `watchers`·`cleared` 기록). 화면 시험은 `Geolocation.layerWith({ api: fake, secure: true })`를 런타임에 넣는다(`renderApp`의 새 옵션 `geolocation`, 기본은 `api: undefined` → `unsupported`).

- **서비스**: 성공 → `GeoFix`(lng=longitude, lat=latitude, accuracyM=accuracy, at=timestamp), 코드 1·2·3 → `denied`·`unavailable`·`timeout`, API 없음·비보안 → `unsupported`, 좌표가 NaN → `unavailable`, 넘긴 옵션 값, 응답이 오지 않으면 60초가 지나도 끝나지 않음(TestClock), 중단 뒤 온 응답 무시. `watch`: 여러 위치 전달, 해제 → `clearWatch` 한 번(두 번 불러도 한 번), `denied` → 스스로 해제·더 안 부름, `timeout` 뒤에도 계속, `unsupported` → `onError` 한 번.
- **도메인**: 거리순·동점(이름 → id), 반경 경계(정확히 반경 = 포함, 1m 넘음 = 제외), `null` = 전부, 거리 글자 표(0 → `10m`, 567.7 → `570m`, 995 → `1.0km`, 2,435 → `2.4km`, 9,960 → `10km`, 13,510 → `14km`), `nextRadius`, `radiusBox`가 원을 감싼다(네 방향 끝점이 상자 안).
- **상태**: 찾는 중 표시, 성공·실패 반영(성공하면 이전 오류를 지움), 실패해도 이전 위치 유지, 찾는 중에 다시 부르면 요청이 하나이고 두 호출이 같은 결과를 받음, 어떤 경우에도 storage에 쓰지 않음.
- **지도**: 가짜 어댑터 `my-location` 요소(좌표·정확도 data 속성, `null`이면 사라짐). 네이버 어댑터: 마운트 전 호출 → 마운트 때 Marker·Circle 생성, 다시 호출 → 이전 것 지우고 새로, `null`·`destroy` → `setMap(null)`, 점이 장소 마커보다 낮은 zIndex·누를 수 없음, 원 반지름 = 정확도. `MapView`: 준비된 뒤 `setMyLocation` 전달, `controls`가 ＋/− 아래에, `controlsRight`만큼 옮김, `extraFitPoints`가 `fitBounds`에 들어감.
- **보관함 화면**: `가까운 순` → 찾는 중 문구 → 거리순·거리 글자·상태 문장, 반경 칩, 빈 상태 `반경 넓히기`, 다른 정렬 고르면 근처 줄 사라짐, `×`, 오류 4종 문구와 `다시 시도`, 5초 뒤 느림 문구(가짜 타이머), 300ms 넘게 기다려도 `tripmap:prefs`의 `sort`는 이전 값, 시험 동안 storage 어디에도 좌표 글자가 없음, 위치 요청은 고르기 전에 0번.
- **근처 모드 끄는 흐름**(§4.2): 근처 모드(3km, 위치 얻음)에서 기준점 20km 밖 장소만 든 폴더를 보관함으로 가져오기 → 목록에 새 장소가 보이고 근처 줄 없음, `nearbyAtom.radiusM`·지도 점은 그대로. 공유 파일 가져오기(제목 라벨 있음) → 같음, 제목 라벨 없음 → 근처 모드 그대로. F3 `보관함에서 보기` → 꺼짐. F1 되살리기 적용 → 꺼짐. 사용자 `필터 지우기` → 꺼짐, `nearbyAtom.radiusM`·얻은 위치는 그대로, 포커스는 정렬 단추(2026-10-18 §13 결정 11 (다)).
- **숨은 수**(§13 결정 11): 반경 밖 장소가 있으면 상태 문장 끝에 `· 3km 밖 N곳은 숨김`, `전체`·0곳이면 없음, 라벨 필터를 걸면 필터 결과 안에서만 셈, 반경을 바꾸면 따라 바뀜, 다시 찾다 실패해 남은 기준 문장에도 붙음.
- **지도 화면**: 버튼 이름·44px·찾는 중 `aria-busy`, 성공 → 점·`focus`·알림 문구, 실패 → 토스트, 근처 모드 → 반경 상자에 맞춤, 중간 폭 + 상세 열림 → 기둥 `right` 368, 좁은 화면 근처 칩과 `×`.

### 8.2 E2E (Playwright, desktop·iphone·galaxy)

새 파일 `tests/e2e/nearby.spec.ts`, `playwright.config.ts`의 세 프로젝트 `testMatch`에 더한다. 위치를 흉내 내는 방법: **Playwright `permissions: ['geolocation']` + `geolocation`**.

- 기준 위치 `{ latitude: 37.7551, longitude: 128.9003, accuracy: 30 }`(강릉 중앙시장 근처, 시드 좌표와 겹치지 않는 값). 시드(`tests/fixtures/library/seed.json`) 기준 직선거리를 미리 계산했다: 강릉 중앙시장 568m, 아르떼뮤지엄 강릉 2,435m, 오죽헌 3,294m, … 경포대 4,993m(5km 경계 가까움 — 5km 칩은 단언하지 않는다).
- 흐름: 보관함 → 정렬 `가까운 순` → `내 위치에서 3km 안 · 2곳 · … · 3km 밖 28곳은 숨김` → 첫 행 `강릉 중앙시장`·`570m`, 둘째 `아르떼뮤지엄 강릉`·`2.4km` → `1km` 칩 → `1곳` → `전체` → `30곳`.
- 지도: (좁은 화면은 지도 탭) `내 위치 보기` → 가짜 지도의 `my-location` 요소 `data-lat="37.7551"`.
- 거부: 권한을 주지 않은 맥락에 `addInitScript`로 `navigator.geolocation.getCurrentPosition`이 `code: 1`로 실패하게 바꾼다(권한을 안 준 headless 브라우저의 동작이 엔진마다 다를 수 있어서 직접 정한다) → 거부 문구.
- 개인정보: 흐름 뒤 `localStorage`의 모든 값에 `37.7551`이 없고, 새로고침하면 정렬 단추가 `최근 저장순`.
- WebKit(iphone)에서 Playwright `geolocation` 흉내가 되는지는 확인 필요(§11). 안 되면 그 프로젝트만 `addInitScript` 가짜로 바꾼다.

## 9. 첫 로딩 예산

- 보관함·지도는 첫 화면이라 근처 코드는 첫 묶음에 들어간다. 작다(서비스·도메인·근처 줄·버튼·아이콘 하나). 크기는 아직 재지 않았다 — 구현 뒤 `yarn build && yarn size`로 잰다.
- `perf-budget.json` 한도 327,680(gzip), 2026-10-14 측정 297,769. F1~F3가 먼저 더하는 크기는 확인 필요.
- 넘으면 `NearbyBar`를 `lazy-routes.ts`의 `lazyChunk`로 나누고(근처 모드를 켤 때 받는다, `PANEL_CHUNKS`에 더해 미리 받기) `build:ci`의 `--require-lazy NearbyBar`에 더한다. 서비스·상태·지도 표시는 나누지 않는다(지도 단추가 바로 동작해야 한다).

## 10. 접근성

- 터치 대상 44px: `내 위치 보기`, `다시 찾기`, `×`, 반경 칩, 근처 칩.
- 이름: 위 문구 그대로. 반경 칩 묶음 `role="group"` `aria-label="반경"`, 칩은 `aria-pressed`. 정렬 메뉴 항목 `menuitemradio` + `aria-checked`(지금과 같다).
- 상태 문장은 `role="status"`(찾는 중·결과 개수·오류). 지도 성공은 눈에 안 보이는 `role="status"`.
- 포커스 표시는 테마(`focus-ring.ts`). 지도 단추는 ＋/−처럼 `outlineOffset: -2`.
- 대비: 근처 줄 글자는 `text.secondary`·`text.primary`, 오류 문구는 테마 `error` 글자색(여섯 테마에서 AA인 기존 토큰만). 내 위치 점(파랑·흰 테두리)은 지도 바탕 위 3:1 이상 — 밝은 지도 조각 기준, 확인 필요(네이버 지도 조각은 테마와 상관없이 밝다).
- 화면 제목·`h1`은 바꾸지 않는다(보관함·지도 그대로).
- 지도 점은 화면 읽기 프로그램이 읽지 않는다(지도 마커와 같다). 대신 성공 알림 문장이 있다.

## 11. 확인하지 못한 것

- 네이버 SDK 확대·축소 막대의 실제 위치(코드 주석은 "왼쪽 위"). 데스크톱에서 `내 위치 보기`와 겹치지 않는지 화면으로 확인.
- 네이버 Maps JS v3 `naver.maps.Circle`의 옵션 이름(`center`·`radius`·`fillColor`·`fillOpacity`·`strokeColor`·`strokeOpacity`·`strokeWeight`·`clickable`·`zIndex`)과 Marker `clickable`, 음수 `zIndex`로 점을 장소 마커 아래에 둘 수 있는지 — 공식 문서와 화면으로 확인.
- Playwright WebKit(iphone 프로젝트)의 `geolocation` 흉내 동작.
- iOS Safari·삼성 인터넷에서 권한 거부 뒤 다시 묻는지, 15초 시한이 실제로 지켜지는지.
- 내 위치 점 파랑의 지도 바탕 대비.
- 첫 묶음 크기 증가량, F1~F3 이후의 남은 예산.

## 12. 묶음 사이 약속과의 관계

- **C2 (주인)**: 지침대로 정했다(§7.2). 더한 것: 오류 클래스 이름 `GeolocationError`(`reason` 필드, `userMessage`), `layerWith({ api, secure })`, `MapView`의 `controls`·`controlsRight`·`extraFitPoints`, `MyLocation` 타입, 상태 `myLocationAtom`·`locateAtom`. F5는 계속 따라가기를 쓸 때 `watch`로 받은 위치를 `myLocationAtom`에 넣는 쓰기 atom을 F5에서 더하거나, 자기 화면 상태로 두고 `MapView myLocation`에 넘기면 된다. **F5에 바라는 것**: 화면이 숨겨지면(`visibilitychange`) `watch`를 해제하고 돌아오면 다시 건다(배터리).
- **C1**: 쓰지 않는다. (근처 목록에 `다녀옴` 표시는 F2·F5가 원하면 행에 더한다.)
- **C3 백업**: 근처 상태는 저장하지 않으므로 백업할 것이 없다. `prefs`에도 넣지 않는다.
- **C4 공유**: 위치를 공유 파일에 넣지 않는다.
- **C5·C6**: 관계없다. F6가 근처 목록에 영업 정보를 보일지는 F6이 정한다.

## 13. 결정이 필요한 것

1. **진입점**
   - 선택지: (가) 정렬 메뉴 `가까운 순` + 지도 `내 위치 보기` / (나) 하단 탭·레일에 `근처` 화면을 따로 / (다) 지도 버튼만.
   - 추천: (가).
   - 이유: 라벨·지역 필터와 바로 겹쳐 쓸 수 있다("근처 맛집"). 새 탭은 좁은 화면 하단 탭(5칸)을 더 좁힌다.
2. **반경 선택값과 기본값**
   - 선택지: (가) 500m·1km·3km·5km·10km·전체, 기본 3km / (나) 같은 값, 기본 1km / (다) 반경 없이 정렬만.
   - 추천: (가).
   - 이유: 강원도처럼 차로 다니는 여행이 많아(저장 폴더 대부분이 강원도) 1km는 자주 비고, 걸어서 볼 때는 한 번 눌러 1km로 줄이면 된다.
3. **가까운 순·반경을 기억할지**
   - 선택지: (가) 메모리만 / (나) `tripmap:prefs`에 저장 / (다) 따로 키 `tripmap:nearby`에 반경만 저장.
   - 추천: (가).
   - 이유: (나)는 옛 버전에서 선호 전체가 기본값으로 돌아간다(§3). 정렬을 기억하면 다음에 열 때 위치 없이 시작해 권한을 묻거나 빈 정렬이 된다. (다)는 해롭지 않지만 얻는 것이 작다.
4. **계속 따라가기(watch)**
   - 선택지: (가) F4는 누를 때 한 번, watch는 F5만 / (나) F4 지도도 `내 위치 보기`를 켜 두면 계속 따라감.
   - 추천: (가).
   - 이유: 보관함은 "근처에 뭐가 있나"를 한 번 보는 곳이다. 계속 GPS를 켜면 배터리를 쓴다. 걸으며 따라가는 것은 당일 모드(F5)의 일이다.
5. **근처 모드에서 지도 맞추기**
   - 선택지: (가) 반경 원을 감싸는 상자 / (나) 내 위치로 줌 16 / (다) 반경 안 마커에만.
   - 추천: (가).
   - 이유: "3km 안"을 고른 사람이 그 범위를 한눈에 본다. (다)는 장소가 하나면 너무 확대되고 내 위치가 빠질 수 있다.
6. **내 위치 점 색**
   - 선택지: (가) 고정 파랑 `#1a73e8` / (나) 테마 강조색.
   - 추천: (가).
   - 이유: 지도 앱의 관례라 바로 알아본다. 테마 강조색은 라벨 색 마커·선택 테두리와 헷갈린다.
7. **정확도 경고 기준**
   - 선택지: 500m / 1km / 2km.
   - 추천: 1km.
   - 이유: 1km 반경 결과가 의미 없어지는 선이다. 데스크톱 IP 위치는 대개 이보다 나쁘다.
8. **중간 폭 덮개가 있을 때 지도 단추 옮기기**
   - 선택지: (가) 덮개 폭만큼 왼쪽으로(＋/− 포함) / (나) 그대로(가려짐).
   - 추천: (가).
   - 이유: 가려진 단추는 누를 수 없다. ＋/−도 같은 문제가 있어 함께 고친다.
9. **거리 종류**
   - 선택지: (가) 직선거리 / (나) 네이버 경로 거리·시간.
   - 추천: (가).
   - 이유: (나)는 장소 수만큼 경로 조회가 나가 느리고 한도에 걸린다. 직선거리임을 화면에 밝힌다. 이동 시간이 필요하면 여행 계획·당일 모드에서 실제 경로로 본다.
10. **위치 유효 시간**
    - 선택지: (가) 얻은 시각만 보이고(`14:05 기준`) 만료하지 않음 / (나) 10분 지나면 근처 정렬을 멈추고 다시 찾기를 권함.
    - 추천: (가).
    - 이유: 시각이 보이면 사람이 판단한다. (나)는 시계를 계속 봐야 해서 복잡하다.
11. **반경 밖에 숨은 장소 안내** (리뷰 반영으로 더함)
    - 배경: 앱이 필터를 푸는 흐름(가져오기·되살리기·`보관함에서 보기`)은 근처 모드를 끄지만(§4.2), 사용자가 누르는 `필터 지우기`는 끄지 않는다. 그래서 필터를 풀어도 반경 밖 장소는 여전히 숨고, 지금 화면에는 몇 곳이 숨었는지 보이지 않는다.
    - 선택지: (가) 지금처럼 안내 없음 / (나) 근처 줄 상태 문장 끝에 `· 3km 밖 12곳은 숨김`(반경이 `전체`이거나 0곳이면 덧붙이지 않음) / (다) (나) + 사용자 `필터 지우기`도 근처 모드를 끔.
    - 추천: (나).
    - 이유: 숨은 이유와 양이 한눈에 보이고, `전체` 칩 한 번으로 풀 수 있다. (다)는 근처를 보던 사람이 라벨만 풀고 싶을 때 근처 모드까지 꺼져 다시 켜야 한다. (나)를 고르면 Task 4의 상태 문장 시험에 한 줄을 더한다.
    - **결정: (다)** (2026-10-18, 사용자). 근처 줄 상태 문장 끝에 `· <반경> 밖 N곳은 숨김`을 붙이고(N은 필터 결과 중 반경 밖인 곳, `전체`·0곳이면 없음), 사용자 `필터 지우기`도 `nearbyOffAtom`으로 근처 모드를 끈다(반경·내 위치는 그대로, 포커스는 정렬 단추로). 라벨만 풀고 싶으면 라벨 칩을 끄면 되고, 필터를 "모두 지우는" 단추에서는 반경까지 풀리는 편이 기대에 맞는다. §4.2·§7.1·§8을 이에 맞춰 고쳤다.
