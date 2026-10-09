import { Schema } from 'effect';

/**
 * Effect의 `Struct`·`Array`·`Record`는 `readonly` 타입을 만든다. 이 앱의 도메인 코드와 테스트는
 * Zod 시절의 변경 가능한 타입(`string[]`, `obj.field = …`)을 쓰므로, 옛 스키마 4종은 아래 도우미로
 * 필드·배열·레코드 값을 변경 가능하게 만든다. 런타임 검증은 같다.
 */
type MutableFields<F extends Schema.Struct.Fields> = { [K in keyof F]: Schema.mutableKey<F[K]> };

export function MutableStruct<const F extends Schema.Struct.Fields>(
  fields: F,
): Schema.Struct<MutableFields<F>> {
  const mapped = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, Schema.mutableKey(v)]),
  ) as MutableFields<F>;
  return Schema.Struct(mapped);
}

export const MutableArray = <S extends Schema.Constraint>(item: S) =>
  Schema.mutable(Schema.Array(item));

export const MutableRecord = <K extends Schema.Record.Key, V extends Schema.Constraint>(
  key: K,
  value: V,
) => Schema.Record(key, Schema.mutableKey(value));
