export const AGENT_INBOX_KEY = 'tripmap:agent-inbox:v1';
export type AgentInboxLocal = { v: 1; userId: string | null; notified: string[] };

export function readAgentInboxLocal(storage: Storage, userId: string | null): AgentInboxLocal {
  const empty: AgentInboxLocal = { v: 1, userId, notified: [] };
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
      notified: value.notified.filter((id): id is string => typeof id === 'string').slice(-100),
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
        notified: value.notified.slice(-100),
      }),
    );
  } catch {
    // 알림 기록을 저장하지 못해도 받은함은 계속 쓸 수 있어요.
  }
}
