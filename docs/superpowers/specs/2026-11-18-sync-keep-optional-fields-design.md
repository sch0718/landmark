# 동기화에서 선택 필드 보존 (v0.37.1 패치) 설계·계획

## 원인 (확인함)

- 증상: v0.37.0에서 여행 구간을 「대중교통 50분 · 직접 입력」으로 바꿨는데, 얼마 뒤 모두 「자동차/도보」로 돌아가고 저장된 여행에서 `legTransit`·`legMinutes`가 빠졌다.
- v0.36 기기는 받은 여행을 자기 스키마로 읽으며(`decodeItem` → `safeParse`) 모르는 키를 뗀다. 기준 해시도 뗀 문서로 계산하므로(v0.36.1 `src/domain/library-sync/apply.ts` `applyRemote`) 받기만으로는 다시 올리지 않는다.
- 그 기기에서 여행의 다른 필드를 한 번이라도 고치면, 두 키가 없는 문서를 `baseRev` = 서버의 현재 rev로 올린다.
- 서버 `pushItems`(`src/server/library-sync/library.ts:280` 부근)는 `stored.rev === baseRev`이면 병합하지 않고 들어온 문서를 통째로 저장한다. 여기서 두 필드가 사라진다(주 원인).
- rev가 다를 때 쓰는 `mergeItem`은 한쪽에만 있는 필드를 남긴다. 다만 병합 결과가 관계 검증(`checkTrip`)에 걸려 문서 하나를 통째로 고르는 갈래(`merge.ts` 끝)에서는 고르지 않은 쪽에만 있던 선택 필드가 사라진다(드묾, 서버·클라이언트 공통).
- 새 기기는 깨끗한 상태에서 서버 문서를 그대로 받으므로 빠진 문서가 퍼진다.
- 재현 시험: `tests/unit/server/sync-optional-fields.test.ts` 첫 번째 시험이 고치기 전 실패한다.

## 지우기 표현 (확인함)

새 클라이언트는 선택 필드를 지울 때 키를 없애지 않고 빈 값(`[]`, `{}`, `null`, `''`)과 새 시각을 남긴다(`setOptionalField`, `src/domain/trips/ops.ts` `withOptionalField`, `src/domain/trips/undo.ts` `revertTrip`).

예외: 서버의 AI 변경 되돌리기(`src/server/agent/library-edit.ts` `undoChanges`)는 이전 문서를 `stampChangedFields`로 복원하므로, AI가 처음 만든 선택 필드는 키가 없는 문서로 올라간다. 아래 보존 규칙을 넣으면 이 되돌리기가 그 필드를 지우지 못한다. 그래서 이 경로도 빈 값과 새 시각을 쓰게 고친다.

## 고칠 방식

