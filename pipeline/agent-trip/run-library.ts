import {
  decodeItem,
  ITEM_KINDS,
  itemLabel,
  type AnyItem,
  type ItemKind,
} from 'src/domain/library-sync/items';
import type { AgentReply, createAgentClient, LibraryPage } from './client';
import { EXIT, exitFor, TripFailure, type TripErrorCode, type TripIssue } from './errors';

type Client = ReturnType<typeof createAgentClient>;
export type LibraryArgs = {
  positionals: string[];
  kind?: string;
  file?: string;
  baseRev?: string;
  request?: string;
};
export type LibraryDeps = { client: Client; readFile(path: string): Promise<string> };
const MAX_PAGES = 200;

const bad = (message: string): never => {
  throw new TripFailure([{ path: '', code: 'schema', message }], EXIT.input);
};
const reject = (code: TripErrorCode, path: string, message: string, reason?: string): never => {
  throw new TripFailure([{ path, code, message, ...(reason ? { reason } : {}) }], exitFor(code));
};
function unwrap<T>(reply: AgentReply<T>): T {
  if (!reply.ok) throw new TripFailure([reply.issue], exitFor(reply.issue.code));
  return reply.data;
}
const asKind = (value: string | undefined): ItemKind => {
  if (!ITEM_KINDS.includes(value as ItemKind))
    bad(`종류는 ${ITEM_KINDS.join('|')} 중 하나여야 해요`);
  return value as ItemKind;
};
function baseRev(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    bad('--base-rev <N>이 필요해요(0 이상의 정수, 새 항목은 0)');
  return Number(value);
}

/** 서버 사본 전체(지워진 항목 포함)를 페이지 끝까지 읽는다. */
async function readAll(client: Client): Promise<LibraryPage['items']> {
  const items: LibraryPage['items'] = [];
  let next = { rev: 0, key: '' };
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = unwrap(await client.libraryChanges(next));
    items.push(...page.items);
    if (!page.more) return items;
    // 다음 위치가 나아가지 않으면 같은 페이지를 끝없이 읽게 된다.
    if (page.next.rev === next.rev && page.next.key === next.key)
      reject('server', '', '서버가 다음 페이지 위치를 주지 않아요');
    next = page.next;
  }
  return reject('server', '', '서버 기록이 너무 길어 끝까지 읽지 못했어요');
}

const editStatusCode: Record<string, TripErrorCode> = {
  conflict: 'conflict',
  missing: 'missing',
  referenced: 'referenced',
  'invalid-ref': 'invalid-ref',
};
const editMessages: Record<string, string> = {
  conflict: '그 사이 항목이 바뀌었어요. 다시 읽고 --base-rev를 맞춰 주세요',
  missing: '없거나 이미 지워진 항목이에요',
  referenced: '지워지지 않은 여행이 이 장소를 쓰고 있어요',
  'invalid-ref': '여행이 가리키는 장소가 보관함에 없어요',
  invalid: '서버가 문서를 받아들이지 않았어요',
  'too-large': '문서가 너무 크거나 보관함 상한을 넘었어요',
  clock: '문서의 시각이 서버 시각과 너무 달라요',
};

async function edit(
  deps: LibraryDeps,
  op: 'put' | 'delete',
  kind: ItemKind,
  id: string,
  rev: number,
  doc?: AnyItem,
): Promise<Record<string, unknown>> {
  const requestId = crypto.randomUUID();
  const reply = unwrap(
    await deps.client.libraryEdit({
      v: 1,
      requestId,
      ops: [{ op, kind, id, baseRev: rev, ...(doc === undefined ? {} : { doc }) }],
    }),
  );
  const result = reply.results.find((x) => x.kind === kind && x.id === id);
  if (!result) return reject('server', '', '서버가 이 항목의 결과를 주지 않았어요');
  if (result.status !== 'ok') {
    const code = editStatusCode[result.status] ?? 'rejected';
    const current =
      result.status === 'conflict' && result.rev !== undefined ? ` (현재 rev ${result.rev})` : '';
    return reject(
      code,
      `${kind}:${id}`,
      `${result.status}: ${editMessages[result.status] ?? '서버가 거절했어요'}${current}`,
      code === 'rejected' ? result.status : undefined,
    );
  }
  return { edit: { op, kind, id, rev: result.rev ?? null, requestId } };
}

