/**
 * Chat view — one conversation on the kit: header (avatar, inline-editable
 * title, pin, working state), Conversation, Composer, ToolCallDrawer.
 * Draft mode renders the same shell before a chat exists; the chat is
 * created on first send.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { AlertTriangle, Check, Pencil, Pin } from 'lucide-react'
import { toast } from '@makinbakin/sdk/hooks'
import { MarkdownContent } from '@makinbakin/sdk/content'
import {
  Composer,
  Conversation,
  ConversationEmptyState,
  QueuedMessageList,
  ToolCallDrawer,
  foldConversation,
  formatTokenCount,
  formatUsageCost,
  type ComposerHandle,
  type ConversationAgent,
  type ConversationQueuedItem,
  type ConversationTextFormat,
  type ConversationToolCall,
} from '@makinbakin/sdk/conversation'
import { useAgent, useAgentStore } from '@makinbakin/sdk/hooks'
import { AgentAvatar, PageComposer } from '@makinbakin/sdk/patterns'
import { Button, Input } from '@makinbakin/sdk/ui'
import { formatStructured, summarizeStructured, unwrapToolResult } from '@makinbakin/sdk/utils'

import { ContextMeter, contextMeterHasContent, type ContextMeterStats } from './context-meter'
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

// ─── Chat-owned conversation renderers ───────────────────────────────────────
// The kit's Conversation leaves rich text, tool summaries, and avatars to the
// consumer (consumer-owned renderer contract). These compose the focused SDK
// entrypoints — content markdown, patterns avatar, utils structured formatters.

function parseWholeJson(content: string): unknown {
  const trimmed = content.trim()
  const looksJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  if (!looksJson) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Structured (JSON) replies render as prose with the raw payload one disclosure away. */
