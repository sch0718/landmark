# 랜드마크 데모 영상(내레이션 3~5분) 계획

한 사람이 강릉 여행을 준비하며 랜드마크를 쓰는 이야기를 휴대폰 화면 녹화 + 한국어 음성 내레이션으로 만든다. 유튜브 업로드는 사용자가 직접 한다.
이미 있는 도움말 SVG는 그림이라 실제 조작감·흐름을 못 보여 줘서 영상을 만든다. 앱 코드는 바꾸지 않는다.
도구 절차는 `~/.claude/skills/narrated-video/SKILL.md`(대본 → 음성 `tts.mjs` → 시간표 → 화면 → 합성 `finish.sh`)를 따른다.

## 파일 (`scripts/demo-videos/`)

| 파일 | 내용 |
|---|---|
| `story.mjs` | 대본 단일 출처. `SCENES = [{ id, title, lines: ['문장', …] }]`. 존댓말, 문장 하나에 마침표 하나 |
| `voice.mjs` | `story.mjs` 문장을 `~/.claude/skills/narrated-video/scripts/tts.mjs`의 `speak`로 읽혀 `<OUT>/voice/`에 wav와 `durations.json`(장면·문장별 `file`·`dur`). 목소리 `{ provider: 'edge', id: 'ko-KR-SunHiNeural', rate: '+5%' }`(무료, 키 없음). 경로는 `NARRATED_VIDEO_TTS`로 바꿀 수 있다 |
| `playwright.config.ts` | 녹화 전용. `testDir` 이 폴더, `testMatch: '**/*.demo.ts'`, Chromium, 390×844, `isMobile`·`hasTouch`, `deviceScaleFactor: 2`, `ko-KR`·`Asia/Seoul`, `video: { mode: 'on', size: { width: 390, height: 844 } }`, `workers: 1`, `retries: 0`, `timeout` 10분. webServer는 루트 설정의 앱 서버와 같은 명령·env를 포트 8788(`DEMO_PORT`)로, `reuseExistingServer: false`. 단 `VITE_MAP_ADAPTER`는 루트처럼 `'fake'`로 고정하지 않고 아래 「지도」 규칙으로 정한다(`MapView.tsx`가 이 값을 Client ID보다 먼저 본다). 결과는 `<OUT>/pw/` |
| `human.ts` | 사람처럼 보이게 하는 도구. `installFinger(page)`: `addInitScript`로 반투명 손가락 원(지름 44px)을 붙여 마우스를 따라가고, 누르면 작아지며 물결이 퍼진다(`pointer-events: none`). `tap(page, locator)`: 지금 위치에서 대상 중심 근처(약간 어긋나게)로 0.4~0.7초 동안 곡선·감속 이동(`mouse.move` 여러 걸음) → 0.15초 멈춤 → `down`/`up`(사이 80~120ms). `longPress`: 같은 이동 후 0.8초 누름. `type(page, locator, text)`: 탭 후 글자마다 90~200ms(공백·문장부호 뒤는 더 길게). `scroll(page, dy)`: 휠을 여러 번 나눠 감속(관성처럼). `pause(ms)` |
| `story.demo.ts` | 테스트 하나. `durations.json`을 읽고, 장면마다 시작 시각(영상 시작 기준 ms)을 `<OUT>/timeline.json`에 적고, 장면 동작 함수를 `at(k)`(k번째 문장 시작 시각까지 기다림)과 함께 부른다. 장면 끝은 `max(동작 끝, 마지막 문장 끝) + 0.8초`. 문장 시작 시각 = 장면 시작 + 0.5초 + Σ(앞 문장 길이 + 0.35초). 시간 원점은 첫 장면 시작(시드·첫 로딩이 끝나 보관함이 보인 때)이고, 그 시각의 영상 위치(페이지 생성부터 잰 ms)를 `timeline.json`의 `offsetMs`로 적어 `compose.mjs`가 영상 앞을 그만큼 잘라 낸다 |
| `compose.mjs` | (1) 음성: 문장 wav를 시간표 위치에 `adelay`로 놓아 `audio.wav`(48kHz). (2) 자막·제목 PNG: Playwright Chromium으로 투명 PNG를 그린다(이 Mac의 ffmpeg에는 drawtext·libass가 없다). (3) 화면: 녹화 webm을 1920×1080 바탕 왼쪽에 휴대폰(높이 980)으로 놓고, 오른쪽에 장면 제목과 지금 문장 자막을 `overlay=enable='between(t,a,b)'`로 겹쳐 `seg.mp4`(H.264 30fps yuv420p). (4) `finish.sh final.mp4 audio.wav seg.mp4` → `final.mp4`·`final-phone.mp4`. (5) `title.txt`·`desc.txt`(장면 제목 목차와 시각, 앱 주소, `<` `>` 없음) |
| `tsconfig.json` | 이 폴더 전용(`noEmit`, `strict`, 루트 설정을 확장). `yarn tsc -p scripts/demo-videos/tsconfig.json`으로 타입 확인 |
| `package.json` | `"demo:video": "yarn build:viewer && node scripts/demo-videos/voice.mjs && playwright test -c scripts/demo-videos/playwright.config.ts && node scripts/demo-videos/compose.mjs"` |
| `docs/development.md` | 스크립트 표 `yarn build:motion` 줄 아래에 `yarn demo:video` 한 줄(출력 폴더 `DEMO_OUT`, 기본 `.cache/demo-video/`, 지도 Client ID 환경 변수, Edge TTS 사용) |

