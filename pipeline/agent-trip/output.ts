import type { TripIssue } from './errors';
import type { BuildResult } from './run-build';

export type CommandName = 'build' | 'send' | 'share' | 'whoami' | 'unshare';

/** 추가 정보에는 비밀 값을 넣지 말 것. */
export function successJson(
  command: CommandName,
  r: BuildResult | null,
  extra: Record<string, unknown>,
): string {
  return JSON.stringify({
    ok: true,
    command,
    ...(r === null
      ? {}
      : {
          trip: {
            title: r.doc.doc.trips[0]!.title,
            startDate: r.plan.startDate,
            endDate: r.plan.endDate,
            places: r.doc.doc.places.length,
          },
          days: r.days,
          routes: r.stats,
          links: { view: r.doc.view, import: r.doc.importHref },
          warnings: r.warnings,
        }),
    ...extra,
  });
}

export function failureJson(command: CommandName, issues: TripIssue[]): string {
  return JSON.stringify({ ok: false, command, errors: issues });
}

/** 추가 정보에는 비밀 값을 넣지 말 것. */
export function successText(
  command: CommandName,
  r: BuildResult | null,
  extra: Record<string, unknown>,
): string {
  if (r === null) return `${command} 성공\n${JSON.stringify(extra, null, 2)}`;
  const lines = [
    `${r.doc.doc.trips[0]!.title} · ${r.plan.startDate}~${r.plan.endDate} · 장소 ${r.doc.doc.places.length}곳`,
    ...r.days.map(
      (day, i) =>
        `Day ${i + 1} ${day.date} · ${day.stops
          .map((stop) => `${stop.name} → ${stop.arrive}~${stop.depart}`)
          .join(' · ')} · 이동 ${day.travelMin}분 · 추정 ${day.estimatedLegs}구간`,
    ),
    ...r.warnings.map((issue) => `경고 ${issue.path}: ${issue.message}`),
  ];
  if (Object.keys(extra).length > 0) lines.push(JSON.stringify(extra, null, 2));
  lines.push(`보기: ${r.doc.view}`, `가져오기: ${r.doc.importHref}`);
  return lines.join('\n');
}

export function failureText(issues: TripIssue[]): string {
  return issues
    .map((issue) => {
      const line = `오류${issue.path ? ` ${issue.path}` : ''} (${issue.code}): ${issue.message}`;
      const candidates = (issue.candidates ?? []).map(
        (c) => `  ${c.naverSid} · ${c.name} · ${c.address} · ${c.category}`,
      );
      return [line, ...candidates].join('\n');
    })
    .join('\n');
}
