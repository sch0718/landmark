# 구글 지도 선택 (설계·계획)

해외 여행 1단계의 한 조각. 설계와 계획을 이 문서 하나로 쓴다(파일 십여 개, 새 의존성 없음).

## 왜 필요한가

네이버 지도 JS v3는 해외를 OpenStreetMap 기반 간략 지도(큰길·강만, 명소·가게 없음)로 그린다(2026-11-16 확인). 이미 있는 어댑터로는 해외 지도를 쓸 수 없어서 구글 지도 어댑터를 하나 더 둔다.

## 전제와 결정

- 운영자 1명·소수 지인·Cloudflare 무료. 구글은 **지도 표시(Maps JavaScript API, Dynamic Maps)만** 쓴다. Places·Routes API는 쓰지 않는다.
- 배포는 하나. 설정에 「지도: 네이버 / 구글」, 기본 네이버, 기기별(`tripmap:prefs`) 저장.
- 빌드 변수 `VITE_GOOGLE_MAPS_API_KEY`가 비면 설정 구역을 숨기고, 저장값이 `google`이어도 네이버로 그린다.
- 좌표 범위·검색·경로·해외 도움말은 다른 세션 몫. 아래 「건드리지 않는 파일」 참고.

### 공식 문서 확인(2026-11-16)

- 로드: `<script async src="https://maps.googleapis.com/maps/api/js?key=…&loading=async&callback=…">`. `loading=async`를 권장한다(load-maps-js-api 문서). `@googlemaps/js-api-loader`는 쓰지 않고 `load-naver-sdk.ts`처럼 스크립트를 직접 넣는다.
- `google.maps.Marker`는 3.56부터 사용 중단(중단 예정은 없고 큰 회귀만 고침). `AdvancedMarkerElement`는 Map ID가 필요해 콘솔 설정이 하나 더 는다.
- **결정: 마커는 `google.maps.OverlayView` 하나에 HTML 알약을 직접 그린다.** Map ID가 필요 없고, 사용 중단 API를 피하고, 기존 `createMarkerLabelElement`를 그대로 쓴다. 마커 요소는 `overlayMouseTarget` 창에 넣고 `google.maps.OverlayView.preventMapHitsAndGesturesFrom(el)`로 지도 click·끌기가 같이 일어나지 않게 한다.
- 인증 실패는 전역 `gm_authFailure()`로 온다(네이버의 `navermap_authFailure`와 같은 방식으로 처리).
- 폴리라인·내 위치 원은 `google.maps.Polyline`·`google.maps.Circle`(사용 중단 아님).

## 설계

### 1. `src/components/map/load-google-sdk.ts`

`load-naver-sdk.ts`와 같은 모양: `loadGoogleSdk(apiKey, timeoutMs = 10000)`, `onGoogleAuthFailure(cb)`, `GOOGLE_AUTH_FAILURE_MESSAGE`. 스크립트 주소에 `key`·`loading=async`·`callback=<전역 함수>`·`v=weekly`를 넣고, 콜백이 불리면 resolve. `window.google?.maps?.Map`이 이미 있으면 바로 resolve. 시간 초과·`onerror`·`gm_authFailure`는 reject(로드 뒤 실패는 구독자에게 알림). 테스트용으로 모듈 상태를 되돌리는 함수는 기존 네이버 로더 시험 방식을 따른다.

### 2. `src/components/map/GoogleMapAdapter.ts`

`MapAdapter` 전체를 구현한다. SDK 타입은 `NaverMapAdapter`처럼 쓰는 것만 좁게 선언한다(`@types/google.maps`를 더하지 않는다).

