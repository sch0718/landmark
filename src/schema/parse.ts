import { Cause, Exit, Option, Schema, SchemaIssue } from 'effect';

/** Zod의 `issues[]`와 같은 모양. `path`는 `.`로 이은 경로이고 루트는 `''`이다. */
export type Issue = { path: string; message: string };

export type ParseResult<A> = { success: true; data: A } | { success: false; issues: Issue[] };

/** Effect의 `ParseOptions` 중 쓰는 것만 그대로 전달한다. */
export type ParseOpts = { onExcessProperty?: 'ignore' | 'error' };

const format = SchemaIssue.makeFormatterStandardSchemaV1();

/** Zod의 `safeParse`와 같은 호출 모양. 모든 issue를 모은다(`errors: 'all'`). */
export function safeParse<S extends Schema.Decoder<unknown>>(
  schema: S,
  value: unknown,
  opts?: ParseOpts,
): ParseResult<S['Type']> {
  const exit = Schema.decodeUnknownExit(schema)(value, { errors: 'all', ...opts });
  if (Exit.isSuccess(exit)) return { success: true, data: exit.value };
  const error = Exit.findErrorOption(exit);
  if (Option.isNone(error)) throw new Error(Cause.pretty(exit.cause));
  const issues = format(error.value.issue).issues.map((i): Issue => ({
    path: (i.path ?? []).map(String).join('.'),
    message: i.message,
  }));
  return { success: false, issues };
}

/** Zod의 `parse`와 같은 호출 모양. 실패하면 첫 issue의 `path: message`로 던진다. */
export function parseOrThrow<S extends Schema.Decoder<unknown>>(
  schema: S,
  value: unknown,
  opts?: ParseOpts,
): S['Type'] {
  const r = safeParse(schema, value, opts);
  if (r.success) return r.data;
  const first = r.issues[0];
  throw new Error(first ? `${first.path}: ${first.message}` : 'Invalid value');
}

export function is<S extends Schema.Decoder<unknown>>(schema: S, value: unknown): boolean {
  return Schema.is(schema)(value);
}
