/**
 * messaging.send/stream — one Pi agent turn per call.
 *
 * Per turn: resolve the agent record → open/resume the thread's session
 * (sessions.ts) → assemble resources (AGENTS.md via cwd discovery, other
 * canonical files appended to the system prompt, Bakin exec tools bridged
 * in-process) → prompt() → map events/usage/failures to contract shapes.
 * Sessions are disposed after the turn settles; the JSONL file carries
 * conversation state. All failures leave through errors.ts.
 */
import { readFileSync, realpathSync } from 'fs'
import { createHash } from 'crypto'
import { randomUUID } from 'crypto'

import {
  createAgentSession,
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent'

import type {
  AdapterInitOpts,
  AdapterLogger,
  AdapterToolActivityEvent,
  AgentRuntimeAdapter,
  ChatChunk,
  MessageArgs,
  MessageResult,
  MessageUsage,
  RuntimeExecToolProvider,
} from '@bakin/core/adapters/runtime'
import { beginAdapterTurnActivity, RuntimeError } from '@bakin/core/adapters/runtime'
import { summarizeStructured, unwrapToolResult } from '@bakin/core/format'
import { redactSensitiveText } from '@bakin/core/redact'

import { buildStreamDeathError, toRuntimeError } from './errors'
import { getAgentWorkspaceDir, getPiAgentDir } from './home'
import { findPiModel, getModelRegistry, qualifiedModelId } from './models'
import { readRoutingDefaultModel } from './config'
import { readRegistry, scaffoldAgentDirs, type PiAgentRecord } from './registry'
import { recoverSeededLinks, seedRunWorkspace } from './run-workspace'
import { recordThreadSession, sessionManagerForThread, withThreadLock } from './sessions'
import { buildAppendSystemPrompt } from './system-prompt'
import { bridgeExecTools, filterExecToolDescriptors } from './tool-bridge'

const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])

/**
 * Pi extension loading policy (settings.runtime.settings.piExtensions).
 * Extensions are arbitrary code executing inside the Bakin server process
 * Trust modes: 'none' loads nothing; 'allowlist' (the DEFAULT) loads only
 * files whose real path AND content hash were explicitly approved; 'all'
 * loads every discovered extension (explicit trust-everything). Extensions
 * run unsandboxed in the Bakin server process — loading one is a trust
 * decision. extension_error events are contained per-turn.
 */
export interface PiExtensionsPolicy {
  mode?: 'none' | 'allowlist' | 'all'
  /** Approved entries — {path, sha256}. Plain path strings from an older shape are tolerated on read. */
  allow?: Array<PiExtensionAllowEntry | string>
}

/** Resolved policy: mode defaulted, allow normalized to entry objects. */
export interface PiExtensionsTrust {
  mode: 'none' | 'allowlist' | 'all'
  allow: PiExtensionAllowEntry[]
}

/**
 * DEFAULT IS 'allowlist' (empty) — extensions are discovered but NOT LOADED
 * until approved (pi-ecosystem WS4; flipped from 'all', which loaded
 * everything silently). A bare-string allow entry (older shape / hand edit)
 * is read as a path with an empty hash, so it never matches a real file —
 * fail-closed, the user re-approves.
 */
export function extensionsPolicy(settings: Record<string, unknown> | undefined): PiExtensionsTrust {
  const raw = (settings?.piExtensions ?? {}) as PiExtensionsPolicy
  const mode = raw.mode === 'none' || raw.mode === 'all' ? raw.mode : 'allowlist'
  // Untrusted shape (settings.json is agent/user-writable): a non-array, a
  // null element, or a missing path must degrade to "no valid entries", never
  // throw and kill the turn. An entry needs a NON-EMPTY sha256 to ever match
  // (see extensionApproved) — a bare-string / hashless entry is inert.
  const rawAllow = Array.isArray(raw.allow) ? raw.allow : []
  const allow: PiExtensionAllowEntry[] = []
  for (const e of rawAllow) {
    if (typeof e === 'string') { allow.push({ path: e, sha256: '' }); continue }
    if (e && typeof e === 'object' && typeof e.path === 'string') {
      allow.push({ path: e.path, sha256: typeof e.sha256 === 'string' ? e.sha256 : '' })
    }
  }
  return { mode, allow }
}