`<OUT>`은 `DEMO_OUT`(기본 `.cache/demo-video/`, 이미 gitignore). 이번 녹화는 저장소 밖 `~/01.workspace/영상/2026-11-landmark-demo/`로 한다. 영상·음성은 커밋하지 않는다. README·`docs/help/`·앱 코드는 바꾸지 않는다. 앞서 만든 메뉴별 `*.demo.ts` 9개는 지운다(흐름·mock 준비 코드는 `story.demo.ts`에 옮겨 쓴다).

## 이야기 (약 4분, 장면 9개)

시드(`tests/fixtures/library/seed.json`, 강릉·속초·제주·서울 30곳, 라벨 6개)를 `tests/e2e/fixtures.ts`의 `seedStorage`로 심는다. 개인 데이터는 넣지 않는다.

1. **시작** — 보관함 첫 화면, 앱 소개 2문장.
2. **장소 담기** — ＋ → 링크 붙여넣기(`place-adding.spec.ts`의 route mock) → 라벨 고르기 → 추가.
3. **보관함 거르기** — `카페` 라벨 칩, 시·도 강원 → 강릉, 검색 칸에 이름 입력, 스크롤. 장면 끝에 검색·라벨·지역 조건을 모두 풀어 다음 장면이 전체 목록에서 시작하게 한다(조건은 화면을 떠나도 저장된다).
4. **장소 상세** — 장소 열기 → 메모 입력 → 다녀옴·한 줄 평.
5. **지도** — 지도 탭, 마커 누르기 → 아래 시트, 내 위치(`nearby.spec.ts`처럼 `geolocation` 권한·고정 좌표).
6. **여행** — 새 여행(이름·날짜) → 보관함에서 더하기 → Day 1에 넣기 → 이동 시간 표시(`trip-planning.spec.ts`의 경로 mock).
7. **약속** — 새 약속 → 참석자 출발지 2명(보관함에서) → 중간 지점 찾기 결과(`meetings.spec.ts`/`meetings-online.spec.ts`의 mock).
8. **공유** — 보관함에서 여러 곳(2곳 이상, 고른 수를 확인) 길게 눌러 고르기 → 내보내기 → `링크 복사`(`share-link.spec.ts`+`share-server.ts`).
9. **설정·마무리** — 테마 바꾸기(파스텔 → 다른 테마) → 백업 파일 받기 → 마무리 2문장.

어떤 단계가 mock 없이 외부 호출이 필요하면 그 단계는 빼고 대본 문장도 함께 뺀다.

## 지도

`VITE_NAVER_MAP_CLIENT_ID`가 실행 환경에 있으면 실제 네이버 지도를 쓰고(포트 8788은 Client ID 허용 주소, `docs/development.md` 108~109행), 없으면 `VITE_MAP_ADAPTER=fake`로 떨어진다. Client ID는 어떤 파일에도 적지 않는다. 이번 녹화는 실제 지도로 한다.

## 순서

1. Codex: 위 파일 구현(녹화·음성 실행은 하지 않음, `yarn lint`와 `--list` 1개 수집까지).
2. 이 세션: `voice.mjs` → 녹화 → `compose.mjs`. 녹화가 실패하면 장면 단위로 고친다(`DEMO_SCENES=2,3`처럼 일부만 돌리는 선택 지원).
3. 확인: `ffprobe` 길이 3~5분, 장면마다 1장씩 PNG를 뽑아 Read로 본다(빈 화면·오류 화면·자막 어긋남 없음). `timeline.json`의 장면 시작과 문장 시각이 자막 PNG 구간과 같은지 본다.
4. 검사 → PR → CI → 병합.

## 검증

- `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, `yarn tsc -p scripts/demo-videos/tsconfig.json` 통과.
- 실제 지도: 지도 장면 PNG에 네이버 지도 타일이 보인다.
- 동기화: 첫 장면과 마지막 장면의 화면 전환 시각이 자막 구간 시작과 맞는다.
- 루트 `playwright test --list`에 데모가 나오지 않는다.
- `final.mp4` 1920×1080, 3~5분, 오디오 트랙 있음. `final-phone.mp4` 생성.
- 음성은 사람이 들어 보기 전에는 「들어 보지 못함」으로 보고한다.
