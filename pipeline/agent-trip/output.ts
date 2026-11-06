import type { TripIssue } from './errors';
import type { BuildResult } from './run-build';

export type CommandName = 'build' | 'send' | 'share' | 'whoami' | 'unshare' | 'library';

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
  if (r === null) {
    const lines: string[] = [];
    if (extra.connection) {
      const connection = extra.connection as {
        name: string;
        scopes: string[];
        expiresAt: string;
        provider: string;
      };
      lines.push(
        `AI 연결: ${connection.name}`,
        `범위: ${connection.scopes.join(', ')}`,
        `만료: ${connection.expiresAt}`,
        `공급자: ${connection.provider}`,
      );
    } else if (extra.shares) {
      const shares = extra.shares as { id: string; title: string; expiresAt: string }[];
      lines.push(...shares.map((x) => `${x.id} · ${x.title} · 만료 ${x.expiresAt}`));
      if (shares.length === 0) lines.push('저장한 공유 링크가 없어요');
    } else if (extra.removed) {
      lines.push(`공유 링크를 지웠어요: ${(extra.removed as { id: string }).id}`);
    } else if (extra.items) {
      const items = extra.items as { kind: string; id: string; rev: number; label: string }[];
      lines.push(...items.map((x) => `${x.kind} ${x.id} · rev ${x.rev} · ${x.label}`));
      if (items.length === 0) lines.push('항목이 없어요');
    } else if (extra.item) {
      const item = extra.item as { kind: string; id: string; rev: number; doc: unknown };
      lines.push(`${item.kind} ${item.id} · rev ${item.rev}`, JSON.stringify(item.doc, null, 2));
    } else if (extra.edit) {
      const e = extra.edit as {
        op: string;
        kind: string;
        id: string;
        rev: number | null;
        requestId: string;
      };
      lines.push(
        `${e.op === 'put' ? '저장' : '삭제'}했어요: ${e.kind} ${e.id} · rev ${e.rev ?? '변화 없음'}`,
        `요청 id: ${e.requestId}`,
      );
    } else if (extra.changes) {
      const changes = extra.changes as {
        id: string;
        requestId: string;
        kind: string;
        itemId: string;
        beforeRev: number;
        afterRev: number;
        label: string;
        at: number;
        undoneAt: number | null;
      }[];
      lines.push(
        ...changes.map(
          (c) =>
            `${c.id} · ${c.kind} ${c.itemId} · ${c.label} · rev ${c.beforeRev}→${c.afterRev} · ${new Date(c.at).toISOString()} · 요청 ${c.requestId}${c.undoneAt === null ? '' : ' · 되돌림'}`,
        ),
      );
      if (changes.length === 0) lines.push('AI 변경 기록이 없어요');
    } else if (extra.undo) {
      lines.push(...(extra.undo as { id: string }[]).map((x) => `되돌렸어요: ${x.id}`));
    } else lines.push(`${command} 성공`, JSON.stringify(extra, null, 2));
    lines.push(...((extra.warnings ?? []) as TripIssue[]).map((x) => `경고: ${x.message}`));
    return lines.join('\n');
  }
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
  if (extra.inbox) {
    const inbox = extra.inbox as { id: string; expiresAt: string; created: boolean };
    lines.push(
      `받은함: ${inbox.id} · 만료 ${inbox.expiresAt}${inbox.created ? '' : ' · 이미 보낸 일정이에요'}`,
    );
  }
  if (extra.share) lines.push(`공유 만료: ${(extra.share as { expiresAt: string }).expiresAt}`);
  if (extra.links) {
    const links = extra.links as { short: string; view: string };
    lines.push(`짧은 링크: ${links.short}`, `보기: ${links.view}`);
  } else {
    if (!extra.inbox && Object.keys(extra).length > 0) lines.push(JSON.stringify(extra, null, 2));
    lines.push(`보기: ${r.doc.view}`, `가져오기: ${r.doc.importHref}`);
  }
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
