import { Effect, ErrorReporter } from 'effect';
import {
  applyImportPlan,
  planLegacyImport,
  semanticKey,
  type ImportChoices,
  type ImportPlan,
  type LegacySource,
} from 'src/domain/library/legacy-import';
import { startEffect, startEffectSync } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import { LegacyImportStale } from 'src/services/errors';
import { IdGen } from 'src/services/id-gen';
import { LegacyTripSource } from 'src/services/legacy-trip-source';
import { LibraryStore } from 'src/services/library-store';

/** 새 장소·라벨 ID를 만든다(미리보기 계산용, 동기). */
export function mintId(kind: 'place' | 'label'): string {
  return startEffectSync(
    Effect.gen(function* () {
      return (yield* IdGen).next(kind);
    }),
  );
}

export type SourceInput = { kind: 'file'; file: File } | { kind: 'publicId'; id: string };
export type SourceResult = { ok: true; source: LegacySource } | { ok: false; message: string };

/** 옛 여행을 읽는다. 읽기 오류(`LegacyImportInvalid`)는 화면에 보일 문구가 된다. */
export function loadLegacySource(input: SourceInput): Promise<SourceResult> {
  return startEffect(
    Effect.gen(function* () {
      const reader = yield* LegacyTripSource;
      const source = yield* input.kind === 'file'
        ? reader.fromFile(input.file)
        : reader.fromPublicId(input.id);
      return { ok: true, source } satisfies SourceResult;
    }).pipe(
      Effect.catchTag('LegacyImportInvalid', (error) =>
        Effect.succeed<SourceResult>({ ok: false, message: error.message }),
      ),
    ),
  );
}

export type ImportOutcome =
  | { kind: 'applied'; added: number; library: Library }
  /** 미리보기 이후 보관함이 의미 있게 바뀌었다. `library`는 그때의 최신 문서. */
  | { kind: 'stale'; library: Library }
  | { kind: 'failed' };

/**
 * 최신 보관함 기준으로 계획을 다시 만들어 미리보기와 의미가 같을 때만 적용한다(스펙 §4.6).
 * ID·시각은 미리보기 계획의 것을 그대로 쓴다. 저장 실패는 보고하고 `failed`로 돌려준다.
 */
export const applyLegacyImport = Effect.fn('가져오기/적용')(function* (
  source: LegacySource,
  choices: ImportChoices,
  preview: ImportPlan,
) {
  const store = yield* LibraryStore;
  const ids = yield* IdGen;
  const seen: { stale: Library | null; added: number } = { stale: null, added: 0 };
  const key = semanticKey(preview);
  return yield* store
    .update((latest) =>
      Effect.gen(function* () {
        const plan = planLegacyImport(
          latest,
          source,
          choices,
          preview.ids,
          (kind) => ids.next(kind),
          preview.ids.now,
        );
        if (semanticKey(plan) !== key) {
          seen.stale = latest;
          return yield* new LegacyImportStale();
        }
        seen.added = plan.summary.added;
        return applyImportPlan(latest, plan);
      }),
    )
    .pipe(
      Effect.map((library): ImportOutcome => ({ kind: 'applied', added: seen.added, library })),
      Effect.catchTag('LegacyImportStale', () =>
        Effect.succeed<ImportOutcome>({ kind: 'stale', library: seen.stale! }),
      ),
      Effect.catchCause((cause) =>
        ErrorReporter.report(cause).pipe(Effect.as<ImportOutcome>({ kind: 'failed' })),
      ),
    );
});
