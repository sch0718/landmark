import { describe, expect, it } from 'vitest';
import type { FsPort } from '../../../pipeline/fs-port';
import { validateAll } from '../../../pipeline/validate';
import { makeTrip } from '../../fixtures/builders';

function memFs(files: Record<string, string>): FsPort {
  return {
    readText: async (p) => {
      const v = files[p];
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeTextAtomic: async (p, s) => {
      files[p] = s;
    },
    listFiles: async (dir, ext) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`) && p.endsWith(ext))
        .sort(),
  };
}

const GOOD_YAML = `title: t
startDate: 2026-11-14
endDate: 2026-11-14
folders: []
days:
  - date: 2026-11-14
    stops: []
`;

describe('validateAll', () => {
  it('파일이 없으면 통과', async () => {
    expect(await validateAll({ fs: memFs({}) })).toEqual({ ok: true, errors: [] });
  });

  it('올바른 yaml은 통과', async () => {
    const r = await validateAll({ fs: memFs({ 'trips/a.yaml': GOOD_YAML }) });
    expect(r.ok).toBe(true);
  });

  it('깨진 JSON은 파일명과 함께 실패', async () => {
    const r = await validateAll({
      fs: memFs({ 'trips/a.yaml': GOOD_YAML, 'public/data/abc.json': '{not json' }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.file).toBe('public/data/abc.json');
  });

  it('스키마 위반 yaml은 파일명과 경로를 담아 실패', async () => {
    const r = await validateAll({
      fs: memFs({ 'trips/bad.yaml': GOOD_YAML.replace('title: t', 'title: ""') }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ file: 'trips/bad.yaml' });
    expect(r.errors[0]!.message).toContain('title');
  });

  it('TripData의 folder에 shareId가 새어 나가면 실패', async () => {
    const t = makeTrip({ days: { '2026-11-14': ['A'] } });
    const good = JSON.stringify(t);
    const okRun = await validateAll({ fs: memFs({ [`public/data/${t.publicId}.json`]: good }) });
    expect(okRun.ok).toBe(true);
    const leaked = { ...t, folders: t.folders.map((f) => ({ ...f, shareId: 'secret' })) };
    const r = await validateAll({
      fs: memFs({ [`public/data/${t.publicId}.json`]: JSON.stringify(leaked) }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.file).toBe(`public/data/${t.publicId}.json`);
  });
});
