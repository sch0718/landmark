import { COLLAB_LIMITS } from './constants';
export type ProgressOp = { stopId: string; visited: boolean; date: string; at: string };
export type NextOp = { stopId: string | null; date: string; at: string };
export type ProgressMark = {
  stopId: string;
  date: string;
  at: string;
  by: { device: string; label: string };
};
export type SharedNext = { stopId: string; date: string; at: string; label: string };
export type SharedProgress = { prev: number; marks: ProgressMark[]; next: SharedNext | null };
export function sharedMarkOf(
  progress: SharedProgress | null,
  stopId: string,
  period: { startDate: string; endDate: string },
): ProgressMark | null {
  return (
    progress?.marks.find(
      (m) => m.stopId === stopId && m.date >= period.startDate && m.date <= period.endDate,
    ) ?? null
  );
}
export function sharedNextIndex(
  progress: SharedProgress | null,
  date: string,
  stopIds: readonly string[],
  visited: readonly boolean[],
): number | null {
  if (!progress?.next || progress.next.date !== date) return null;
  const index = stopIds.indexOf(progress.next.stopId);
  return index >= 0 && !visited[index] ? index : null;
}
export function queueOp(
  queue: readonly ProgressOp[],
  op: ProgressOp,
  max: number = COLLAB_LIMITS.pendingOps,
): ProgressOp[] {
  return [...queue.filter((p) => p.stopId !== op.stopId), op].slice(-max);
}
export function withLocalOps(
  progress: SharedProgress | null,
  ops: readonly ProgressOp[],
  me: { device: string; label: string },
): SharedProgress {
  const marks = new Map(progress?.marks.map((m) => [m.stopId, { ...m, by: { ...m.by } }]) ?? []);
  const latest = new Map(progress?.marks.map((m) => [m.stopId, m.at]) ?? []);
  for (const op of ops) {
    if ((latest.get(op.stopId) ?? '') > op.at) continue;
    latest.set(op.stopId, op.at);
    if (op.visited)
      marks.set(op.stopId, { stopId: op.stopId, date: op.date, at: op.at, by: { ...me } });
    else marks.delete(op.stopId);
  }
  return {
    prev: progress?.prev ?? 0,
    marks: [...marks.values()],
    next: progress?.next ? { ...progress.next } : null,
  };
}