- `mount(el)`: SDK 로드 → `new google.maps.Map(el, { center: {lat:37.5,lng:128.2}, zoom: 8, disableDefaultUI: true, zoomControl: options.zoomControl ?? true, clickableIcons: false, gestureHandling: 'greedy' })`. 한 손가락 끌기가 되도록 `greedy`(네이버와 같은 조작감). `clickableIcons: false`로 POI 누르기가 정보창을 열지 않고 지도 바탕 누르기로 처리되게 한다(가게 이름은 지도에 보인다).
- 마커 층: `OverlayView` 하위 클래스 하나. `onAdd`에서 `overlayMouseTarget`에 컨테이너 div, `draw`에서 각 요소를 `fromLatLngToDivPixel`로 위치시킨다(알약은 이미 `translate(-50%,-50%)`라 좌표에 left/top만 둔다). 묶음은 `cluster.ts`의 `buildClusterIndex`·`clusterFeatures`를 그대로 쓰고, 지도 `idle`에서 다시 계산한다(네이버와 같다). 선택 마커·zIndex 규칙(선택 1000, 점 -1)·키보드 Enter/Space·`role=button`도 네이버와 같다. 묶음을 누르면 가운데로 옮기고 `expansionZoom`으로 확대.
- `setPolylines`: `Polyline`(점선은 `strokeOpacity:0` + `icons`의 반복 선 기호, 구글 공식 점선 예제 방식).
- `setMyLocation`: `Circle` + 내 위치 점(마커 층과 같은 OverlayView에 누를 수 없는 요소로, 장소 마커보다 아래).
- 카메라: `getCamera` → `{center:[lng,lat], zoom}`, `setCamera` → `map.moveCamera({center, zoom})`(애니메이션 없이 바로 바뀜). `fitBounds(points, padding)`은 구글 `map.fitBounds`가 애니메이션으로 늦게 끝날 수 있어(공식 레퍼런스) 쓰지 않는다. 지도 요소 크기·padding·웹 메르카토르로 맞출 중심과 정수 줌(0~21, 내림)을 직접 계산해 `moveCamera`로 바로 옮긴다. 그래서 `fitBounds` 직후 `getCamera()`가 맞춘 값을 돌려주고, 공유 지도의 「맞춘 뒤 줌 16 넘으면 줄이기」(`src/share-map/map.ts`)가 그대로 맞는다. 계산은 순수 함수(`fitCamera(points, size, padding)`)로 떼어 시험한다.
- `resize`: 구글 지도는 컨테이너 크기를 스스로 따라가므로 카메라만 유지하고 마커를 다시 그린 뒤 영역 변경을 알린다.
- `onMapClick`: 지도 `click`을 `MAP_CLICK_DELAY_MS`(250ms) 미루고 `dblclick`이 오면 취소, 마커 click이 끼면 버린다(네이버와 같은 규칙. 상수는 공용으로 옮기지 않고 네이버 파일에서 가져다 쓴다).
- `destroy`: 리스너·타이머·오버레이를 모두 걷는다.

### 3. 지도 고르기 (`src/components/map/map-provider.ts`, 작은 순수 함수)

```ts
export type MapProvider = 'naver' | 'google';
/** 저장값과 키로 실제로 그릴 지도. 구글 키가 없으면 네이버. */
export function resolveMapProvider(pref: MapProvider, googleKey: string | undefined): MapProvider;
/** 공유 보기: 키가 있고 점이 하나 이상이며 모두 한국 밖이면 구글. */
export function shareMapProvider(points: [number, number][], googleKey: string | undefined): MapProvider;
```

한국 판정은 다른 세션이 공용 함수를 만들 수 있다. 지금은 이 파일에 지역 함수 `isInKorea(lng, lat)`(`src/share-viewer/parse.ts`의 범위 124~132, 33~39와 같다)를 두고 보고에 적는다(통합 때 합친다).

### 4. 설정·선호

- `src/schema/prefs.ts`: `mapProvider: Schema.Literals(['naver','google']).pipe(Schema.withDecodingDefault(Effect.succeed('naver')))` (옛 선호도 통과, 기존 `visited`와 같은 방식). `DEFAULT_PREFS.mapProvider = 'naver'`. `Prefs` 객체를 직접 쓰는 기존 시험(`tests/unit/services/prefs-store.test.ts` 등)에 `mapProvider`를 더한다.
- `SettingsPage.tsx`: 「보관함 보기」 아래에 `지도` 구역(`OptionGroup`, 네이버/구글). `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`가 비면 구역을 그리지 않는다.

### 5. `MapView.tsx`

