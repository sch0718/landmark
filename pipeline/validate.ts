import { parse } from 'yaml';
import { safeParse, type ParseResult } from 'src/schema/parse';
import { TRIP_DATA_PARSE, TripDataSchema } from 'src/schema/legacy/trip-data';
import { TripSourceSchema } from 'src/schema/legacy/trip-source';
import type { FsPort } from './fs-port';

type Validator = (v: unknown) => ParseResult<unknown>;

export async function validateAll(deps: {
  fs: FsPort;
}): Promise<{ ok: boolean; errors: { file: string; message: string }[] }> {
  const errors: { file: string; message: string }[] = [];
  const check = async (file: string, load: (t: string) => unknown, validate: Validator) => {
    try {
      const r = validate(load(await deps.fs.readText(file)));
      if (!r.success) {
        const message = r.issues
          .slice(0, 5)
          .map((i) => `${i.path || '(루트)'}: ${i.message}`)
          .join('; ');
        errors.push({ file, message });
      }
    } catch (e) {
      errors.push({ file, message: e instanceof Error ? e.message : String(e) });
    }
  };
  for (const f of await deps.fs.listFiles('trips', '.yaml')) {
    await check(
      f,
      (t) => parse(t) as unknown,
      (v) => safeParse(TripSourceSchema, v),
    );
  }
  for (const f of await deps.fs.listFiles('public/data', '.json')) {
    await check(
      f,
      (t) => JSON.parse(t) as unknown,
      (v) => safeParse(TripDataSchema, v, TRIP_DATA_PARSE),
    );
  }
  return { ok: errors.length === 0, errors };
}