export interface PiExtensionResource {
  /** Real absolute path of the module the loader would import (symlinks resolved). */
  path: string
  /** Current content hash — half of the trust identity. */
  sha256: string
  /** Package source spec it came from (`npm:x`, `git:…`), absent for loose files. */
  source?: string
  scope?: string
}

/**
 * Force the Pi package resolver OFFLINE for this process. A Bakin agent turn
 * must NEVER install a Pi package — the SDK's DefaultResourceLoader.reload()
 * calls packageManager.resolve() with no onMissing, which would `npm install`
 * any configured-but-missing package (postinstall scripts = arbitrary code)
 * and bypass the extension allowlist entirely, in every mode. PI_OFFLINE
 * (isOfflineModeEnabled) makes every install branch a no-op. Installing Pi
 * packages is a deliberate terminal act (`pi install`) / a Bakin-owned path,
 * never a side effect of serving a turn. Set once, never unset — idempotent,
 * race-free.
 */
export function enforcePiOffline(): void {
  if (process.env.PI_OFFLINE !== '1') process.env.PI_OFFLINE = '1'
}

/**
 * Enumerate the extension modules the loader WOULD import, WITHOUT importing
 * any of them: the SDK's package manager resolves paths only. `onMissing:
 * 'skip'` (and PI_OFFLINE) guarantee no install and no network. This is the
 * ONE discovery source — it sees npm/git packages, local files and dirs,
 * object-form `packages[]` filter entries, and both scopes, with the loader's
 * own enable rules applied.
 */
export async function resolveExtensionResources(
  workspace: string,
  agentDir: string,
): Promise<PiExtensionResource[]> {
  enforcePiOffline()
  const settingsManager = hardenSettingsManager(createTurnSettingsManager(workspace, agentDir), { stripPackages: false })
  const packageManager = new DefaultPackageManager({ cwd: workspace, agentDir, settingsManager })
  const resolved = await packageManager.resolve(async () => 'skip')
  const out: PiExtensionResource[] = []
  for (const resource of resolved.extensions) {
    if (!resource.enabled) continue
    // Identity is the REAL file path (symlinks resolved) + its content hash:
    // a repointed symlink or a swapped file is a DIFFERENT extension, not the
    // one that was approved.
    const path = realpathIfPossible(resource.path)
    out.push({
      path,
      sha256: sha256OfFile(path),
      ...(resource.metadata?.source && resource.metadata.source !== resource.path
        ? { source: resource.metadata.source }
        : {}),
      ...(resource.metadata?.scope ? { scope: String(resource.metadata.scope) } : {}),
    })
  }
  return out
}

function realpathIfPossible(p: string): string {
  try { return realpathSync(p) } catch { return p }
}

function sha256OfFile(p: string): string {
  try { return createHash('sha256').update(readFileSync(p)).digest('hex') } catch { return '' }
}

/** An allow entry: the approved file's real path AND the content hash approved. */
export interface PiExtensionAllowEntry {
  path: string
  sha256: string
}

/**
 * A discovered resource matches an allow entry iff BOTH its real path and its
 * current content hash equal an approved (path, sha256). This ONE predicate
 * backs discovery status AND the load gate, so what shows "allowed" is
 * byte-for-byte what loads. Changed/swapped files fall back to pending.
 */
export function extensionApproved(resource: PiExtensionResource, allow: PiExtensionAllowEntry[]): boolean {
  // A missing/empty hash on EITHER side is never a match — an unreadable file
  // (sha256OfFile → '') must not satisfy a hashless (legacy/hand-edited) allow
  // entry. Approval is only ever granted through allowRuntimeExtension, which
  // always records a real hash; '' means "not really approved" → fail closed.
  if (!resource.sha256) return false
  return allow.some((entry) => entry.sha256 !== '' && entry.path === resource.path && entry.sha256 === resource.sha256)
}

/**
 * The absolute paths the loader may import, per policy, from the SAME
 * user-scope discovery every surface sees — so list()/doctor and the turn
 * can never disagree, in ANY mode:
 *   none      → nothing
 *   all       → every discovered extension (explicit trust-everything)
 *   allowlist → exactly the approved (path+hash) matches
 */
