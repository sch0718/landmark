import { parse } from 'yaml';
import { TripDataSchema } from 'src/schema/trip-data';
import { TripSourceSchema } from 'src/schema/trip-source';
import type { FsPort } from './fs-port';

type Issue = { path: PropertyKey[]; message: string };
type Schema = { safeParse(v: unknown): { success: boolean; error?: { issues: Issue[] } } };

export async function validateAll(deps: {
  fs: FsPort;
}): Promise<{ ok: boolean; errors: { file: string; message: string }[] }> {
  const errors: { file: string; message: string }[] = [];
  const check = async (file: string, load: (t: string) => unknown, schema: Schema) => {
    try {
      const r = schema.safeParse(load(await deps.fs.readText(file)));
      if (!r.success) {
        const message = (r.error?.issues ?? [])
          .slice(0, 5)
          .map((i) => `${i.path.map(String).join('.') || '(루트)'}: ${i.message}`)
          .join('; ');
        errors.push({ file, message });
      }
    } catch (e) {
      errors.push({ file, message: e instanceof Error ? e.message : String(e) });
    }
  };
  for (const f of await deps.fs.listFiles('trips', '.yaml')) {
    await check(f, (t) => parse(t) as unknown, TripSourceSchema);
  }
  for (const f of await deps.fs.listFiles('public/data', '.json')) {
    await check(f, (t) => JSON.parse(t) as unknown, TripDataSchema);
  }
  return { ok: errors.length === 0, errors };
}
