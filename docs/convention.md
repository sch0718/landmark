# 작성 규칙

## Effect

- 실패하거나 의존성이 있는 작업은 Effect로 쓴다. **동기 순수 함수(필터, 지역 추출, 검색)는 평범한 함수**로 둔다.
- 기본은 `Effect.fnUntraced(function* (...) {})`. 사용자 동작 한 번에 한 번 실행되는 단위는 `Effect.fn('영역/동작')`.
- React 컴포넌트는 `startEffect`/`effectAtom`을 통해서만 Effect를 실행한다.
- Effect API는 `.reference/effect/`(없으면 `node_modules/effect/ai-docs`, `node_modules/effect/dist/*.d.ts`)로 확인한다. 기억에 의존하지 않는다(v4에서 이름이 바뀐 API가 많다).
- `.reference/effect/`는 `yarn effect:source`로 받는다. `effect` 버전을 올리면 다시 실행한다. 커밋하지 않는다.

## 보관함 문서

- 보관함 문서는 `LibraryStore.update`로만 쓰고, 변경은 `src/domain/library/ops.ts`의 변경 함수로 표현한다.
