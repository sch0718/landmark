export const AGENT_INBOX_KEY = 'tripmap:agent-inbox:v1';
export type AgentInboxLocal = {
  v: 1;
  userId: string | null;
  notified: string[];
  /** 이미 알린 AI 변경 기록 id예요. 옛 값에는 없어 빈 배열로 읽어요. */
  notifiedChanges: string[];
};
const KEEP = 100;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string').slice(-KEEP)
    : [];

export function readAgentInboxLocal(storage: Storage, userId: string | null): AgentInboxLocal {
  const empty: AgentInboxLocal = { v: 1, userId, notified: [], notifiedChanges: [] };
  try {
    const value: unknown = JSON.parse(storage.getItem(AGENT_INBOX_KEY) ?? 'null');
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('v' in value) ||
      value.v !== 1 ||
      !('userId' in value) ||
      value.userId !== userId ||
      !('notified' in value) ||
      !Array.isArray(value.notified)
    )
      return empty;
    return {
      v: 1,
      userId,
      notified: strings(value.notified),
      notifiedChanges: 'notifiedChanges' in value ? strings(value.notifiedChanges) : [],
    };
  } catch {
    return empty;
  }
}

export function writeAgentInboxLocal(storage: Storage, value: AgentInboxLocal): void {
  try {
    storage.setItem(
      AGENT_INBOX_KEY,
      JSON.stringify({
        v: 1,
        userId: value.userId,
        notified: value.notified.slice(-KEEP),
        notifiedChanges: value.notifiedChanges.slice(-KEEP),
      }),
    );
  } catch {
    // 알림 기록을 저장하지 못해도 받은함은 계속 쓸 수 있어요.
  }
}
