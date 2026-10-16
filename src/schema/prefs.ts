import { Effect, Schema } from 'effect';
import { DEFAULT_QUERY } from 'src/domain/library/query';
import { MutableArray } from 'src/schema/mutable';

export const LibraryQuerySchema = Schema.Struct({
  labelIds: MutableArray(Schema.String),
  mode: Schema.Literals(['any', 'all']),
  unlabeled: Schema.Boolean,
  regions: MutableArray(Schema.String),
  text: Schema.String,
  // 새 선택 키: 키가 없는 옛 선호도 통과한다. `sort`에는 값을 더하지 않는다(옛 버전이 선호 전체를 버린다).
  visited: Schema.Literals(['all', 'unvisited', 'visited']).pipe(
    Schema.withDecodingDefault(Effect.succeed('all' as const)),
  ),
  sort: Schema.Literals(['recent', 'name', 'label']),
});

export const PrefsSchema = Schema.Struct({
  theme: Schema.Literals(['pastel', 'paper', 'night']),
  mode: Schema.Literals(['system', 'light', 'dark']),
  libraryView: Schema.Literals(['bento', 'cards', 'tiles', 'list']),
  query: LibraryQuerySchema,
});

export type Prefs = typeof PrefsSchema.Type;

export const DEFAULT_PREFS: Prefs = {
  theme: 'pastel',
  mode: 'system',
  libraryView: 'bento',
  query: DEFAULT_QUERY,
};
