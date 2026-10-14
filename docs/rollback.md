# 롤백

주요 변경마다 `main`의 병합 커밋에 버전 태그를 붙인다. 문제가 생기면 **배포만 먼저 되돌리고**(1분), 필요하면 **코드를 되돌리는 PR**을 만든다.

## 버전

| 태그 | 커밋 | 내용 | 이 버전으로 되돌릴 때 지금 데이터 |
|---|---|---|---|
| `v0.1.0` | `bb1a705` | 보관함(하위 프로젝트 1)·HTML 공유 내보내기, 이름을 랜드마크로 | ⚠️ 여행이 하나라도 있거나 카카오·구글 장소가 있으면 손상 화면 |
| `v0.2.0` | `e92eacb` | 장소 추가: 링크·네이버 폴더·지도 핀 (#2) | ⚠️ 여행이 하나라도 있으면 손상 화면 |
| `v0.3.0` | `3ea21d1` | 여행 계획: 후보·Day·경로·시간 (#4) | ✅ 그대로 읽음 |
| `v0.4.0` | `88dd0cc` | 받은 공유 파일 가져오기 (#6) | ✅ |
| `v0.5.0` | `15adf03` | 다듬기 1: 결함·코드 정리 (#8) | ✅ |
| `v0.6.0` | `2cee518` | 다듬기 2: 첫 로딩 (#10) | ✅ |

- 보관함은 각 기기의 localStorage(`tripmap:library:v2`)에만 있다. `v0.3.0` 이후로는 저장 형식이 바뀌지 않아 그 사이 버전끼리는 데이터 걱정 없이 오갈 수 있다.
- **손상 화면**: 옛 버전은 모르는 형식을 손상으로 보고 `tripmap:library:v2:corrupt-<시각>`에 백업을 남긴 뒤 `백업 파일 받기`·`새로 시작`을 보인다. 이때 **`새로 시작`을 누르지 않는다**(보관함이 비워진다). 다시 새 버전으로 되돌리면 원래 데이터를 그대로 읽는다(옛 버전은 원본 키를 지우지 않는다 — `새로 시작`을 눌렀을 때만 지운다).
- 공유 HTML 파일은 그 안에 보기 화면이 들어 있어 앱 버전과 상관없이 열린다. 공유 지도 페이지(`gh-pages`)는 따로 배포된다(아래).

## 1. 배포만 되돌리기 (가장 빠름, 코드는 그대로)

Cloudflare Pages는 지난 배포를 모두 보관한다.

1. Cloudflare 대시보드 → **Workers & Pages** → `landmark` → **Deployments**.
2. 되돌릴 버전의 커밋(위 표의 커밋 해시)이 적힌 **Production** 배포의 `…` → **Rollback to this deployment**.
3. 몇 초 안에 `https://landmark-c5f.pages.dev`가 그 배포로 바뀐다.

이 상태에서 `main`에 새 커밋이 병합되면 그 커밋이 다시 배포된다. 계속 옛 버전을 유지하려면 2번으로 코드를 되돌린다.

## 2. 코드 되돌리기 (PR로)

변경 하나(PR 하나)를 빼려면 그 병합 커밋을 되돌린다.

```bash
git switch main && git pull
git switch -c revert/<이름>
git revert -m 1 <병합 커밋>   # 병합 커밋(Merge pull request …)일 때
git revert <커밋>             # squash 병합 커밋일 때
```

PR을 만들어 CI를 통과하면 병합한다. 그 PR의 변경 일부(묶음 하나)만 빼려면 그 묶음의 커밋을 `git revert <커밋>`한다(묶음마다 커밋을 나눈 PR만 가능).

특정 버전의 코드를 그대로 보려면 `git switch --detach v0.4.0`.

## D3 묶음별로 되돌리기 (다듬기 3: 디자인 QA·접근성)

`feat/design-qa`는 병합 커밋(Create a merge commit)으로 `main`에 들어가므로 아래 커밋 해시가 그대로 남는다(squash로 병합하면 해시가 바뀐다 — 그 경우 이 표는 쓸 수 없고 PR 전체를 되돌린다). 묶음 하나를 빼려면 그 묶음의 커밋을 **새것부터** `git revert`한다. 묶음끼리 기대지 않게 나눠 두었다.

| 묶음 | 커밋 (오래된 것 → 새 것) | 바꾸는 것 |
|---|---|---|
| T1 구조·이름 | `4d5da97` `479a3a0` `65cd5ba` | 화면별 `h1`·탭 제목·알림 영역 이름, 장소 상세 제목 구조(`h1`/`h2`), 추가 칸이 상세 자리를 차지해도 남는 `h1` |
| T2 키보드·포커스 | `2ae21e5` `d4d7ae4` `2a95b36` `ea9a084` | `<main id="main">`·본문 바로가기, 포커스 표시를 테마 하나로(`src/theme/focus-ring.ts`), 추가 칸 포커스 이동·`Esc` 닫기·복귀, 스위치·합치기 행의 안쪽 바깥선 |
| T3 대비 | `902f282` `7b2adcb` `22ab6b1` `01972f3` | 여섯 테마의 글자·강조색·입력칸 테두리 대비(`--tm-border-strong`), 칩 개수 글자, MUI 입력칸 안내 글자 |
| T4 입력칸 | `c9c34b9` `2d680b0` `d1b9d50` | `fieldSx` 하나로 통일, MUI 입력칸 테두리·포커스, 오류·비활성 상태의 호버, 검색칸 포커스 |
| T5 배치·터치 | `30719b9` `1fc25c1` | 휴대폰 공유 고르기 시트 높이, 좁은 폭 후보 칸 접기와 접고 펼친 뒤 포커스, 대화상자 제목 굵기, 끌기 손잡이 44px |

```bash
git switch main && git pull
git switch -c revert/d3-t3
git revert --no-edit 01972f3 22ab6b1 7b2adcb 902f282   # 새것부터. 충돌하면 아래를 보고 풀고 `git revert --continue`
yarn typecheck && yarn test
```

- **충돌**: 되돌리는 묶음이 다른 묶음과 같은 줄 가까이를 건드린 곳은 텍스트 충돌이 난다. 그 줄만 풀고(양쪽의 상관없는 줄은 모두 남긴다) 넘어간다. 임시 브랜치에서 한 묶음씩 되돌려 확인한 곳은 다음뿐이다. 나머지는 충돌 없이 되돌려진다.

  | 되돌리는 묶음 | 충돌 파일 | 푸는 방법 |
  |---|---|---|
  | T1 | `src/sections/place/EditableText.tsx` | 가져오기 줄과 입력칸 `sx`는 T4의 `fieldSx` 쪽을 남기고, `ReactNode`·`/>,`처럼 T1이 더한 부분만 뺀다 |
  | T2 | `src/theme/create-app-theme.ts` (두 군데) | 가져오기 줄은 T4의 `FIELD_BORDER_COLOR`만 남기고 `focus-ring` 줄을 뺀다. 컴포넌트 규칙에서는 T3의 `::placeholder`·`Mui-selected` 줄만 남기고 `:focus-visible`·`MuiButtonBase`·`FOCUS_RING*` 줄을 뺀다 |
  | T3 | `tests/unit/theme/create-app-theme.test.ts` | T4·T5의 시험(TextField 테두리·대화상자 제목)은 남기고 T3의 시험(안내 글자·고른 탭)만 뺀다 |
  | T4 | `tests/unit/theme/create-app-theme.test.ts` | T5의 대화상자 제목 시험은 남기고 T4의 TextField 테두리 시험만 뺀다 |
  | T5 | 없음 | |

- 위 방법으로 풀면 묶음마다 `yarn typecheck`와 `yarn test`가 통과한다(2026-10-14 임시 작업 폴더에서 T1~T5를 하나씩 되돌려 확인).
- 공유 HTML 파일의 보기 화면(`src/share-viewer/`)은 앱 테마 밖이라 자기 포커스 표시를 따로 가진다. T2를 되돌려도 영향이 없고, 보기 화면의 모양은 바뀌지 않는다.
- 되돌린 묶음의 변경은 화면에만 영향이 있다. 저장 형식(`tripmap:library:v2` 등)과 공유 형식은 D3에서 바뀌지 않았으므로 데이터는 그대로 읽힌다.

## 3. 공유 지도 페이지 (`https://sch0718.github.io/landmark/`)

`.github/workflows/deploy-share-map.yml`이 `main`에 지도 관련 파일이 바뀐 커밋이 들어올 때만 `gh-pages` 브랜치로 배포한다(다른 브랜치·태그에서 수동 실행하면 배포 단계는 건너뛴다. `main`에서 수동 실행하면 최신 `main`을 다시 배포할 뿐이라 옛 버전으로 되돌리지는 못한다). 되돌리는 방법은 둘이다.

- **코드로**: 2번처럼 `main`에서 해당 변경을 되돌리는 PR을 병합한다. 지도 관련 파일이 바뀌므로 워크플로가 되돌린 코드를 다시 배포한다.
- **`gh-pages`를 직접**: `gh-pages`는 배포할 때마다 커밋이 하나씩 쌓인다. 되돌릴 배포 커밋을 찾아 되돌리는 커밋을 올린다.

  ```bash
  git fetch origin gh-pages
  git switch -C gh-pages origin/gh-pages   # 로컬 gh-pages가 뒤처져 있어도 원격 최신에서 시작
  git log --oneline   # 배포 커밋 찾기
  git revert <되돌릴 배포 커밋>
  git push origin gh-pages
  ```

  이 방법은 `main`에 그 변경이 남아 있으므로, 다음에 지도 관련 파일이 바뀌어 배포되면 다시 덮인다.

## 새 버전을 낼 때

- 기능·다듬기 PR이 `main`에 병합되면 그 병합 커밋에 다음 태그(`v0.7.0` …)를 붙이고 위 표에 한 줄 더한다.
- 저장 형식을 바꾸는 변경은 옛 버전이 새 데이터를 손상으로 볼 수 있으므로 표의 마지막 칸에 적고, 가능하면 옛 버전이 무시할 수 있는 방식(선택 필드)으로 바꾼다.
