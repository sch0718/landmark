import { Context, Effect, Layer } from 'effect';
import type { LegacySource } from 'src/domain/library/legacy-import';
import { migrateEditLayer, storageKey } from 'src/repositories/edit-layer-repo';
import { EDIT_LAYER_PARSE, EditLayerSchema, type EditLayer } from 'src/schema/legacy/edit-layer';
import { PublicId } from 'src/schema/common';
import { is, safeParse } from 'src/schema/parse';
import { TRIP_DATA_PARSE, TripDataSchema, type TripData } from 'src/schema/legacy/trip-data';
import { browserStorage } from 'src/services/browser-storage';
import { LegacyImportInvalid } from 'src/services/errors';

const NOT_FOUND = '여행 데이터를 찾지 못했어요';

/**
 * 같은 브라우저에 저장된 옛 편집 레이어를 **읽기만** 한다. 기존 `readEditLayer`는 무효 원문을
 * 백업하고 원래 키를 지우므로 쓰지 않는다. 키가 없거나 읽기·해석·검증에 실패하거나
 * 아는 것보다 새 `schemaVersion`이면 `null`이고, 저장소는 그대로 둔다.
 */
function readEditLayerReadOnly(storage: Storage | undefined, publicId: string): EditLayer | null {
  if (storage === undefined) return null;
  try {
    const raw = storage.getItem(storageKey(publicId));
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null) {
      const version = (value as { schemaVersion?: unknown }).schemaVersion;
      if (typeof version === 'number' && version > 1) return null;
    }
    const parsed = safeParse(EditLayerSchema, migrateEditLayer(value), EDIT_LAYER_PARSE);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function decodeTrip(raw: unknown): TripData | LegacyImportInvalid {
  const parsed = safeParse(TripDataSchema, raw, TRIP_DATA_PARSE);
  if (parsed.success) return parsed.data;
  const first = parsed.issues[0];
  const where = first && first.path !== '' ? `${first.path}: ` : '';
  return new LegacyImportInvalid({
    message: `여행 데이터가 올바르지 않아요: ${where}${first?.message ?? '검증에 실패했어요'}`,
  });
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 옛 여행(`TripData` JSON 파일 또는 배포된 `/data/<publicId>.json`)과 같은 브라우저의 옛 편집 레이어를 읽는다. */
export class LegacyTripSource extends Context.Service<
  LegacyTripSource,
  {
    fromFile(file: File): Effect.Effect<LegacySource, LegacyImportInvalid>;
    fromPublicId(id: string): Effect.Effect<LegacySource, LegacyImportInvalid>;
  }
>()('tripmap/LegacyTripSource') {
  static layerWith(options: { storage: Storage | undefined; fetch: typeof fetch }) {
    const finish = (trip: TripData): LegacySource => ({
      trip,
      edit: readEditLayerReadOnly(options.storage, trip.publicId),
    });

    const fromFile = Effect.fnUntraced(function* (file: File) {
      const text = yield* Effect.tryPromise({
        try: () => file.text(),
        catch: (e) => new LegacyImportInvalid({ message: `파일을 읽지 못했어요: ${errorText(e)}` }),
      });
      const raw = yield* Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: (e) =>
          new LegacyImportInvalid({ message: `JSON을 해석하지 못했어요: ${errorText(e)}` }),
      });
      const trip = decodeTrip(raw);
      if (trip instanceof LegacyImportInvalid) return yield* trip;
      return finish(trip);
    });

    const fromPublicId = Effect.fnUntraced(function* (id: string) {
      if (!is(PublicId, id)) {
        return yield* new LegacyImportInvalid({ message: '여행 링크가 올바르지 않아요' });
      }
      const response = yield* Effect.tryPromise({
        try: () => options.fetch(`/data/${id}.json`),
        catch: (e) =>
          new LegacyImportInvalid({ message: `여행 데이터를 받지 못했어요: ${errorText(e)}` }),
      });
      if (response.status === 404) return yield* new LegacyImportInvalid({ message: NOT_FOUND });
      if (!response.ok) {
        return yield* new LegacyImportInvalid({
          message: `여행 데이터를 받지 못했어요: HTTP ${response.status}`,
        });
      }
      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (e) =>
          new LegacyImportInvalid({ message: `여행 데이터를 받지 못했어요: ${errorText(e)}` }),
      });
      // Cloudflare Pages SPA 모드는 없는 `/data/<id>.json`에 index.html을 200으로 돌려준다.
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return yield* new LegacyImportInvalid({ message: NOT_FOUND });
      }
      const trip = decodeTrip(raw);
      if (trip instanceof LegacyImportInvalid) return yield* trip;
      return finish(trip);
    });

    return Layer.succeed(LegacyTripSource, LegacyTripSource.of({ fromFile, fromPublicId }));
  }

  static readonly layer = Layer.suspend(() =>
    LegacyTripSource.layerWith({
      storage: browserStorage(),
      fetch: (...args) => globalThis.fetch(...args),
    }),
  );
}
