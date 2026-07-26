/**
 * Chat view — one conversation on the kit: header (avatar, inline-editable
 * title, pin, working state), Conversation, Composer, ToolCallDrawer.
 * Draft mode renders the same shell before a chat exists; the chat is
 * created on first send.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, Pencil, Pin } from 'lucide-react'
import { toast } from '@makinbakin/sdk/hooks'
import {
  AgentAvatar,
  Composer,
  Conversation,
  ConversationEmptyState,
  QueuedMessageList,
  ToolCallDrawer,
  foldConversation,
  type ComposerHandle,
  type ConversationQueuedItem,
  type ConversationToolCall,
} from '@makinbakin/sdk/components'
import { useAgent } from '@makinbakin/sdk/hooks'

import { formatTokenCount, formatUsageCost } from '@makinbakin/sdk/components'

import {
  patchChatRequest,
  uploadAttachmentRequest,
  useAgentImageInput,
  useChatStream,
  type ChatSummaryDto,
  type ChatUsageTotals,
  type UploadedAttachment,
} from './use-chat-data'

interface StagedAttachment {
  id: string
  name: string
  previewUrl: string
  status: 'uploading' | 'ready'
  /** Set once the upload lands. */
  uploaded?: UploadedAttachment
}

/**
 * Staged-attachment state + Composer wiring, gated by the agent's
 * imageInput. Every add gives immediate feedback: an uploading chip that
 * becomes a removable thumbnail, or a toast when the upload fails.
 */
function useComposerAttachments(chatId: string, agentId: string) {
  const imageInput = useAgentImageInput(agentId)
  const [staged, setStaged] = useState<StagedAttachment[]>([])

  const onAdd = (files: File[]) => {
    for (const file of files) {
      const id = `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 7)}`
      const previewUrl = URL.createObjectURL(file)
      setStaged((prev) => [...prev, { id, name: file.name, previewUrl, status: 'uploading' }])
      void uploadAttachmentRequest(chatId, file).then((uploaded) => {
        if (uploaded) {
          setStaged((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'ready', uploaded } : a)))
        } else {
          setStaged((prev) => {
            URL.revokeObjectURL(previewUrl)
            return prev.filter((a) => a.id !== id)
          })
          toast(`Couldn't attach ${file.name} — upload failed`, 'error')
        }
      })
    }
  }

  const onRemove = (id: string) => {
    setStaged((prev) => {
      const item = prev.find((a) => a.id === id)
      if (item) URL.revokeObjectURL(item.previewUrl)
      // The uploaded file stays on disk until the chat is deleted — orphaned
      // staging files are bounded and swept with the chat (single-user box).
      return prev.filter((a) => a.id !== id)
    })
  }

  const take = (): UploadedAttachment[] => {
    const out = staged.filter((a) => a.uploaded).map((a) => a.uploaded!)
    for (const item of staged) URL.revokeObjectURL(item.previewUrl)
    setStaged([])
    return out
  }

  /** Re-stage already-uploaded files (queue-remove restore) — the files
   *  still live in the chat's attachment dir, so they're send-ready. */
  const restore = (items: Array<UploadedAttachment & { url?: string }>) => {
    setStaged((prev) => [
      ...prev,
      ...items.map((i) => ({
        id: `${Date.now()}-${i.name}-${Math.random().toString(36).slice(2, 7)}`,
        name: i.name,
        previewUrl: i.url ?? '',
        status: 'ready' as const,
        uploaded: { name: i.name, mimeType: i.mimeType, path: i.path },
      })),
    ])
  }

  return {
    take,
    restore,
    composerProps: {
      enabled: imageInput,
      disabledReason: `${agentId}'s model can't see images`,
      items: staged.map(({ id, name, previewUrl, status }) => ({ id, name, previewUrl, status })),
      onAdd,
      onRemove,
    },
  }
}

const CONTENT_MAX = 64_000

function InlineTitle({ chat, onChanged }: { chat: ChatSummaryDto; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title)

  useEffect(() => setDraft(chat.title), [chat.title])

  const commit = async () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (!trimmed || trimmed === chat.title) return
    await patchChatRequest(chat.id, { title: trimmed })
    onChanged()
  }

  if (editing) {
    return (
      <form
        className="flex min-w-0 flex-1 items-center gap-1"
        onSubmit={(e) => { e.preventDefault(); void commit() }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(chat.title); setEditing(false) } }}
          className="min-w-0 flex-1 rounded border border-ring bg-transparent px-1.5 py-0.5 text-sm font-medium focus:outline-none"
          aria-label="Chat title"
          autoFocus
        />
        <button type="submit" aria-label="Save title" className="rounded p-1 text-muted-foreground hover:text-foreground">
          <Check className="size-3.5" />
        </button>
      </form>
    )
  }
  return (
    <button
      type="button"
      data-chat-title
      onClick={() => setEditing(true)}
      title="Rename chat"
      className="group/title flex min-w-0 flex-1 items-center gap-1.5 text-left"
    >
      <span className="truncate text-sm font-medium">{chat.title || 'New chat'}</span>
      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100" />
    </button>
  )
}