export async function loadPathsForPolicy(policy: PiExtensionsTrust, agentDir: string): Promise<string[]> {
  if (policy.mode === 'none') return []
  const discovered = await resolveExtensionResources(agentDir, agentDir)
  if (policy.mode === 'all') return discovered.map((r) => r.path)
  // Re-hashed fresh THIS turn (inside resolveExtensionResources) — a file
  // persistently swapped since approval no longer matches and is excluded.
  // A same-turn race between this hash and the loader's own read is a narrow
  // residual (no agent code runs in that window unless it planted a prior
  // background writer — a deeper compromise); the SDK offers no import-time
  // integrity hook to close it fully.
  return discovered.filter((r) => extensionApproved(r, policy.allow)).map((r) => r.path)
}

export interface PiMessagingDeps {
  getExecTools: () => RuntimeExecToolProvider | undefined
  getLogger?: () => AdapterLogger | undefined
  getToolActivity?: () => AdapterInitOpts['onToolActivity']
  getTurnActivity?: () => AdapterInitOpts['onTurnActivity']
  /** Adapter-level runtime settings (settings.runtime.settings), e.g. { retry: RetrySettings }. */
  getSettings?: () => Record<string, unknown> | undefined
}

interface TurnHandle {
  session: AgentSession
  record: PiAgentRecord
  dispose: () => void
}

function requireAgent(agentId: string): PiAgentRecord {
  const record = readRegistry().agents.find((a) => a.id === agentId)
  if (!record) {
    throw new RuntimeError(`adapter-pi: unknown agent: ${agentId}`, { kind: 'runtime_failed' })
  }
  return record
}

/**
 * Effective model for a turn: explicit per-turn override → the agent's
 * assignment → the routing default (P2.3) → undefined (SDK default).
 *
 * Never throws: this runs inside error-path metadata construction (the
 * `toRuntimeError` calls), where a settings-parse throw would REPLACE the
 * real turn error and defeat kind-based failure classification.
 */
function resolveModelRef(turnModel: string | undefined, agentModel: string | undefined): string | undefined {
  if (turnModel) return turnModel
  if (agentModel) return agentModel
  try {
    return readRoutingDefaultModel() || undefined
  } catch {
    return undefined
  }
}

function imageContentsFor(args: MessageArgs, record: PiAgentRecord) {
  if (!args.attachments || args.attachments.length === 0) return undefined
  const model = findPiModel(resolveModelRef(args.model, record.model))
  if (!model || !model.input.includes('image')) {
    throw new RuntimeError(
      `adapter-pi: agent ${record.id} model does not accept image input — refusing to drop ${args.attachments.length} attachment(s)`,
      { kind: 'runtime_failed' },
    )
  }
  return args.attachments.map((att) => ({
    type: 'image' as const,
    data: readFileSync(att.path).toString('base64'),
    mimeType: att.mimeType,
  }))
}


/**
 * The per-turn SettingsManager, exactly as Bakin turns build it. Exported so
 * the compaction-default pin test exercises the REAL construction: Bakin
 * relies on the SDK's compaction default staying enabled (long tasks compact,
 * not die) — if the pinned SDK flips it, the pin fails and this helper must
 * pass an explicit compaction override.
 */
export function createTurnSettingsManager(workspace: string, agentDir: string): SettingsManager {
  return SettingsManager.create(workspace, agentDir, { projectTrusted: true })
}

/**
 * Neutralize the two settings-driven package side effects that let an agent
 * (or a tampered ~/.pi config) run arbitrary code during a Bakin turn:
 *
 *  - `npmCommand` — the SDK runs the settings-configured package-manager
 *    command not just to install but to LOCATE the global npm root
 *    (`getNpmInstallPath` → `npm root -g`), which is NOT offline-gated. A
 *    settings-supplied `npmCommand: [evil]` would execute every turn. We pin
 *    it to undefined so the SDK always uses the real npm/bun binary.
 *  - `packages[]` (turn only) — resolving a configured package triggers
 *    install (postinstall = arbitrary code) and the npm-root probe. Bakin
 *    hands approved extensions to the loader as absolute paths via
 *    `additionalExtensionPaths`; it never needs settings packages, so the
 *    turn loader sees none. (Discovery keeps packages so already-installed
 *    npm extensions are still enumerable — it resolves read-only with the
 *    real npm and onMissing:'skip'.)
 */
