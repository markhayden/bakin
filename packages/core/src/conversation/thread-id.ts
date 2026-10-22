/**
 * conversationThreadId — the adapter-neutral durable thread key for embedded
 * conversation surfaces: `scope:entityId:agentId`, each part URL-encoded,
 * empty parts defaulting to 'default'. (The chat plugin uses its own
 * `chat:<chatId>` scheme; this is for entity-scoped threads like
 * brainstorms and plan reviews.)
 */
export function conversationThreadId(scope: string, entityId: string, agentId: string): string {
  return [scope, entityId, agentId].map(threadIdPart).join(':')
}

function threadIdPart(value: string): string {
  const trimmed = value.trim()
  return encodeURIComponent(trimmed || 'default')
}
