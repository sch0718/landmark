import { isMap, isSeq, type Document } from 'yaml';

const STOP_ID_LEN = 4;
const PUBLIC_ID_LEN = 10;
const MAX_ATTEMPTS = 1000;

/**
 * yaml Document에 publicId와 stop id를 채운다. Document에 직접 써서 주석을 보존한다.
 * 이미 있는 값은 건드리지 않는다.
 */
export function ensureIds(doc: Document, random: (len: number) => string): { changed: boolean } {
  let changed = false;

  if (!doc.has('publicId')) {
    doc.set('publicId', random(PUBLIC_ID_LEN));
    changed = true;
  }

  const days = doc.get('days', true);
  if (!isSeq(days)) return { changed };

  const taken = new Set<string>();
  const missing: { set: (id: string) => void }[] = [];
  for (const day of days.items) {
    if (!isMap(day)) continue;
    const stops = day.get('stops', true);
    if (!isSeq(stops)) continue;
    for (const stop of stops.items) {
      if (!isMap(stop)) continue;
      const id = stop.get('id');
      if (typeof id === 'string') taken.add(id);
      else missing.push({ set: (value) => stop.set('id', value) });
    }
  }

  for (const target of missing) {
    let id = random(STOP_ID_LEN);
    for (let attempt = 1; taken.has(id); attempt += 1) {
      if (attempt >= MAX_ATTEMPTS) throw new Error('stop id를 만들지 못했습니다(충돌이 계속됨)');
      id = random(STOP_ID_LEN);
    }
    taken.add(id);
    target.set(id);
    changed = true;
  }

  return { changed };
}