function JsonReply({ parsed }: { parsed: unknown }) {
  const prose = formatStructured(parsed, { markdown: true, cap: 4000 })
  const isError =
    !!parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof (parsed as { error?: unknown }).error === 'string'
  const fenced = `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``

  if (!prose) return <MarkdownContent content={fenced} />
  return (
    <div
      data-conv-json=""
      className={`rounded-bakin-control border px-bakin-3 py-bakin-2 ${
        isError
          ? 'border-bakin-signal-danger/40 bg-bakin-signal-danger/5'
          : 'border-bakin-border-subtle/60 bg-bakin-surface-default/40'
      }`}
    >
      <MarkdownContent content={prose} />
      <details className="mt-bakin-1">
        <summary className="cursor-pointer select-none text-bakin-typography-size-meta text-bakin-text-muted hover:text-bakin-text-primary">
          Raw JSON
        </summary>
        <MarkdownContent content={fenced} />
      </details>
    </div>
  )
}

function renderChatText(content: string, format: ConversationTextFormat) {
  if (format !== 'markdown') {
    return <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{content}</pre>
  }
  const json = parseWholeJson(content)
  return json !== undefined ? <JsonReply parsed={json} /> : <MarkdownContent content={content} />
}

function formatChatToolSummary(summary: string): string {
  return summarizeStructured(unwrapToolResult(summary))
}

function ChatAvatar(agent: ConversationAgent) {
  return (
    <AgentAvatar
      agent={{ id: agent.id ?? '', name: agent.name, imageSrc: agent.avatarUrl ?? null }}
      size="sm"
      decorative
    />
  )
}

/** Roster-backed identity resolution for conversation turns (display name + headshot). */
function useConversationAgentResolver(fallbackAgentId?: string) {
  const agentMap = useAgentStore((state) => state.agentMap)
  const displaySettings = useAgentStore((state) => state.displaySettings)
  return (turnAgentId?: string): ConversationAgent | undefined => {
    const id = turnAgentId ?? fallbackAgentId
    if (!id) return undefined
    const resolved = agentMap[id]
    return {
      id,
      name: displaySettings[id]?.displayName ?? resolved?.name ?? id,
      ...(resolved?.headshot ? { avatarUrl: resolved.headshot } : {}),
    }
  }
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
      // Non-images (PDFs) stage as a name tile — a blob URL in an <img>
      // would render a broken thumbnail.
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
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
      // Attach is always available — PDFs ride the file lane (tools read
      // them); only IMAGE acceptance is gated on the model's eyes (#742).
      enabled: true,
      acceptedTypes: imageInput ? ['image/*', 'application/pdf'] : ['application/pdf'],
      disabledReason: imageInput ? undefined : `${agentId}'s model can't see images`,
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
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(chat.title); setEditing(false) } }}
          className="h-bakin-8 min-w-0 flex-1 px-bakin-2 py-bakin-1 font-bakin-typography-weight-semibold"
          aria-label="Chat title"
          autoFocus
        />
        <Button type="submit" variant="ghost" size="icon-xs" aria-label="Save title">
          <Check className="size-3.5" />
        </Button>
      </form>
    )
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      data-chat-title
      onClick={() => setEditing(true)}
      title="Rename chat"
      className="group/title min-w-0 flex-1 justify-start px-0 hover:bg-transparent"
    >
      <span className="truncate text-sm font-medium">{chat.title || 'New chat'}</span>
      <Pencil className="size-3 shrink-0 text-bakin-text-muted opacity-0 transition-opacity group-hover/title:opacity-100" />
    </Button>
  )
}

function ViewHeader({
  agentId,
  chat,
  usageTotals,
  contextStats,
  onChanged,
  refreshChat,
}: {
  agentId: string
  chat: ChatSummaryDto | null
  usageTotals?: ChatUsageTotals | null
  contextStats?: ContextMeterStats | null
  onChanged: () => void
  refreshChat?: () => Promise<void>
}) {
  const agent = useAgent(agentId)
  // Usage totals chip (#733): the chat's recorded sum in PLAIN WORDS (the
  // Σ sigil confused people — review feedback) — hidden entirely when
  // nothing is recorded (absence, never zeros). Metered spend adds $.
  // The live streaming estimate lives on the TURN (beside the shimmer),
  // not here — recorded numbers only in the header.
  const totalParts: string[] = []
  if (usageTotals?.totalTokens !== undefined) totalParts.push(`${formatTokenCount(usageTotals.totalTokens)} tokens`)
  if (usageTotals?.costUsd !== undefined) totalParts.push(formatUsageCost(usageTotals.costUsd))
  const agentIdentity = {
    id: agentId,
    name: agent?.name ?? agentId,
    imageSrc: agent?.headshot ?? null,
  }
  const hasHeaderMeta = contextMeterHasContent(contextStats) || totalParts.length > 0
  return (
    <div
      data-chat-header
      className="flex shrink-0 items-center gap-x-bakin-2 border-b border-bakin-border-subtle px-bakin-4 py-bakin-3"
    >
      {/* The avatar carries the agent identity (name in its tooltip +
          aria-label) — same convention as agent turns; no redundant name
          text. */}
      <span title={agent?.name ?? agentId} aria-label={`Agent: ${agent?.name ?? agentId}`}>
        <AgentAvatar agent={agentIdentity} size="sm" decorative />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-y-bakin-1">
      <div className="flex min-w-0 items-center gap-x-bakin-2">
      <div data-chat-header-title className="min-w-0 flex-1">
        {chat ? (
          <InlineTitle chat={chat} onChanged={onChanged} />
        ) : (
          <span className="text-sm font-medium">New chat</span>
        )}
      </div>
      {chat ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
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
          className={`rounded-bakin-pill ${
            chat.pinned ? 'text-bakin-signal-accent' : 'text-bakin-text-muted'
          }`}
        >
          <Pin className={`size-4 ${chat.pinned ? 'fill-current' : ''}`} />
        </Button>
      ) : null}
      </div>
      {/* The avatar and title occupy the same header row. Usage remains on
          its own stable line without pulling the title off-center. */}
      {hasHeaderMeta ? (
        <div
          data-chat-header-meta
          className="flex items-center gap-1.5 text-xs text-bakin-text-muted"
        >
          {/* The compaction bar (#737) leads — runtime truth only; renders
              nothing when there's nothing honest to show. */}
          <ContextMeter stats={contextStats} />
          {totalParts.length ? (
            <span
              data-chat-usage-totals
              title="Total recorded usage for this chat"
              className="text-bakin-text-muted/80"
            >
              {/* Separator only when the meter actually RENDERED — a
                  truthy stats object can still draw nothing (predicate
                  is the kit's single source of truth). */}
              {contextMeterHasContent(contextStats) ? '· ' : ''}{totalParts.join(' · ')}
            </span>
          ) : null}
        </div>
      ) : null}
      </div>
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
  composerHandleRef,
}: {
  agentId: string
  onCreated: (chatId: string) => void
  createAndSend: (agentId: string, content: string, files?: File[]) => Promise<{ chatId: string | null; sent: boolean }>
  /** Optional external handle (page-level shortcuts focus the composer). */
  composerHandleRef?: MutableRefObject<ComposerHandle | null>
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-chat-draft>
      <ViewHeader agentId={agentId} chat={null} onChanged={() => {}} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-bakin-6">
        <ConversationEmptyState
          title={`Chat with ${name}`}
          description="Ask anything — the agent keeps its Bakin tools and can create tasks mid-chat."
        />
      </div>
      {error ? (
        <div className="flex items-center gap-2 px-4 pb-2 text-sm text-bakin-signal-danger">
          <AlertTriangle className="size-4" /> {error}
        </div>
      ) : null}
      <PageComposer padding="flush">
        <Composer
          storageKey={`chat-draft:${agentId}`}
          placeholder={`Message ${name}…`}
          onSend={(content) => { void handleSend(content) }}
          busy={sending}
          handleRef={(handle) => {
            draftComposer.current = handle
            if (composerHandleRef) composerHandleRef.current = handle
          }}
          maxLength={CONTENT_MAX}
          attachments={{
            enabled: true,
            // PDFs always pass (#742 file lane — tools read those, not the
            // model's eyes); images only when the model can see.
            acceptedTypes: imageInput ? ['image/*', 'application/pdf'] : ['application/pdf'],
            disabledReason: imageInput ? undefined : `${name}'s model can't see images`,
            items: staged.map(({ id, name: fileName, previewUrl }) => ({ id, name: fileName, previewUrl, status: 'ready' as const })),
            onAdd: (files) => {
              setStaged((prev) => [
                ...prev,
                ...files.map((file) => ({
                  id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 7)}`,
                  name: file.name,
                  previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
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
      </PageComposer>
    </div>
  )
}