- 주로 서버를 고친다. 옛 기기 코드는 바꿀 수 없다. 공통 `mergeItem`은 통째 선택 갈래만 고치고, 클라이언트에는 업데이트 뒤 한 번 다시 받기만 더한다.
- `src/domain/library-sync/merge.ts`에 선택 필드와 빈 값 표 `OPTIONAL_FIELD_EMPTY`를 둔다: 장소 `visitedOn: null`·`review: ''`, 라벨 `emoji: null`, 여행 `legTransit: []`·`legMinutes: {}`. 앞으로 선택 필드를 더하면 여기에 적는다.
- 같은 파일에 `keepMissingFields(kind, from, doc)`를 더한다. 표에 있는 키가 `doc`에 없고 `from`에 있으면 `from`의 값을 붙인다. 바뀐 게 없으면 `doc`을 그대로 돌려준다.
- `pushItems`에서 `stored.rev === baseRev`일 때 `a.doc` 대신 `keepMissingFields(kind, 저장된 문서, a.doc)`를 쓴다. AI 편집(`noMerge`)도 같은 갈래를 지난다.
- `mergeItem`이 관계 검증 실패로 문서 하나를 통째로 고를 때도 고르지 않은 쪽의 선택 필드를 `keepMissingFields`로 붙인다. 선택 필드는 각자 스키마 검사를 통과했고 `checkTrip`은 구간 키 형식만 보므로 결과가 다시 무효가 되지 않는다.
- AI 되돌리기(`undoChanges`): `stampChangedFields` 결과에서, 지금 문서에는 있고 이전 문서에는 없는 표의 키를 `{ value: 빈 값, updatedAt: at }`으로 채운다.
- 업데이트한 옛 기기: v0.36 시절 받은 여행은 키가 떼어진 채 기준 해시도 그 문서로 맞춰 있어, 새 버전이 되어도 다시 받지 않는다. 그 상태에서 다른 구간의 시간을 넣으면 로컬에 있는 값만으로 `legMinutes`를 새 시각으로 만들어 서버의 기존 값을 LWW로 덮는다. 그래서 클라이언트에 한 번만 도는 「전체 다시 받기」를 둔다.
  - `src/services/library-sync/sync-engine.ts`에 상수 `FIELDS_REFRESH = 1`을 두고, 동기화 기록(meta)에 마지막으로 끝낸 값 `fieldsRefresh`를 저장한다. 저장값이 없거나 작으면 그 회차를 커서 0부터 받는다. 기존 `fullResync`(받지 못한 항목을 묘비로 만드는 갈래)는 켜지 않는다.
  - `applyRemote`에 `refresh` 옵션을 더한다. 켜져 있으면 같은 rev라도 로컬 항목이 깨끗할 때(`hashItem(mine) === base.hash`) 서버 문서로 바꾸고 기준 해시를 새로 맞춘다. 수정 중인 항목은 지금처럼 건너뛴다(올릴 때 서버 병합이 선택 필드를 남긴다).
  - 그 회차가 성공하면 `fieldsRefresh`를 저장한다. 앞으로 선택 필드를 더하면 이 상수를 1 올린다. 비용은 기기마다 한 번, 전체 받기(500개씩) 한 번이다.
- 결과 문서가 들어온 문서와 달라지므로 서버는 결과를 응답에 싣는다. 옛 기기는 그것을 다시 읽으며 키를 떼고, 뗀 결과가 올린 문서와 같아 다시 올리지 않는다(되풀이 없음).

## 하지 않는 것

- 이미 사라진 데이터 복구, 플래너 화면, 공유 문서 형식.
- 보존으로 커진 문서의 크기 재검사. 선택 필드는 작고, 병합 결과도 지금 다시 검사하지 않는다.
- 롤백 절차. v0.37.0 서버로 돌아가면 이 문제가 다시 생긴다는 점은 통합 세션이 `docs/rollback.md`에 적는다.

## 작업 순서

1. `merge.ts`에 `OPTIONAL_FIELD_EMPTY`, `keepMissingFields` 추가(export), `mergeItem` 통째 선택 갈래에 적용.
2. `src/server/library-sync/library.ts` `pushItems`의 `stored.rev === baseRev` 갈래에 적용.
3. `src/server/agent/library-edit.ts` `undoChanges`에서 빠진 선택 필드를 빈 값으로 채움.
3-1. `applyRemote`의 `refresh` 옵션과 `sync-engine.ts`의 `FIELDS_REFRESH`·meta `fieldsRefresh`(meta 스키마·읽기 함수에 선택 필드로 추가).
4. 시험: `tests/unit/server/sync-optional-fields.test.ts`(있음)의 두 시험 — 옛 클라이언트가 필드 없이 올려도 남음, 새 클라이언트가 빈 값으로 지우면 지워짐. 기존 AI 되돌리기 시험 파일(`tests/unit/server/agent-library-edit.test.ts`)에 「AI가 처음 만든 선택 필드를 되돌리면 빈 값이 된다」 하나. `applyRemote` 시험 파일에 「refresh면 같은 rev의 깨끗한 항목을 서버 문서로 바꾸고, 수정 중인 항목은 그대로 둔다」 하나.
5. `docs/development.md` 보관함 동기화 절에 선택 필드 규칙 두세 줄.

## 검증

`yarn vitest run tests/unit/server/sync-optional-fields.test.ts tests/unit/server/sync-library.test.ts tests/unit/server/agent-library-edit.test.ts`, 그 뒤 `yarn build:ci`.