function ViewHeader({
  agentId,
  chat,
  streaming,
  usageTotals,
  streamingOutEstimate = 0,
  onChanged,
  refreshChat,
}: {
  agentId: string
  chat: ChatSummaryDto | null
  streaming: boolean
  usageTotals?: ChatUsageTotals | null
  /** ~tokens of the in-flight reply streamed so far (0 when idle). */
  streamingOutEstimate?: number
  onChanged: () => void
  refreshChat?: () => Promise<void>
}) {
  const agent = useAgent(agentId)
  // Usage totals chip (#733): the chat's recorded sum in PLAIN WORDS (the
  // Σ sigil confused people — review feedback) — hidden entirely when
  // nothing is recorded (absence, never zeros). Metered spend adds $.
  // While a reply streams, a clearly-marked estimate of the output so far
  // (~ + ellipsis) rides along and reconciles to the real number at settle;
  // it is NEVER blended into the recorded total.
  const totalParts: string[] = []
  if (usageTotals?.totalTokens !== undefined) totalParts.push(`${formatTokenCount(usageTotals.totalTokens)} tokens`)
  if (usageTotals?.costUsd !== undefined) totalParts.push(formatUsageCost(usageTotals.costUsd))
  if (streaming && streamingOutEstimate > 0) totalParts.push(`+~${formatTokenCount(streamingOutEstimate)} out…`)
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
      <AgentAvatar agentId={agentId} size="sm" />
      <div className="min-w-0 flex-1">
        {chat ? (
          <InlineTitle chat={chat} onChanged={onChanged} />
        ) : (
          <span className="text-sm font-medium">New chat</span>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{agent?.name ?? agentId}</span>
          {totalParts.length ? (
            <span
              data-chat-usage-totals
              title="Total recorded usage for this chat"
              className="text-muted-foreground/80"
            >
              · {totalParts.join(' · ')}
            </span>
          ) : null}
          {streaming ? (
            <span className="flex items-center gap-1" data-chat-header-working>
              · <Loader2 className="size-3 animate-spin" /> working…
            </span>
          ) : null}
        </div>
      </div>
      {chat ? (
        <button
          type="button"
          aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          onClick={() => {
            // Refresh the view's own chat state too — patching from stale
            // state made the second click re-pin forever.
            void patchChatRequest(chat.id, { pinned: !chat.pinned }).then(async () => {
              await refreshChat?.()
              onChanged()
            })
          }}
          className={`rounded p-1.5 transition-colors hover:bg-foreground/10 ${
            chat.pinned ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Pin className={`size-4 ${chat.pinned ? 'fill-current' : ''}`} />
        </button>
      ) : null}
    </div>
  )
}

/** A draft-mode attachment: staged locally as a File — nothing uploads
 *  until first send creates the chat to upload into (#730). */
interface DraftStagedFile {
  id: string
  name: string
  previewUrl: string
  file: File
}

/** Draft mode: agent picked, chat not yet persisted — created on first send. */
export function DraftChatView({
  agentId,
  onCreated,
  createAndSend,
}: {
  agentId: string
  onCreated: (chatId: string) => void
  createAndSend: (agentId: string, content: string, files?: File[]) => Promise<{ chatId: string | null; sent: boolean }>
}) {
  const agent = useAgent(agentId)
  const name = agent?.name ?? agentId
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imageInput = useAgentImageInput(agentId)
  const [staged, setStaged] = useState<DraftStagedFile[]>([])
  const draftComposer = useRef<ComposerHandle | null>(null)

  // Unmount (incl. agent switch — the parent keys this view by agent):
  // release every staged preview URL; they'd otherwise leak for the whole
  // page session.
  const stagedRef = useRef(staged)
  stagedRef.current = staged
  useEffect(
    () => () => {
      for (const s of stagedRef.current) URL.revokeObjectURL(s.previewUrl)
    },
    [],
  )

  const handleSend = async (content: string) => {
    setSending(true)
    setError(null)
    try {
      const res = await createAndSend(agentId, content, staged.map((s) => s.file))
      if (res.chatId) {
        // Navigate even when the message POST failed — the chat exists and
        // createAndSend preserved the text as its composer draft + toasted.
        for (const s of staged) URL.revokeObjectURL(s.previewUrl)
        setStaged([])
        onCreated(res.chatId)
      } else {
        setError('Could not start the chat — is the agent still in the roster?')
        // Total failure: put the typed text back (the composer cleared on send).
        draftComposer.current?.setText(content)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col" data-chat-draft>
      <ViewHeader agentId={agentId} chat={null} streaming={false} onChanged={() => {}} />
      <div className="flex flex-1 items-center justify-center p-6">
        <ConversationEmptyState
          title={`Chat with ${name}`}
          description="Ask anything — the agent keeps its Bakin tools and can create tasks mid-chat."
        />
      </div>
      {error ? (
        <div className="flex items-center gap-2 px-4 pb-2 text-sm text-destructive">
          <AlertTriangle className="size-4" /> {error}
        </div>
      ) : null}
      <Composer
        storageKey={`chat-draft:${agentId}`}
        placeholder={`Message ${name}…`}
        onSend={(content) => { void handleSend(content) }}
        busy={sending}
        handleRef={draftComposer}
        maxLength={CONTENT_MAX}
        attachments={{
          enabled: imageInput,
          disabledReason: `${name}'s model can't see images`,
          items: staged.map(({ id, name: fileName, previewUrl }) => ({ id, name: fileName, previewUrl, status: 'ready' as const })),
          onAdd: (files) => {
            setStaged((prev) => [
              ...prev,
              ...files.map((file) => ({
                id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 7)}`,
                name: file.name,
                previewUrl: URL.createObjectURL(file),
                file,
              })),
            ])
          },
          onRemove: (id) => {
            setStaged((prev) => {
              const item = prev.find((s) => s.id === id)
              if (item) URL.revokeObjectURL(item.previewUrl)
              return prev.filter((s) => s.id !== id)
            })
          },
        }}
      />
    </div>
  )
}

