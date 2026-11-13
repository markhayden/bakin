/**
 * Start a conversation with an agent from Home: create the chat, then send
 * the first message (Chat's own two routes; plugins talk over HTTP here,
 * never by import).
 *
 * Nothing typed is ever lost. If the chat was created but the message did
 * not send, the text is left as that chat's composer draft and the caller
 * still navigates there. If the chat could not be created, the caller keeps
 * the text where it was.
 */
import { writeComposerDraft } from '@makinbakin/sdk/conversation'
import { pluginFetch } from '@makinbakin/sdk/utils'

export interface StartChatResult {
  /** The chat to open, or null when none could be created. */
  chatId: string | null
  /** The first message reached the server. */
  sent: boolean
}

export interface StartChatDeps {
  fetch?: typeof pluginFetch
  saveDraft?: (storageKey: string, text: string) => void
}

const JSON_POST = { method: 'POST', headers: { 'Content-Type': 'application/json' } } as const

export async function startChat(agentId: string, content: string, deps: StartChatDeps & { title?: string } = {}): Promise<StartChatResult> {
  const request = deps.fetch ?? pluginFetch
  const saveDraft = deps.saveDraft ?? writeComposerDraft
  let chatId: string
  try {
    const created = await request('chat', 'chats', { ...JSON_POST, body: JSON.stringify({ agentId, ...(deps.title ? { title: deps.title } : {}) }) })
    if (!created.ok) return { chatId: null, sent: false }
    const body = await created.json() as { chat?: { id?: unknown } }
    if (typeof body.chat?.id !== 'string') return { chatId: null, sent: false }
    chatId = body.chat.id
  } catch {
    return { chatId: null, sent: false }
  }
  let sent = false
  try {
    sent = (await request('chat', `chats/${encodeURIComponent(chatId)}/messages`, { ...JSON_POST, body: JSON.stringify({ content }) })).ok
  } catch {
    sent = false
  }
  // Chat's composer for an existing chat reads its draft from this key.
  if (!sent) saveDraft(`chat:${chatId}`, content)
  return { chatId, sent }
}

/**
 * A starter that needs a file: hand the words to Chat's draft composer for
 * this agent, where the person attaches the file and sends. Returns the
 * path to open.
 */
export function draftChatWith(agentId: string, content: string, deps: Pick<StartChatDeps, 'saveDraft'> = {}): string {
  ;(deps.saveDraft ?? writeComposerDraft)(`chat-draft:${agentId}`, content)
  return `/chat/new?agent=${encodeURIComponent(agentId)}`
}
