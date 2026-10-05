import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import process from 'node:process';
import console from 'node:console';

const directory = process.argv[2] ?? 'dist/assets';
const files = (await readdir(directory)).filter((name) => /\.(js|css)$/.test(name)).sort();
const rows = [];
for (const name of files) {
  const data = await readFile(join(directory, name));
  rows.push({ name, bytes: data.length, gzipBytes: gzipSync(data).length });
}
const totals = (extension) =>
  rows
    .filter((row) => row.name.endsWith(extension))
    .reduce(
      (sum, row) => ({ bytes: sum.bytes + row.bytes, gzipBytes: sum.gzipBytes + row.gzipBytes }),
      { bytes: 0, gzipBytes: 0 },
    );
console.log(
  JSON.stringify(
    {
      files: rows,
      js: totals('.js'),
      css: totals('.css'),
      totalBytes: rows.reduce((n, r) => n + r.bytes, 0),
      totalGzipBytes: rows.reduce((n, r) => n + r.gzipBytes, 0),
    },
    null,
    2,
  ),
);
