import { stableStringify } from './items';

type Field = { value: unknown; updatedAt: string };

const isRecord = (node: unknown): node is Record<string, unknown> =>
  node !== null && typeof node === 'object' && !Array.isArray(node);

// `value`와 문자열 `updatedAt`을 가진 객체를 필드로 본다. 다른 속성이 있어도 필드다(결과에서 버린다).
const isField = (node: unknown): node is Field =>
  isRecord(node) && Object.hasOwn(node, 'value') && typeof node.updatedAt === 'string';

function walk(before: unknown, after: unknown, now: string): unknown {
  if (isField(after)) {
    const same = isField(before) && stableStringify(before.value) === stableStringify(after.value);
    return { value: after.value, updatedAt: same ? before.updatedAt : now };
  }
  if (Array.isArray(after)) {
    const prev = Array.isArray(before) ? before : [];
    return after.map((child, index) => walk(prev[index], child, now));
  }
  if (isRecord(after)) {
    const prev = isRecord(before) ? before : {};
    return Object.fromEntries(
      Object.entries(after).map(([key, child]) => [key, walk(prev[key], child, now)]),
    );
  }
  return after;
}

/**
 * 편집 결과(`after`)의 필드 시각을 다시 찍는다. 값이 `before`와 같으면 이전 시각을,
 * 다르거나 `before`에 없으면 `now`를 쓴다. `after`가 가져온 시각은 믿지 않는다.
 * 배열은 같은 인덱스끼리 비교한다.
 */
export function stampChangedFields<T>(before: T | undefined, after: T, now: string): T {
  return walk(before, after, now) as T;
}