- `prefsAtom`에서 `mapProvider`를 읽고 `resolveMapProvider`로 정한다. 마운트 effect의 의존성에 provider를 더한다.
- 구글이면 `GoogleMapAdapter`를 **동적 `import()`**로 받아 첫 화면 JS 예산(`perf-budget.json`)을 늘리지 않는다. 어댑터 생성을 `Promise<MapAdapter>`로 바꾸고, 기존 `cancelled` 처리를 그대로 지킨다. 인증 실패 구독은 provider에 맞는 함수(`onNaverAuthFailure`/`onGoogleAuthFailure`)를 쓴다. fake 빌드는 지금처럼 `FakeMapAdapter`.
- **카메라 이어받기:** 지도는 설정 화면으로 가면 언마운트된다(`AppShell.tsx`가 설정 경로에서 지도 슬롯 대신 `Outlet`을 그린다). 그래서 컴포넌트 밖 모듈 변수 하나에 `{ provider, key, camera }`(마지막으로 정리된 지도의 provider·`fitKey`·카메라)를 둔다. 어댑터를 정리할 때 맞추기가 끝난 키였으면 이 값을 덮어쓴다. 새로 붙을 때 저장된 provider가 지금 provider와 **다르고** `key`가 같으면 그 카메라로 `setCamera`하고 그 키를 이미 맞춘 것으로 친 뒤 값을 지운다. provider가 같으면 지금처럼 다시 맞춘다(평소 동작은 바뀌지 않는다). 마운트된 채 provider가 바뀌는 경우도 같은 경로를 탄다. 카메라를 이어받을 때는 그때의 `focus.seq`를 이미 적용한 것으로 쳐서 옛 focus가 이어받은 카메라를 덮지 않게 한다.
- 키가 없는데 구글이 저장돼 있으면 `resolveMapProvider`가 네이버를 돌려주므로 안내 문구는 바뀌지 않는다.

### 6. 공유 보기 화면 (`src/share-map/main.ts`)

지금은 `ready` 전에 어댑터를 정한다. 장소를 알아야 고를 수 있으므로:

- fake 빌드·네이버 ID 없음 처리는 그대로.
- 구글 키가 없으면 지금과 똑같이 바로 네이버로 만든다(동작 변화 없음).
- 구글 키가 있으면 `createShareMap`을 첫 `init`/`draw` 메시지가 올 때까지 미룬다. 그 메시지의 장소·핀 좌표로 `shareMapProvider`를 불러 어댑터를 정한다. 파일 쪽은 `ready` 직후 `init`→`filter`→`focus`나 `draw`→`focus`를 잇달아 보내므로(`src/share-viewer/map-frame.ts`), 지도 객체가 생기기 전(구글 어댑터 동적 import 대기 중 포함)에 온 메시지는 **모두 받은 순서대로 배열에 쌓았다가** 지도를 만든 뒤 차례로 넘긴다. 첫 `init`/`draw` 전에 온 `focus`·`filter`도 쌓아 두고 순서대로 넘긴다(`createShareMap`이 이미 붙기 전 상태를 처리한다). 한 번 정한 지도는 바꾸지 않는다. import가 실패하면 `tiles-failed`.
- 네이버 ID가 없으면 지금처럼 `tiles-failed`(구글 키만 있는 빌드는 지원하지 않는다. 운영은 네이버 ID가 늘 있다).
- 구글 어댑터는 지도 페이지 번들(`vite.map.config.ts`)에서도 동적 import.
- 오프라인 HTML 내보내기(파일 쪽)는 바꾸지 않는다.
- 지도 페이지는 GitHub Pages에 따로 배포된다(`.github/workflows/deploy-share-map.yml`). 빌드 단계 env에 `VITE_GOOGLE_MAPS_API_KEY: ${{ vars.GOOGLE_MAPS_API_KEY }}`를 더한다(비어도 빌드는 계속. 네이버 ID 필수 검사는 그대로 둔다).
- 백업: `src/schema/backup.ts`는 `prefs`를 `Unknown`으로 담고 읽을 때 `PrefsSchema`로 검사하므로 스키마 기본값만으로 따라간다.

### 7. 설정·문서