function hardenSettingsManager(sm: SettingsManager, opts: { stripPackages: boolean }): SettingsManager {
  const anySm = sm as unknown as {
    getNpmCommand: () => string[] | undefined
    getGlobalSettings: () => Record<string, unknown>
    getProjectSettings: () => Record<string, unknown>
  }
  anySm.getNpmCommand = () => undefined
  if (opts.stripPackages) {
    const global = anySm.getGlobalSettings.bind(anySm)
    const project = anySm.getProjectSettings.bind(anySm)
    anySm.getGlobalSettings = () => ({ ...global(), packages: [] })
    anySm.getProjectSettings = () => ({ ...project(), packages: [] })
  }
  return sm
}

async function openTurnSession(args: MessageArgs, deps: PiMessagingDeps): Promise<TurnHandle> {
  const record = requireAgent(args.agentId)
  scaffoldAgentDirs(record.id)
  const workspace = getAgentWorkspaceDir(record.id)
  const agentDir = getPiAgentDir()
  const { auth, registry: modelRegistry } = getModelRegistry()

  // Per-run isolation (same-agent-concurrency D2): ONLY the session's
  // tool-execution cwd moves to the handed run dir. The settings manager,
  // resource loader (project context/skills/extensions discovery), session
  // store, and prompt assembly below all stay pinned to the agent
  // WORKSPACE, so an isolated turn's prompt is byte-identical to a
  // workspace turn's. Seeding symlinks the workspace-root *.md files in so
  // the agent's cwd-relative reads/writes of its own identity/memory files
  // keep flowing to the real workspace.
  if (args.runWorkspace) seedRunWorkspace(record.id, args.runWorkspace)
  const executionCwd = args.runWorkspace ?? workspace

  const settingsManager = hardenSettingsManager(createTurnSettingsManager(workspace, agentDir), { stripPackages: true })
  const adapterSettings = deps.getSettings?.()
  const extPolicy = extensionsPolicy(adapterSettings)

  // TRUE pre-load gate (WS4). `extensionsOverride` is a POST-load filter —
  // the loader jiti-imports every enabled extension before it runs, so an
  // unapproved extension's module code would execute (only its tools would
  // be hidden). Instead: `noExtensions` ALWAYS suppresses the loader's own
  // settings-discovered set, and EXACTLY the paths policy authorizes are
  // handed back through `additionalExtensionPaths`. Every mode goes through
  // the SAME user-scope discovery basis, so list()/doctor and the turn can
  // never disagree, and a workspace-project extension can't sneak in.
  //   none      → nothing loads
  //   allowlist → files whose real path + content hash were approved
  //   all       → every discovered extension (explicit trust-everything)
  enforcePiOffline() // belt-and-suspenders; the loader also never sees packages[]
  const loadPaths = await loadPathsForPolicy(extPolicy, agentDir)
  const resourceLoader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    settingsManager,
    // Themes/prompt-templates are TUI-only and stay out of the server process.
    // NOTE: this allowlist gates EXTENSIONS (in-process CODE). Skills are
    // content (instructions), governed by Bakin's own agent-package/skills
    // projection — not this gate — so noSkills is intentionally NOT set; the
    // package hardening above only strips code-bearing `packages[]`.
    noExtensions: true,
    additionalExtensionPaths: loadPaths,
    noThemes: true,
    noPromptTemplates: true,
    appendSystemPrompt: buildAppendSystemPrompt(record.id),
  })
  await resourceLoader.reload()

  const retry = adapterSettings?.retry
  if (retry && typeof retry === 'object') {
    // Bakin's dispatch owns the outer retry ladder; installs can tune or
    // disable Pi's inner auto-retry via settings.runtime.settings.retry.
    // MUST run after resourceLoader.reload(): reload() calls
    // settingsManager.reload(), which recomputes settings from disk and
    // discards any overrides applied before it.
    settingsManager.applyOverrides({ retry: retry as never })
  }

  const execProvider = deps.getExecTools()
  // record.allowlist is the SUBAGENT dispatch allowlist (agent ids) — never
  // a tool filter. Tool exposure is policy-driven only (args.tools*).
  const descriptors = execProvider ? filterExecToolDescriptors(execProvider.list(), args) : []
  const customTools = execProvider ? bridgeExecTools(execProvider, record.id, descriptors) : []

  const model = findPiModel(resolveModelRef(args.model, record.model))
  const thinking = args.thinking && THINKING_LEVELS.has(args.thinking) ? args.thinking : undefined

  const { session } = await createAgentSession({
    cwd: executionCwd,
    agentDir,
    authStorage: auth,
    modelRegistry,
    sessionManager: sessionManagerForThread(record.id, args.threadId),
    settingsManager,
    resourceLoader,
    customTools,
    ...(model ? { model } : {}),
    ...(thinking ? { thinkingLevel: thinking as never } : {}),
    ...(args.toolsMode === 'none' ? { noTools: 'all' as const } : {}),
  })

  return {
    session,
    record,
    dispose: () => {
      try {
        session.dispose()
      } catch (err) {
        deps.getLogger?.()?.warn('adapter-pi: session dispose failed', { error: String(err) })
      }
    },
  }
}