export function ChatView({ chatId, onChanged }: { chatId: string; onChanged: () => void }) {
  const { chat, messages, liveChunks, streaming, sendError, queued, removeQueued, turnUsage, usageTotals, send, abort, retry, refreshChat } = useChatStream(chatId)
  const [openCall, setOpenCall] = useState<ConversationToolCall | null>(null)
  const attachments = useComposerAttachments(chatId, chat?.agentId ?? '')
  const composerHandle = useRef<ComposerHandle | null>(null)

  // Rough output-so-far for the streaming reply (~4 chars/token) — shown
  // ONLY as a ~-labeled estimate on the header chip; real numbers arrive
  // at settle. Input tokens are unknowable mid-turn, so no input estimate.
  const streamingOutEstimate = useMemo(() => {
    if (!liveChunks?.length) return 0
    const chars = liveChunks.reduce(
      (n, c) => n + (c.type === 'text' ? (c.content?.length ?? 0) : 0),
      0,
    )
    return Math.round(chars / 4)
  }, [liveChunks])

  // Queue-remove restore (spec D8): an EMPTY composer gets the removed
  // message back — text and still-uploaded attachments — for editing.
  // "Empty" means no text AND no staged attachments (review finding:
  // text-only emptiness merged restored attachments into a staged set —
  // exactly the surprise-merging D8 forbids). Otherwise: discard.
  const handleRemoveQueued = async (item: ConversationQueuedItem) => {
    const removed = await removeQueued(item.id)
    if (!removed) return
    if (composerHandle.current?.isEmpty() && attachments.composerProps.items.length === 0) {
      composerHandle.current.setText(removed.content)
      const restorable = (removed.attachments ?? []).filter(
        (a): a is { name: string; mimeType: string; url?: string; path: string } =>
          typeof (a as { path?: unknown }).path === 'string',
      )
      if (restorable.length) attachments.restore(restorable)
    }
  }

  if (!chat) return null

  const turns = foldConversation(messages, liveChunks != null ? { liveChunks, liveAgentId: chat.agentId } : undefined)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ViewHeader agentId={chat.agentId} chat={chat} streaming={streaming} usageTotals={usageTotals} streamingOutEstimate={streamingOutEstimate} onChanged={onChanged} refreshChat={refreshChat} />

      <Conversation
        turns={turns}
        agentId={chat.agentId}
        turnUsage={turnUsage}
        onRetry={retry}
        onOpenCall={setOpenCall}
        emptyState={
          <ConversationEmptyState
            title={`Chat with ${chat.agentId}`}
            description="Ask anything — the agent keeps its Bakin tools and can create tasks mid-chat."
          />
        }
      />

      {sendError ? (
        <div className="flex items-center gap-2 px-4 pb-1 text-sm text-destructive">
          <AlertTriangle className="size-4" /> {sendError}
          <button type="button" onClick={retry} className="underline underline-offset-2 hover:text-foreground">
            Try again
          </button>
        </div>
      ) : null}

      <QueuedMessageList items={queued} onRemove={(item) => { void handleRemoveQueued(item) }} />

      <Composer
        storageKey={`chat:${chatId}`}
        placeholder="Message the agent…"
        onSend={(content) => { void send(content, attachments.take()) }}
        busy={streaming}
        onAbort={abort}
        queueMode
        queuedCount={queued.length}
        handleRef={composerHandle}
        maxLength={CONTENT_MAX}
        attachments={attachments.composerProps}
      />

      <ToolCallDrawer call={openCall} open={openCall !== null} onOpenChange={(open) => !open && setOpenCall(null)} />
    </div>
  )
}
