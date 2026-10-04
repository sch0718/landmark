import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type FsPort = {
  readText(p: string): Promise<string>;
  /** 같은 디렉터리의 임시 파일에 쓴 뒤 rename한다. */
  writeTextAtomic(p: string, s: string): Promise<void>;
  /** dir 바로 아래의 `ext`로 끝나는 파일 경로(dir 포함)를 이름순으로. dir이 없으면 빈 배열. */
  listFiles(dir: string, ext: string): Promise<string[]>;
};

export function createNodeFs(): FsPort {
  return {
    readText: (p) => readFile(p, 'utf-8'),
    async writeTextAtomic(p, s) {
      await mkdir(dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.tmp`;
      await writeFile(tmp, s);
      await rename(tmp, p);
    },
    async listFiles(dir, ext) {
      try {
        return (await readdir(dir))
          .filter((n) => n.endsWith(ext))
          .sort()
          .map((n) => join(dir, n));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw e;
      }
    },
  };
}
