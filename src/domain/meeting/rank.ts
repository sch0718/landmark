import { haversineM, type LngLat } from 'src/domain/trips/geo';
import type { Meeting, MeetingRank } from 'src/schema/meeting';
import type { Hub } from './hubs';

export { haversineM };
export type CellValue = number | null;
export type Score = { max: number; avg: number; spread: number; complete: boolean };

export function scoreRow(values: readonly CellValue[]): Score | null {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  const max = Math.max(...known);
  return {
    max,
    avg: known.reduce((sum, v) => sum + v, 0) / known.length,
    spread: max - Math.min(...known),
    complete: known.length === values.length,
  };
}

export function rankRows<T extends { id: string; values: CellValue[] }>(
  rows: readonly T[],
  rank: MeetingRank,
): (T & { score: Score | null })[] {
  const second = rank === 'max' ? 'avg' : 'max';
  return rows
    .map((r) => ({ ...r, score: scoreRow(r.values) }))
    .sort((a, b) => {
      if (a.score === null || b.score === null)
        return a.score === b.score ? a.id.localeCompare(b.id) : a.score === null ? 1 : -1;
      return (
        Number(b.score.complete) - Number(a.score.complete) ||
        a.score[rank] - b.score[rank] ||
        a.score[second] - b.score[second] ||
        a.id.localeCompare(b.id)
      );
    });
}

/** 경로를 묻기 전에 가장 먼 사람의 직선거리로 후보 역 수를 줄인다. */
export function preselectHubs(origins: readonly LngLat[], hubs: readonly Hub[], n = 8): Hub[] {
  if (origins.length === 0) return [];
  const rows = hubs.map((h) => ({
    ...h,
    values: origins.map((o) => haversineM(o, [h.lng, h.lat])),
  }));
  const ids = rankRows(rows, 'max')
    .slice(0, Math.max(0, n))
    .map((h) => h.id);
  const byId = new Map(hubs.map((h) => [h.id, h]));
  return ids.map((id) => byId.get(id)!);
}

/** 일시가 있으면 한 시간 전, 없으면 지금의 한국 시각을 쓴다. */
export function transitDeparture(at: Meeting['at']['value'], now: Date): string {
  const instant =
    at === null ? now.getTime() : new Date(`${at.date}T${at.time}:00+09:00`).getTime() - 3_600_000;
  return new Date(instant + 9 * 3_600_000).toISOString().slice(0, 16);
}