function usageDelta(before: ReturnType<AgentSession['getSessionStats']>, after: ReturnType<AgentSession['getSessionStats']>, session: AgentSession): MessageUsage | undefined {
  const input = after.tokens.input - before.tokens.input
  const output = after.tokens.output - before.tokens.output
  const cacheRead = after.tokens.cacheRead - before.tokens.cacheRead
  const cacheWrite = after.tokens.cacheWrite - before.tokens.cacheWrite
  const total = after.tokens.total - before.tokens.total
  if (total <= 0 && output <= 0) return undefined
  return {
    input: Math.max(0, input),
    output: Math.max(0, output),
    total: Math.max(0, total),
    cacheRead: Math.max(0, cacheRead),
    cacheWrite: Math.max(0, cacheWrite),
    model: session.model ? qualifiedModelId(String(session.model.provider), session.model.id) : undefined,
  }
}

function persistThreadMapping(agentId: string, threadId: string | undefined, session: AgentSession): void {
  if (!threadId) return
  const file = session.sessionFile
  if (file) recordThreadSession(agentId, threadId, session.sessionId, file)
}

/**
 * Watches the turn's event stream for evidence used in results + forensics.
 *
 * IMPORTANT SDK behavior (probed, 0.80.3): `session.prompt()` RESOLVES even
 * when the provider fails terminally — the failure signal is the final
 * `agent_end` whose last assistant message has `stopReason: 'error'` (after
 * auto-retries exhaust, `willRetry: false`) plus its `errorMessage`.
 */
class TurnObserver {
  text = ''
  lastToolCall: string | undefined
  sawDone = false
  /** Terminal provider failure message (agent_end, stopReason 'error', no retry pending). */
  terminalError: string | undefined
  /** The run ended with stopReason 'aborted'. */
  endedAborted = false

  readonly onEvent = (event: AgentSessionEvent): void => {
    if (event.type === 'tool_execution_start') {
      this.lastToolCall = event.toolName
    } else if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent
      if (delta.type === 'text_delta') this.text += delta.delta
      else if (delta.type === 'done') this.sawDone = true
    } else if (event.type === 'agent_end') {
      const last = event.messages.at(-1) as { stopReason?: string; errorMessage?: string } | undefined
      if (!last) return
      if (last.stopReason === 'error') {
        this.terminalError = event.willRetry ? this.terminalError : (last.errorMessage ?? 'Pi turn ended in error')
      } else if (last.stopReason === 'aborted') {
        this.endedAborted = true
      } else if (last.stopReason) {
        // A later successful attempt clears failure evidence from retries.
        this.terminalError = undefined
      }
    }
  }
}

/**
 * Map one Pi session event to normalized chunks — the single event→chunk
 * mapping shared by `stream()` (all chunk kinds) and the `send()` activity
 * tap (which keeps only tool/status). `state` carries the once-per-turn
 * thinking announcement.
 */