export function ChatView({ chatId, onChanged, composerHandleRef }: {
  chatId: string
  onChanged: () => void
  /** Optional external handle (page-level shortcuts focus the composer). */
  composerHandleRef?: MutableRefObject<ComposerHandle | null>
}) {
  const { chat, messages, liveChunks, streaming, sendError, queued, removeQueued, turnUsage, usageTotals, contextStats, send, abort, retry, refreshChat } = useChatStream(chatId)
  const resolveAgent = useConversationAgentResolver(chat?.agentId)
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-chat-view>
      <ViewHeader agentId={chat.agentId} chat={chat} usageTotals={usageTotals} contextStats={contextStats} onChanged={onChanged} refreshChat={refreshChat} />

      <Conversation
        turns={turns}
        mode="contained"
        agent={resolveAgent(chat.agentId)}
        resolveAgent={resolveAgent}
        renderText={renderChatText}
        renderAvatar={ChatAvatar}
        formatToolSummary={formatChatToolSummary}
        className="flex-1"
        turnUsage={turnUsage}
        liveOutEstimate={streamingOutEstimate}
        onRetry={retry}
        onOpenCall={setOpenCall}
        emptyState={
          <ConversationEmptyState
            title={`Chat with ${chat.agentId}`}
            description="Ask anything — the agent keeps its Bakin tools and can create tasks mid-chat."
          />
        }
      />

      <PageComposer padding="flush">
        {sendError ? (
          <div className="flex items-center gap-bakin-2 px-bakin-4 pb-bakin-1 text-sm text-bakin-signal-danger">
            <AlertTriangle className="size-4" /> {sendError}
            <Button type="button" variant="link" size="xs" onClick={retry}>
              Try again
            </Button>
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
          handleRef={(handle) => {
            composerHandle.current = handle
            if (composerHandleRef) composerHandleRef.current = handle
          }}
          maxLength={CONTENT_MAX}
          attachments={attachments.composerProps}
        />
      </PageComposer>

      <ToolCallDrawer call={openCall} open={openCall !== null} onOpenChange={(open) => !open && setOpenCall(null)} />
    </div>
  )
}
