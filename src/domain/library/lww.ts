/** 필드 단위 최신값 우선(LWW)을 위한 `{ value, updatedAt }` 묶음. */
export type Field<T> = { value: T; updatedAt: string };

/**
 * 두 필드 중 `updatedAt`이 큰 쪽을 고른다. 같으면 `JSON.stringify(value)`가 사전순으로
 * 큰 쪽을 고르므로 인자 순서와 무관하다. 직렬화까지 같으면 `a`를 돌려준다.
 */
export function pickField<T>(a: Field<T>, b: Field<T>): Field<T> {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return JSON.stringify(a.value) >= JSON.stringify(b.value) ? a : b;
}

/** 값이 바뀔 때만 새 필드를 만든다. 같으면 `f` 그대로 돌려줘 불필요한 갱신을 막는다. */
export function setField<T>(f: Field<T>, value: T, now: string): Field<T> {
  if (JSON.stringify(f.value) === JSON.stringify(value)) return f;
  return { value, updatedAt: now };
}

/**
 * 선택 필드용 `setField`. 필드가 아직 없고 새 값이 "빈 값"(`empty`)이면 필드를 만들지 않고
 * `undefined`를 돌려줘, 옛 문서에 쓸데없이 키가 생기지 않게 한다.
 * 필드가 있으면 `setField`와 같다(같은 값이면 같은 참조).
 */
export function setOptionalField<T>(
  f: Field<T> | undefined,
  value: T,
  empty: T,
  now: string,
): Field<T> | undefined {
  if (f === undefined) {
    return JSON.stringify(value) === JSON.stringify(empty) ? undefined : { value, updatedAt: now };
  }
  return setField(f, value, now);
}
