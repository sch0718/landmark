import { randomInt } from 'node:crypto';
import { collect, SourceValidationError } from '../collect';
import { createNodeFs } from '../fs-port';
import { UnresolvedPlacesError } from '../resolve-stops';
import { createFileRouteCache } from '../route-cache';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const random = (len: number): string =>
  Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const args = process.argv.slice(2);
const refreshRoutes = args.includes('--refresh-routes');
const yamlPath = args.find((a) => !a.startsWith('--'));
if (!yamlPath) {
  console.error('사용법: yarn collect <trips/파일.yaml> [--refresh-routes]');
  process.exit(1);
}

try {
  await collect(
    yamlPath,
    { refreshRoutes },
    {
      fs: createNodeFs(),
      http: { fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
      cache: createFileRouteCache('.cache/routes'),
      random,
      now: () => new Date().toISOString(),
      log: (line) => console.log(line),
    },
  );
} catch (e) {
  if (e instanceof UnresolvedPlacesError) {
    console.error('찾을 수 없는 장소:');
    for (const p of e.places) console.error(`  ${p.date} ${p.place}`);
  } else if (e instanceof SourceValidationError) {
    console.error(e.message);
  } else {
    console.error(e instanceof Error ? e.message : String(e));
  }
  process.exit(1);
}
