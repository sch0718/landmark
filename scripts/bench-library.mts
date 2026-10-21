import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { regionsByPlace, regionPathsByPlace } from '../src/domain/library/region';
import {
  DEFAULT_QUERY,
  livePlaces,
  queryPlaces,
  labelCounts,
  regionTreeCounts,
} from '../src/domain/library/query';
import { buildClusterIndex } from '../src/components/map/cluster';
import type { Library } from '../src/schema/library';
import { toMarkers } from '../src/sections/map/markers';
import { TOKENS } from '../src/theme/tokens';

import { referenceRegions } from '../tests/unit/helpers/reference-regions';

function median(run: () => unknown, rounds = 15): number {
  for (let i = 0; i < 3; i++) run();
  const values = Array.from({ length: rounds }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return Number(values[Math.floor(values.length / 2)]!.toFixed(6));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error('사용법: bench-library.mts <백업 경로>');
  const backup = JSON.parse(readFileSync(file, 'utf8')) as { library: Library };
  const lib = backup.library;
  const places = livePlaces(lib);
  const markers = toMarkers(places, lib.labels, TOKENS.pastel.light, null);
  const before = referenceRegions(places);
  const after = regionsByPlace(places);
  if (JSON.stringify([...before]) !== JSON.stringify([...after]))
    throw new Error('이전 지역 결과와 달라요');
  const byId = new Map(markers.map((m) => [m.id, m]));
  const selectedId = markers[0]!.id;
  console.log(
    JSON.stringify(
      {
        places: places.length,
        labels: Object.keys(lib.labels).length,
        regionBeforeMs: median(() => referenceRegions(places)),
        regionColdMs: median(() => regionsByPlace([...places])),
        regionPathsColdMs: median(() => regionPathsByPlace([...places])),
        regionSharedMs: median(() => regionsByPlace(places)),
        queryAndCountsMs: median(() => {
          queryPlaces(lib, DEFAULT_QUERY);
          labelCounts(lib, DEFAULT_QUERY);
          regionTreeCounts(lib, DEFAULT_QUERY);
        }),
        clusterRebuildMs: median(() => buildClusterIndex(markers)),
        selectionBeforeMs: median(() =>
          buildClusterIndex(toMarkers(places, lib.labels, TOKENS.pastel.light, selectedId)),
        ),
        selectionAfterMs: median(() => ({
          ...byId.get(selectedId)!,
          selected: true,
          clusterable: false,
        })),
      },
      null,
      2,
    ),
  );
}