/** 하위 명령을 실행하고 출력에 쓸 추가 정보를 돌려준다. */
export async function runLibrary(
  args: LibraryArgs,
  deps: LibraryDeps,
): Promise<Record<string, unknown>> {
  const [, sub, a, b] = args.positionals;
  const count = args.positionals.length;
  const noExtra = (...keys: (keyof LibraryArgs)[]) => {
    const allowed = new Set(['positionals', ...keys]);
    if (Object.entries(args).some(([k, v]) => v !== undefined && !allowed.has(k)))
      bad('이 하위 명령에서 받지 않는 옵션이에요');
  };
  switch (sub) {
    case 'list': {
      noExtra('kind');
      if (count !== 2) bad('사용법: yarn trip library list [--kind <종류>]');
      const kind = args.kind === undefined ? undefined : asKind(args.kind);
      const items = (await readAll(deps.client))
        .filter((x) => !x.deleted && (kind === undefined || x.kind === kind))
        .map((x) => ({
          kind: x.kind,
          id: x.id,
          rev: x.rev,
          label: itemLabel(x.kind as ItemKind, x.doc as AnyItem),
        }));
      return { items };
    }
    case 'get': {
      noExtra();
      if (count !== 4) bad('사용법: yarn trip library get <종류> <id>');
      const kind = asKind(a);
      const found = (await readAll(deps.client)).find((x) => x.kind === kind && x.id === b);
      if (!found || found.deleted)
        return reject('missing', `${kind}:${b}`, '없거나 지워진 항목이에요');
      return { item: { kind, id: b, rev: found.rev, doc: found.doc } };
    }
    case 'put': {
      noExtra('file', 'baseRev');
      if (count !== 4 || !args.file)
        bad('사용법: yarn trip library put <종류> <id> --file <문서.json> --base-rev <N>');
      const kind = asKind(a);
      const rev = baseRev(args.baseRev);
      let value: unknown;
      try {
        value = JSON.parse(await deps.readFile(args.file!));
      } catch {
        return bad('--file을 읽거나 JSON으로 해석하지 못했어요');
      }
      const decoded = decodeItem(kind, b!, value);
      if (!decoded.ok)
        return bad(
          decoded.reason === 'too-large'
            ? '문서가 너무 커요'
            : `문서가 ${kind} 스키마에 맞지 않거나 id가 인자와 달라요`,
        );
      return edit(deps, 'put', kind, b!, rev, decoded.doc);
    }
    case 'delete': {
      noExtra('baseRev');
      if (count !== 4) bad('사용법: yarn trip library delete <종류> <id> --base-rev <N>');
      return edit(deps, 'delete', asKind(a), b!, baseRev(args.baseRev));
    }
    case 'changes': {
      noExtra();
      if (count !== 2) bad('사용법: yarn trip library changes');
      const { changes } = unwrap(await deps.client.libraryEdits());
      return { changes };
    }
    case 'undo': {
      noExtra('request');
      if ((args.request === undefined) === (a === undefined) || count > 3)
        bad('사용법: yarn trip library undo <변경 id> 또는 --request <requestId>');
      // --request는 서버가 한 번에 상한만큼만 처리하므로 more가 false가 될 때까지 다시 부른다.
      // 같은 id는 나중 응답이 이기되, 앞에서 되돌린 것을 뒤의 already로 덮지 않는다.
      const merged = new Map<string, string>();
      for (;;) {
        const page = unwrap(
          await deps.client.libraryUndo(
            args.request === undefined ? { ids: [a!] } : { requestId: args.request },
          ),
        );
        for (const x of page.results)
          if (!merged.has(x.id) || x.status !== 'already') merged.set(x.id, x.status);
        // 한 건도 되돌리지 못했는데 more면 같은 것을 다시 받으니 멈춘다.
        if (!page.more || !page.results.some((x) => x.status === 'undone')) break;
      }
      const results = [...merged].map(([id, status]) => ({ id, status }));
      const failed = results.filter((x) => x.status !== 'undone');
      if (failed.length) {
        const done = results.length - failed.length;
        const labels: Record<string, string> = {
          changed: '그 사이 바뀌어서 그대로 뒀어요',
          already: '이미 되돌린 변경이에요',
          gone: '기록이 만료됐어요',
        };
        throw new TripFailure(
          failed.map((x): TripIssue => ({
            path: x.id,
            code: 'rejected',
            reason: x.status,
            message: `${x.status}: ${labels[x.status] ?? '되돌리지 못했어요'}${done ? ` (${done}건은 되돌렸어요)` : ''}`,
          })),
          EXIT.server,
        );
      }
      return { undo: results };
    }
    default:
      return bad(
        '사용법: yarn trip library list|get|put|delete|changes|undo (자세히: yarn trip library --help)',
      );
  }
}