function sessionEventChunks(event: AgentSessionEvent, state: { announcedThinking: boolean }): ChatChunk[] {
  if (event.type === 'message_update') {
    const delta = event.assistantMessageEvent
    if (delta.type === 'text_delta') return [{ type: 'text', content: delta.delta }]
    if (delta.type === 'thinking_start' && !state.announcedThinking) {
      state.announcedThinking = true
      return [{ type: 'status', content: 'thinking' }]
    }
    return []
  }
  if (event.type === 'tool_execution_start') {
    return [{
      type: 'tool',
      data: {
        phase: 'call',
        callId: event.toolCallId,
        toolName: event.toolName,
        status: 'running',
        inputPreview: safePreview(event.args),
      },
    }]
  }
  if (event.type === 'tool_execution_end') {
    return [{
      type: 'tool',
      data: {
        phase: 'result',
        callId: event.toolCallId,
        toolName: event.toolName,
        status: event.isError ? 'failed' : 'completed',
        // Clean one-line summary (peel the tool-result envelope, parse inner
        // JSON) instead of an escaped raw dump (#608) — redacted like every
        // preview field: summaries echo tool output, which can carry the
        // secrets the tool was called with.
        summary: redactSummary(summarizeStructured(unwrapToolResult(event.result))),
      },
    }]
  }
  return []
}

/**
 * Build the adapter-wide tool observer for one turn. Pi exposes matching call
 * ids but not elapsed time, so derive duration from its call/result events.
 * The tap is deliberately independent from MessageArgs.onActivity: either
 * consumer may throw or be absent without affecting the other or the turn.
 */
function createToolActivityObserver(
  args: MessageArgs,
  deps: PiMessagingDeps,
  turnId: string,
): ((chunk: ChatChunk) => void) | undefined {
  const onToolActivity = deps.getToolActivity?.()
  if (!onToolActivity) return undefined
  const startedAt = new Map<string, number>()

  return (chunk: ChatChunk): void => {
    if (chunk.type !== 'tool') return

    const { phase, callId, toolName, status } = chunk.data
    const correlationKey = callId ?? toolName
    let durationMs = chunk.data.durationMs
    if (phase === 'call') {
      startedAt.set(correlationKey, Date.now())
    } else {
      const started = startedAt.get(correlationKey)
      if (durationMs === undefined) {
        // Pi currently brackets every result with a matching call event. Keep
        // the result contract numeric even if a future SDK drops that start
        // event; zero is the only honest lower bound in that degraded case.
        durationMs = started === undefined ? 0 : Math.max(0, Date.now() - started)
      }
      startedAt.delete(correlationKey)
    }

    try {
      const baseEvent = {
        agentId: args.agentId,
        activityClass: args.activityClass ?? 'user',
        turnId,
        threadId: args.threadId,
        callId,
        toolName,
      }
      const telemetryEvent: AdapterToolActivityEvent = phase === 'call'
        ? { ...baseEvent, phase: 'call', status: 'running' }
        : {
            ...baseEvent,
            phase: 'result',
            status: status === 'completed' || status === 'aborted' ? status : 'failed',
            ...(durationMs === undefined ? {} : { durationMs }),
          }
      onToolActivity(telemetryEvent)
    } catch (err) {
      deps.getLogger?.()?.warn('adapter-pi: onToolActivity callback threw; contained', { error: String(err) })
    }
  }
}

/**
 * Subscribe the send-path activity tap (MessageArgs.onActivity, T8): the
 * shared event→chunk mapping filtered to tool/status. Callback exceptions
 * are contained — a throwing tap never fails the turn.
 */
function subscribeActivityTap(
  session: AgentSession,
  onActivity: MessageArgs['onActivity'],
  onToolActivity: ((chunk: ChatChunk) => void) | undefined,
  deps: PiMessagingDeps,
): () => void {
  const state = { announcedThinking: false }
  return session.subscribe((event: AgentSessionEvent) => {
    for (const chunk of sessionEventChunks(event, state)) {
      if (chunk.type !== 'tool' && chunk.type !== 'status') continue
      onToolActivity?.(chunk)
      if (!onActivity) continue
      try {
        onActivity(chunk)
      } catch (err) {
        deps.getLogger?.()?.warn('adapter-pi: onActivity callback threw; contained', { error: String(err) })
      }
    }
  })
}