- `vitest.config.ts` `test.env`에 `VITE_GOOGLE_MAPS_API_KEY: ''`. 값이 필요한 시험은 `vi.stubEnv`.
- `src/vite-env.d.ts`에 `VITE_GOOGLE_MAPS_API_KEY?: string`(주석: 비면 구글 선택지를 숨김).
- `docs/development.md` 환경 변수 표와 Pages 설정 표에 키 설명: Google Cloud에서 **Maps JavaScript API만** 허용, **HTTP 리퍼러**를 `https://landmark.sch0718.dev/*`, `https://landmark-c5f.pages.dev/*`, `https://*.landmark-c5f.pages.dev/*`(미리보기, 필요할 때), 지도 페이지 `https://sch0718.github.io/*`(교차 출처 iframe 요청은 브라우저가 경로를 떼므로 경로까지 넣으면 인증이 실패할 수 있다. 구글 API 보안 권장 문서), `http://localhost:5173/*`, `http://localhost:8788/*`로 제한, 일일 상한(예: 300회/일) 권장. 지도 페이지 배포 워크플로가 이 변수를 받아야 하면 `deploy-share-map.yml` 쪽 설명도 적는다(실제 비밀값 등록은 사람이 한다).
- CSP: `public/_headers`·`index.html`에 CSP가 없다(2026-11-16 확인) → 고칠 것 없음.
- 도움말: `scripts/motion/help-pages.mjs` 설정 `tips`에 한 줄을 더하고 `yarn build:motion`으로 `docs/help/settings.md`·`src/sections/help/help-content.ts`를 다시 만든다. 문구: 「설정 › 지도에서 네이버·구글을 고를 수 있어요. 해외 여행에는 가게·명소까지 보이는 구글이 좋아요. 기기마다 따로 저장돼요.」(키가 없는 배포에선 구역이 없다는 말은 넣지 않는다.)

## 건드리지 않는 파일

`src/schema/common.ts`, `src/server/search.ts`, `src/server/route.ts`, `src/services/reverse-geocoder.ts`, `src/sections/trips/*`, `pipeline/agent-trip/*`, `docs/help/*`의 해외 장소·경로 부분, `docs/rollback.md`.

## 시험 (동작을 지키는 만큼만)

- `tests/unit/components/map-provider.test.ts`: `resolveMapProvider`(키 없음 → 네이버, 키 있음 → 저장값), `shareMapProvider`(모두 해외 → 구글, 한국 하나라도 → 네이버, 빈 목록 → 네이버, 키 없음 → 네이버).
- 선호 스키마: `mapProvider` 없는 옛 저장값이 `naver`로 읽힘(기존 prefs 시험 파일에 한 건).
- 설정 화면: 키가 비면 `지도` 구역 없음, `vi.stubEnv`로 키를 주면 보이고 고르면 저장됨(기존 설정 시험에 두 건).
- `tests/unit/components/load-google-sdk.test.ts`: 콜백으로 resolve, `gm_authFailure`로 reject(네이버 로더 시험 모양, 두세 건).
- `tests/unit/components/google-map-adapter.test.ts`: 가짜 `window.google.maps`로 `mount`·`setMarkers`(묶음 포함 요소 생성)·마커 click → `onMarkerClick`·`getCamera`/`setCamera`·`fitBounds` 직후 `getCamera`가 맞춘 값·지도 click 뒤 `dblclick`이면 알리지 않음·SDK 로드 중 `destroy`면 지도를 만들지 않음·`destroy`만. `fitCamera`는 순수 함수 시험 두세 건.
- 공유 지도 선택: 기존 share-map 시험에 구글 키가 있을 때 해외 장소 `init`이 구글 쪽으로, 한국 장소가 네이버 쪽으로 가는 것, 그리고 어댑터 준비가 늦을 때 `init`→`filter`→`focus`가 순서대로 반영되는 것을 어댑터 생성 함수를 바꿔 끼워 확인.
- MapView 카메라 이어받기는 단위 시험 하나(언마운트 → provider 바꿈 → 다시 마운트하면 이전 카메라로 `setCamera`, 맞추기 안 함)를 넣되, 구조상 어렵다면 생략하고 통합 세션의 화면 확인으로 넘긴다.
- 기존 e2e(fake 어댑터)는 그대로 통과해야 한다.

## 순서

1. 로더·어댑터·`map-provider.ts`와 그 시험.
2. 선호 스키마·설정 화면·MapView 연결(동적 import, 카메라 이어받기).
3. share-map 선택.
4. `vitest.config.ts`·`vite-env.d.ts`·`docs/development.md`·도움말(`yarn build:motion`).

## 검증

`yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, 키를 넣은 빌드(`VITE_GOOGLE_MAPS_API_KEY=dummy`)로 `yarn size --require-lazy GoogleMapAdapter`(첫 화면 예산·구글 어댑터 분리), 두 키를 dummy로 넣은 `yarn build:map` 뒤 `yarn size --dist dist-map --require-lazy GoogleMapAdapter`(지도 페이지 쪽 분리), `yarn build:map`, `yarn test:e2e:ci`. 키를 넣은 실제 화면 확인은 통합 세션이 한다.