export function createMessagingSurface(deps: PiMessagingDeps): AgentRuntimeAdapter['messaging'] {
  async function runTurn<T>(
    args: MessageArgs,
    fn: (handle: TurnHandle, observer: TurnObserver) => Promise<T>,
  ): Promise<T> {
    return withThreadLock(args.agentId, args.threadId, async () => {
      if (args.signal?.aborted) {
        throw new RuntimeError('Pi turn aborted before start', { kind: 'aborted' })
      }
      const handle = await openTurnSession(args, deps)
      const observer = new TurnObserver()
      const unsubscribe = handle.session.subscribe(observer.onEvent)
      const onAbort = () => {
        void handle.session.abort()
      }
      args.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        return await fn(handle, observer)
      } finally {
        args.signal?.removeEventListener('abort', onAbort)
        unsubscribe()
        handle.dispose()
        if (args.runWorkspace) {
          // Severed-symlink recovery (D2): rename-style writes replace a
          // seeded link with a regular file — copy those back to the
          // workspace (LWW) so memory writes are never silently stranded.
          try {
            recoverSeededLinks(args.agentId, args.runWorkspace, (msg, data) => deps.getLogger?.()?.warn(msg, data))
          } catch (err) {
            deps.getLogger?.()?.warn('adapter-pi: run-workspace link recovery failed', { error: String(err) })
          }
        }
      }
    })
  }

  return {
    async send(args: MessageArgs): Promise<MessageResult> {
      const lifecycle = beginAdapterTurnActivity({
        onActivity: deps.getTurnActivity?.(),
        onCallbackError: (error) => {
          deps.getLogger?.()?.warn('adapter-pi: onTurnActivity callback threw; contained', { error: String(error) })
        },
        agentId: args.agentId,
        activityClass: args.activityClass ?? 'user',
        threadId: args.threadId,
        operation: 'send',
      })
      try {
        const result: MessageResult = await runTurn(args, async ({ session, record }, observer) => {
          const before = session.getSessionStats()
          const observeToolActivity = createToolActivityObserver(args, deps, lifecycle.turnId)
          const unsubscribeTap = args.onActivity || observeToolActivity
            ? subscribeActivityTap(session, args.onActivity, observeToolActivity, deps)
            : null
          try {
            await session.prompt(args.content, { images: imageContentsFor(args, record) })
          } catch (err) {
            throw toRuntimeError(err, {
              aborted: args.signal?.aborted,
              sessionId: session.sessionId,
              model: resolveModelRef(args.model, record.model),
            })
          } finally {
            unsubscribeTap?.()
          }
          if (args.signal?.aborted || observer.endedAborted) {
            throw new RuntimeError('Pi turn aborted', { kind: 'aborted' })
          }
          persistThreadMapping(record.id, args.threadId, session)
          throwOnTerminalFailure(observer, session, args, record)
          const after = session.getSessionStats()
          return {
            id: randomUUID(),
            content: session.getLastAssistantText() ?? observer.text,
            usage: usageDelta(before, after, session),
            metadata: { sessionId: session.sessionId },
          }
        })
        if (deps.getTurnActivity?.()) {
          result.metadata = { ...(result.metadata ?? {}), adapterTurnId: lifecycle.turnId }
        }
        lifecycle.finish({ status: 'completed', resultId: result.id, usage: result.usage })
        return result
      } catch (error) {
        lifecycle.finish({
          status: args.signal?.aborted || (error instanceof RuntimeError && error.kind === 'aborted')
            ? 'aborted'
            : 'failed',
        })
        throw error
      }
    },

    stream(args: MessageArgs): AsyncIterable<ChatChunk> {
      const queue: ChatChunk[] = []
      let notify: (() => void) | null = null
      let finished = false
      const push = (chunk: ChatChunk) => {
        queue.push(chunk)
        notify?.()
      }
      const finish = () => {
        finished = true
        notify?.()
      }

      const lifecycle = beginAdapterTurnActivity({
        onActivity: deps.getTurnActivity?.(),
        onCallbackError: (error) => {
          deps.getLogger?.()?.warn('adapter-pi: onTurnActivity callback threw; contained', { error: String(error) })
        },
        agentId: args.agentId,
        activityClass: args.activityClass ?? 'user',
        threadId: args.threadId,
        operation: 'stream',
      })
      let streamUsage: MessageUsage | undefined
      const turn = runTurn(args, async ({ session, record }, observer) => {
        const chunkState = { announcedThinking: false }
        const before = session.getSessionStats()
        const observeToolActivity = createToolActivityObserver(args, deps, lifecycle.turnId)
        const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
          for (const chunk of sessionEventChunks(event, chunkState)) {
            observeToolActivity?.(chunk)
            push(chunk)
          }
        })
        try {
          await session.prompt(args.content, { images: imageContentsFor(args, record) })
          if (args.signal?.aborted || observer.endedAborted) {
            throw new RuntimeError('Pi turn aborted', { kind: 'aborted' })
          }
          persistThreadMapping(record.id, args.threadId, session)
          throwOnTerminalFailure(observer, session, args, record)
          // Usage parity with send() (conformance-pinned): the terminal done
          // carries the turn's token accounting so streamed turns are meterable.
          const usage = usageDelta(before, session.getSessionStats(), session)
          streamUsage = usage
          push({ type: 'done', ...(usage ? { usage } : {}) })
        } catch (err) {
          // Whatever accounting accrued before the failure/abort — the clean
          // abort done below attaches it so partial turns still meter.
          try {
            streamUsage = usageDelta(before, session.getSessionStats(), session)
          } catch { /* stats unavailable mid-teardown — leave undefined */ }
          throw toRuntimeError(err, {
            aborted: args.signal?.aborted,
            sessionId: session.sessionId,
            model: resolveModelRef(args.model, record.model),
          })
        } finally {
          unsubscribe()
        }
      })

      turn.then(() => {
        lifecycle.finish({ status: 'completed', usage: streamUsage })
        finish()
      }, (rawErr) => {
        // Normalize BEFORE classifying so pre-prompt raw throws (e.g. from
        // createAgentSession) carry a typed kind like everything else.
        const err = toRuntimeError(rawErr, { aborted: args.signal?.aborted })
        lifecycle.finish({ status: err.kind === 'aborted' ? 'aborted' : 'failed' })
        if (err.kind === 'aborted') {
          // Contract: a deliberate abort ends the stream with a clean done —
          // matching the send path's kind:'aborted' settle. Never an error chunk.
          // Partial usage still rides it: aborted turns billed those tokens.
          push({ type: 'done', ...(streamUsage ? { usage: streamUsage } : {}) })
        } else {
          // Contract: the terminal error chunk carries the typed kind so
          // consumers classify without parsing message text.
          push({ type: 'error', content: err.message, data: { kind: err.kind } })
        }
        finish()
      })

      return {
        async *[Symbol.asyncIterator]() {
          while (true) {
            while (queue.length > 0) yield queue.shift()!
            if (finished) return
            await new Promise<void>((resolve) => {
              notify = resolve
            })
            notify = null
          }
        },
      }
    },
  }
}

/**
 * Terminal provider failure after prompt() resolved (see TurnObserver doc).
 * Partial streamed text upgrades the failure to a session-death diagnosis
 * so the recovery ladder can salvage; a clean failure classifies by its
 * provider message (429 → cooldown, etc.).
 */
function throwOnTerminalFailure(
  observer: TurnObserver,
  session: AgentSession,
  args: MessageArgs,
  record: PiAgentRecord,
): void {
  if (!observer.terminalError) return
  if (observer.text && !observer.sawDone) {
    throw buildStreamDeathError({
      sessionId: session.sessionId,
      partialText: observer.text,
      lastToolCall: observer.lastToolCall,
      detail: `Pi turn died after partial output: ${observer.terminalError}`,
      cause: new Error(observer.terminalError),
      oversizedOutputBytes: args.oversizedOutputBytes,
    })
  }
  throw toRuntimeError(new Error(observer.terminalError), {
    sessionId: session.sessionId,
    model: resolveModelRef(args.model, record.model),
  })
}

function redactSummary(value: string): string | undefined {
  if (!value) return undefined
  return redactSensitiveText(value)
}

function safePreview(value: unknown, cap = 200): string | undefined {
  if (value === undefined || value === null) return undefined
  try {
    // Previews leave the adapter (turn-activity SSE → every browser) —
    // redact before truncation, matching OpenClaw's previewUnknown parity.
    const text = redactSensitiveText(typeof value === 'string' ? value : JSON.stringify(value))
    return text.length > cap ? `${text.slice(0, cap)}…` : text
  } catch {
    return undefined
  }
}
