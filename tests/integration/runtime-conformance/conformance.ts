/**
 * Runtime-adapter conformance suite (SPEC R23) — THE ACCEPTANCE GATE for any
 * runtime adapter. Every implementation (OpenClaw, Pi, the dev mock, and any
 * future adapter) must pass these cases; a new adapter is not done until its
 * runner file here is green. Cases assert CONTRACT behavior only — anything
 * pinned here must hold for every conforming runtime, never provider quirks.
 *
 * Scope: messaging pins (T25) + stream/tap/capability/provisioning pins
 * (T26) + mock-default honesty (T27) + ping-serveability (T29). toolsAllow
 * exec-scope and oversizedOutputBytes threading are unit-pinned per adapter
 * (T29) — their observable effects are adapter-mechanism-specific.
 *
 * Deliberately NOT pinned: send-level idempotency. `messaging.send` is NOT
 * idempotent at the contract level — callers own dedupe (the execution
 * ledger's run claims). OpenClaw's gateway idempotency key is an adapter
 * implementation detail, not a contract guarantee (audit finding H4).
 *
 * Structure: each check is a plain async function that THROWS on violation
 * (`runtimeConformanceChecks`), and `runRuntimeConformanceSuite` wraps them
 * in describe/it. The teeth test invokes the checks directly against an
 * intentionally-broken adapter to prove the suite fails non-conforming
 * implementations.
 */
import { describe, it } from 'bun:test'
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { AgentRuntimeAdapter, ChatChunk, MessageResult } from '../../../packages/core/src/adapters/runtime'
import { RuntimeError } from '../../../packages/core/src/adapters/runtime'

export interface RuntimeConformanceTarget {
  runtime: AgentRuntimeAdapter
  /** An agent that exists on this runtime and can complete turns. */
  agentId: string
  /** Fresh, unique thread id per call. */
  newThreadId(): string
  /** Seed/prepare one ordinary successful turn (e.g. Pi seeds a provider script). */
  prepareOkTurn?(): void | Promise<void>
  /**
   * A send promise that MUST reject with a typed RuntimeError. The target
   * owns the failure recipe (provider 500, gateway error mode, pre-aborted
   * signal for the mock — whatever this runtime can actually fail with).
   */
  failingSend(): Promise<MessageResult>
  /** When set, the failing rejection must carry exactly this kind. */
  expectedFailingKind?: string
  /**
   * Start a turn and abort it mid-flight (the target owns the timing — slow
   * provider script, slow gateway mode, or an immediate abort for the mock).
   * `settled` is the send promise; it must reject kind 'aborted'.
   */
  startAbortableTurn(): Promise<{ settled: Promise<MessageResult> }> | { settled: Promise<MessageResult> }
  /**
   * Seed/prepare a TOOL-USING turn and return the content to send (the
   * target owns the trigger: the crab/mock `[[tool]]` marker, a Pi toolCall
   * provider script). Drives the stream taxonomy and onActivity-tap pins.
   */
  prepareToolTurn(): string | Promise<string>
  /**
   * A stream that must end in TERMINAL FAILURE (typed `error` chunk, no
   * `done`, iterator never throws). The target owns the recipe AND any env
   * restore — the returned iterable is consumed to completion.
   */
  failingStream(): AsyncIterable<ChatChunk> | Promise<AsyncIterable<ChatChunk>>
  /**
   * Snapshot whatever provisioning durably writes (config bytes etc.) for
   * the idempotency pin; return null when the runtime provisions nothing
   * durable (in-process runtimes). Compared with deep equality across a
   * second provision run.
   */
  observeProvisionedState?(): unknown | Promise<unknown>
  /**
   * An UNSERVEABLE instance of this runtime (uninitialized adapter, dead
   * gateway port, shutdown mock) for the ping pin: its ping() must resolve
   * false — never throw. The healthy target's ping() must resolve true.
   * (Pi's credential-presence probe is additionally unit-tested in
   * tests/adapter-pi/ping-serveability.test.ts — PI_HOME is process-global,
   * so the no-credentials recipe needs its own file.)
   */
  makeUnserveableRuntime?(): Promise<Pick<AgentRuntimeAdapter, 'ping'>> | Pick<AgentRuntimeAdapter, 'ping'>
  /**
   * For the write-free-initialize pin: a FRESH uninitialized adapter of this
   * runtime pointed at a pristine home. The check snapshots `homeDir` before
   * and after `initialize()` and fails on ANY tree change — initialization
   * must be read-only (seeding/config writes belong to provisioning; the
   * runtime-switch dry-run relies on this to construct a secondary target
   * adapter with zero side effects). `cleanup` restores whatever env/global
   * state the scenario re-pointed; always invoked.
   */
  makeFreshInitScenario?(): Promise<FreshInitScenario> | FreshInitScenario
}

export interface FreshInitScenario {
  homeDir: string
  initialize(): Promise<void>
  cleanup?(): void | Promise<void>
}

export interface RuntimeConformanceSuiteOptions {
  /**
   * Sessions capability-honesty pin (declared 'native' ⇒ sessions.list
   * returns the sessions real turns created). Default ON — and ON for all
   * three shipped runners since T28 implemented OpenClaw sessions for real.
   * A future adapter may disable it only while a sessions surface is
   * declared 'unavailable'.
   */
  sessionsPin?: boolean
  /**
   * Cron optional-member declaration (T30). 'present' pins the member to
   * exist and drives the CRUD round-trip; 'absent' pins true omission
   * (undefined member, not a throwing stub). Omit to skip the declaration
   * pin (the round-trip still runs whenever the member exists).
   */
  cron?: 'present' | 'absent'
}

function fail(message: string): never {
  throw new Error(`conformance violation: ${message}`)
}

function assertTypedRuntimeError(err: unknown, expectedKind?: string): void {
  if (!(err instanceof RuntimeError)) {
    fail(`messaging rejection is not a RuntimeError (got ${err?.constructor?.name ?? typeof err}: ${String(err)})`)
  }
  if (typeof err.kind !== 'string' || err.kind.length === 0) {
    fail('RuntimeError.kind is missing/empty — core classifies on kind, never message text')
  }
  if (expectedKind !== undefined && err.kind !== expectedKind) {
    fail(`expected kind '${expectedKind}', got '${err.kind}'`)
  }
}

export const runtimeConformanceChecks = {
  /**
   * Optional-member honesty (T30): cron support is signalled by MEMBER
   * PRESENCE — never a capability mode, never a throwing stub. A runner
   * declares which side its adapter is on; absence must be `undefined`.
   */
  async cronMemberMatchesDeclaration(target: RuntimeConformanceTarget, options?: RuntimeConformanceSuiteOptions): Promise<void> {
    if (options?.cron === undefined) return
    const member = target.runtime.cron
    if (options.cron === 'absent' && member !== undefined) {
      fail('cron declared absent but the adapter exposes a cron member — absence must be member omission')
    }
    if (options.cron === 'present' && member === undefined) {
      fail('cron declared present but the adapter omits the member')
    }
  },

  /**
   * Native-cron CRUD contract (T30), for adapters that expose the optional
   * member: creates persist (listable, gettable), updates apply, a missing
   * id reads as null (never a throw) and mutates as a typed 'not_found',
   * and removal is observable. Runs against whatever store the adapter
   * really uses (OpenClaw: the CLI + file store via the crab shim).
   */
  async cronCrudRoundTrip(target: RuntimeConformanceTarget): Promise<void> {
    const cron = target.runtime.cron
    if (!cron) return
    const name = `conformance-cron-${Math.random().toString(36).slice(2, 10)}`

    const created = await cron.create({ name, schedule: '0 9 * * *', command: 'conformance noop', enabled: true })
    if (!created.id) fail('cron.create returned a job without an id')
    if (created.schedule !== '0 9 * * *') fail(`cron.create did not persist the schedule (got '${created.schedule}')`)

    const listed = await cron.list()
    if (!listed.some((job) => job.id === created.id)) fail('created cron job is missing from cron.list()')

    const fetched = await cron.get(created.id)
    if (!fetched || fetched.id !== created.id) fail('cron.get of a created job did not return it')

    const updated = await cron.update(created.id, { schedule: '30 10 * * *' })
    if (updated.schedule !== '30 10 * * *') fail(`cron.update did not apply the schedule patch (got '${updated.schedule}')`)
    const refetched = await cron.get(created.id)
    if (refetched?.schedule !== '30 10 * * *') fail('cron.update result not visible on a subsequent get')

    const ghost = `conformance-cron-ghost-${Math.random().toString(36).slice(2, 10)}`
    const missing = await cron.get(ghost)
    if (missing !== null) fail(`cron.get of a missing job must return null (got ${JSON.stringify(missing)})`)
    try {
      await cron.update(ghost, { schedule: '0 0 * * *' })
      fail("cron.update of a missing job resolved — must reject typed 'not_found'")
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('conformance violation')) throw err
      assertTypedRuntimeError(err, 'not_found')
    }

    await cron.remove(created.id)
    if ((await cron.get(created.id)) !== null) fail('cron.get still returns a removed job')
    if ((await cron.list()).some((job) => job.id === created.id)) fail('cron.list still contains a removed job')
  },

  /**
   * CRUD error contract (R28): reads return null for absence; mutations on a
   * missing agent reject with a typed RuntimeError kind 'not_found'. Ghost id
   * is randomized per run so accumulating stores (the crab home) can't
   * collide with it.
   */
  async unknownAgentCrudIsTypedNotFound(target: RuntimeConformanceTarget): Promise<void> {
    const ghost = `conformance-ghost-${Math.random().toString(36).slice(2, 10)}`
    const got = await target.runtime.agents.get(ghost)
    if (got !== null) fail(`agents.get of a missing agent must return null (got ${JSON.stringify(got)})`)
    try {
      await target.runtime.agents.update(ghost, { name: 'nope' })
      fail('agents.update of a missing agent resolved — must reject typed not_found')
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('conformance violation')) throw err
      assertTypedRuntimeError(err, 'not_found')
    }
    try {
      await target.runtime.agents.remove(ghost)
      fail('agents.remove of a missing agent resolved — must reject typed not_found')
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('conformance violation')) throw err
      assertTypedRuntimeError(err, 'not_found')
    }
  },

  /** Threaded sends return the provider session identity for forensics/usage attribution. */
  async threadedSendReturnsSessionId(target: RuntimeConformanceTarget): Promise<void> {
    await target.prepareOkTurn?.()
    const result = await target.runtime.messaging.send({
      agentId: target.agentId,
      content: 'conformance: threaded send',
      threadId: target.newThreadId(),
    })
    const sessionId = result.metadata?.sessionId
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      fail('threaded send returned no metadata.sessionId')
    }
  },

  /**
   * Session-origin honesty (#691): a runtime that exposes a `session_jsonl`
   * memory tier must label session entries' provenance truthfully. Any
   * `origin` metadata must be `bakin | external | unknown`, and after a
   * threaded Bakin send at least one labeled entry must be `bakin` —
   * otherwise dispatch provenance is lost and interactive-vs-unexplained
   * usage buckets cannot be trusted. Runtimes without the tier (the minimal
   * mock) conform vacuously.
   */
  async sessionOriginLabelsAreHonest(target: RuntimeConformanceTarget): Promise<void> {
    const { runtime, agentId } = target
    const tiers = await runtime.memory.listTiers()
    const sessionTier = tiers.find((t) => t.metadata?.sourceKind === 'session_jsonl')
    if (!sessionTier) return
    await target.prepareOkTurn?.()
    const result = await runtime.messaging.send({
      agentId,
      content: 'conformance: origin labeling turn',
      threadId: target.newThreadId(),
    })
    const entries = await runtime.memory.listEntries(sessionTier.id, { agentId })
    // Every origin label the tier surfaces must come from the closed set.
    for (const entry of entries) {
      if (!entry.metadata || !('origin' in entry.metadata)) continue
      const origin = entry.metadata.origin
      if (origin !== 'bakin' && origin !== 'external' && origin !== 'unknown') {
        fail(`session entry origin must be 'bakin' | 'external' | 'unknown'; got ${JSON.stringify(origin)} on ${entry.id}`)
      }
    }
    // If the transcript of the Bakin send we just made is listed, it must be
    // labeled bakin — anything else loses dispatch provenance. Runtimes that
    // don't persist per-turn transcripts (the crab mock) conform vacuously.
    const sid = result.metadata?.sessionId
    if (typeof sid !== 'string' || sid.length === 0) return
    const ownEntry = entries.find(
      (e) => e.id === sid || e.metadata?.sessionId === sid || e.id.includes(sid),
    )
    if (ownEntry && ownEntry.metadata?.origin !== 'bakin') {
      fail(`the session of a threaded Bakin send is labeled ${JSON.stringify(ownEntry.metadata?.origin)} — dispatch provenance is lost`)
    }
  },

  /** Caller aborts settle as kind 'aborted' — terminal, clean, never a recovery-ladder entry. */
  async abortSettlesAsAbortedKind(target: RuntimeConformanceTarget): Promise<void> {
    const { settled } = await target.startAbortableTurn()
    let caught: unknown = null
    try {
      await settled
    } catch (err) {
      caught = err
    }
    if (caught === null) fail('aborted turn resolved instead of rejecting')
    assertTypedRuntimeError(caught, 'aborted')
  },

  /** Messaging failures are typed RuntimeErrors — kind present, no message-string classification. */
  async failuresAreTypedRuntimeErrors(target: RuntimeConformanceTarget): Promise<void> {
    let caught: unknown = null
    try {
      await target.failingSend()
    } catch (err) {
      caught = err
    }
    if (caught === null) fail('failing send resolved instead of rejecting')
    assertTypedRuntimeError(caught, target.expectedFailingKind)
  },

  /**
   * ping() is a cheap serveability probe (T29): true on a runtime that can
   * serve turns, false — resolved, never thrown — on one that cannot.
   */
  async pingReflectsServeability(target: RuntimeConformanceTarget): Promise<void> {
    const healthy = await target.runtime.ping()
    if (healthy !== true) fail('ping() returned false on a runtime that is serving conformance turns')
    if (!target.makeUnserveableRuntime) return
    const broken = await target.makeUnserveableRuntime()
    let result: boolean
    try {
      result = await broken.ping()
    } catch (err) {
      fail(`ping() THREW on an unserveable runtime (${String(err)}) — the contract resolves false, never throws`)
    }
    if (result !== false) fail('ping() returned true on an unserveable runtime')
  },

  /**
   * Streams yield `done` exactly once, and it is the final chunk (R5) — and
   * plain (non-tool) turns carry classified chunk types only, same as tool
   * turns (R5b applies to EVERY stream, not just tool scenarios).
   */
  async streamDoneExactlyOnceAndLast(target: RuntimeConformanceTarget): Promise<void> {
    await target.prepareOkTurn?.()
    const chunks: ChatChunk[] = []
    for await (const chunk of target.runtime.messaging.stream({
      agentId: target.agentId,
      content: 'conformance: stream turn',
      threadId: target.newThreadId(),
    })) {
      chunks.push(chunk)
    }
    assertClassifiedChunks(chunks)
    assertDoneExactlyOnceAndLast(chunks)
  },

  /**
   * Thinking-level honesty: every level an adapter DECLARES in
   * routingSupport().supportedThinkingLevels must be honored — a turn sent
   * at that level settles cleanly (Bakin's routing layer clamps to this set
   * before the send, so a declared-but-broken level would fail real turns).
   */
  async thinkingLevelHonesty(target: RuntimeConformanceTarget): Promise<void> {
    const support = target.runtime.models.routingSupport()
    const declared = support.supportedThinkingLevels
    if (!Array.isArray(declared)) fail('routingSupport() declares no supportedThinkingLevels array')
    if (declared.length === 0) fail('routingSupport() declares an empty supportedThinkingLevels — a runtime that honors none must still accept turns without the param; declare the honored set')
    for (const level of declared) {
      await target.prepareOkTurn?.()
      try {
        await target.runtime.messaging.send({
          agentId: target.agentId,
          content: `conformance: thinking level ${level}`,
          threadId: target.newThreadId(),
          thinking: level,
        })
      } catch (err) {
        fail(`declared thinking level '${level}' failed a turn (${String(err)}) — declare only levels the runtime honors`)
      }
    }
  },

  /**
   * Usage parity (work-class attribution): a runtime whose send() results
   * carry token usage must attach the same accounting to the stream's
   * terminal `done` chunk — otherwise streamed turns (chat) are unmeterable
   * while sent turns bill. N/A on runtimes that report no usage at all.
   */
  async streamDoneCarriesUsageWhereSendDoes(target: RuntimeConformanceTarget): Promise<void> {
    await target.prepareOkTurn?.()
    const sent = await target.runtime.messaging.send({
      agentId: target.agentId,
      content: 'conformance: usage parity send',
      threadId: target.newThreadId(),
    })
    if (!sent.usage) return // runtime reports no usage anywhere — nothing to pin
    await target.prepareOkTurn?.()
    let done: Extract<ChatChunk, { type: 'done' }> | undefined
    for await (const chunk of target.runtime.messaging.stream({
      agentId: target.agentId,
      content: 'conformance: usage parity stream',
      threadId: target.newThreadId(),
    })) {
      if (chunk.type === 'done') done = chunk
    }
    if (!done) fail('usage-parity stream ended without a done chunk')
    if (!done.usage) {
      fail('send() reports usage but the stream done chunk carries none — streamed turns would be unmeterable (stream usage parity)')
    }
    const anyCount = [done.usage.input, done.usage.output, done.usage.total]
      .some((n) => typeof n === 'number' && Number.isFinite(n))
    if (!anyCount) fail('stream done usage carries no numeric token counts')
  },

  /**
   * Tool-using streams carry the R5b taxonomy: classified chunk types only,
   * structured RuntimeToolActivity on every tool chunk, valid format hints,
   * done exactly-once-and-last.
   */
  async toolTurnStreamsClassifiedStructuredChunks(target: RuntimeConformanceTarget): Promise<void> {
    const content = await target.prepareToolTurn()
    const chunks: ChatChunk[] = []
    for await (const chunk of target.runtime.messaging.stream({
      agentId: target.agentId,
      content,
      threadId: target.newThreadId(),
    })) {
      chunks.push(chunk)
    }
    assertClassifiedChunks(chunks)
    const tools = chunks.filter((c) => c.type === 'tool')
    if (tools.length === 0) fail('tool-using turn streamed no tool chunks')
    for (const chunk of tools) {
      const data = chunk.data as { phase?: unknown; toolName?: unknown } | undefined
      if (!data || (data.phase !== 'call' && data.phase !== 'result')) {
        fail(`tool chunk data.phase is '${String(data?.phase)}' (must be 'call' or 'result')`)
      }
      if (typeof data.toolName !== 'string' || data.toolName.length === 0) {
        fail('tool chunk data.toolName is missing/empty — tool chunks carry structured RuntimeToolActivity')
      }
    }
    if (chunks.some((c) => c.type === 'error')) fail('happy-path tool turn streamed an error chunk')
    assertDoneExactlyOnceAndLast(chunks)
  },

  /**
   * Terminal failure ends the stream with a typed `error` chunk (data.kind
   * when known) and NO done — and the iterator itself never throws.
   */
  async streamTerminalFailureIsTypedErrorChunk(target: RuntimeConformanceTarget): Promise<void> {
    const chunks: ChatChunk[] = []
    try {
      for await (const chunk of await target.failingStream()) {
        chunks.push(chunk)
      }
    } catch (err) {
      fail(`failing stream THREW (${String(err)}) — terminal failure must surface as an error chunk, the iterator never throws`)
    }
    const last = chunks.at(-1)
    if (!last || last.type !== 'error') {
      fail(`failing stream ended with '${last?.type ?? 'nothing'}' (must end with an error chunk)`)
    }
    const kind = (last.data as { kind?: unknown } | undefined)?.kind
    if (typeof kind !== 'string' || kind.length === 0) {
      fail('terminal error chunk carries no data.kind — consumers classify on kind, never message text')
    }
    if (chunks.some((c) => c.type === 'done')) {
      fail('failing stream also yielded done — terminal failure ends with error INSTEAD of done')
    }
  },

  /**
   * The send() onActivity tap fires on a tool turn with tool+status chunks
   * ONLY (text never taps), and a throwing callback never fails the turn.
   */
  async onActivityTapsToolAndStatusOnly(target: RuntimeConformanceTarget): Promise<void> {
    const content = await target.prepareToolTurn()
    const tapped: ChatChunk[] = []
    await target.runtime.messaging.send({
      agentId: target.agentId,
      content,
      threadId: target.newThreadId(),
      onActivity: (chunk) => tapped.push(chunk),
    })
    if (!tapped.some((c) => c.type === 'tool')) {
      fail('onActivity tap received no tool chunk during a tool-using send()')
    }
    const offender = tapped.find((c) => c.type !== 'tool' && c.type !== 'status')
    if (offender) {
      fail(`onActivity tapped a '${offender.type}' chunk — the tap carries tool+status only (text rides messaging.stream)`)
    }

    const content2 = await target.prepareToolTurn()
    const result = await target.runtime.messaging.send({
      agentId: target.agentId,
      content: content2,
      threadId: target.newThreadId(),
      onActivity: () => {
        throw new Error('tap explosion')
      },
    }).catch((err: unknown) => {
      fail(`a throwing onActivity callback failed the turn (${String(err)}) — adapters must contain tap exceptions`)
    })
    if (!result || typeof result.id !== 'string') fail('tap-throwing turn returned no MessageResult')
  },

  /**
   * capabilities() must describe surfaces that actually exist and work:
   * toolCalling.access agrees with describeToolAccess(); delivery 'native'
   * implies the channels surface is present; sessions 'native' implies
   * sessions.list returns the sessions real turns created (opt-out via
   * suite options until an adapter's T28-style implementation lands).
   */
  async capabilitiesAreHonest(target: RuntimeConformanceTarget, opts?: RuntimeConformanceSuiteOptions): Promise<void> {
    const caps = await target.runtime.capabilities()
    // Canonical (key-order-insensitive) compare: a fourth adapter building
    // the two objects with different key insertion order must not fail a
    // check it semantically satisfies.
    const declaredAccess = canonicalJson(caps.toolCalling.access)
    const describedAccess = canonicalJson(target.runtime.describeToolAccess())
    if (declaredAccess !== describedAccess) {
      fail(`capabilities().toolCalling.access (${declaredAccess}) disagrees with describeToolAccess() (${describedAccess})`)
    }
    if (caps.delivery.mode === 'native' && !target.runtime.channels) {
      fail("capabilities() declares delivery 'native' but the channels surface is absent")
    }
    if (caps.sessions.mode === 'native' && opts?.sessionsPin !== false) {
      await target.prepareOkTurn?.()
      const threadId = target.newThreadId()
      const result = await target.runtime.messaging.send({
        agentId: target.agentId,
        content: 'conformance: session-producing turn',
        threadId,
      })
      const createdSessionId = result.metadata?.sessionId
      if (typeof createdSessionId !== 'string' || createdSessionId.length === 0) {
        fail('session-producing threaded send returned no metadata.sessionId')
      }
      // A lying-but-non-empty stub must not pass: the list must contain THE
      // session this turn just created, not merely any session.
      const sessions = await target.runtime.sessions.list(target.agentId)
      if (!sessions.some((s) => s.id === createdSessionId)) {
        fail(
          "capabilities() declares sessions 'native' but sessions.list is missing the session a completed threaded turn just created — declared-native surfaces must reflect real turns, not stubs",
        )
      }
    }
  },

  /**
   * provisionToolAccess is idempotent: after a successful provision,
   * verifyToolAccess reports ok and a second provision changes nothing
   * durable (snapshot deep-equal via the target's observation hook).
   */
  async provisionToolAccessIsIdempotent(target: RuntimeConformanceTarget): Promise<void> {
    await target.runtime.provisionToolAccess()
    const verified = await target.runtime.verifyToolAccess()
    if (!verified.ok) {
      fail(`verifyToolAccess reports drift right after provisioning: ${verified.issues.join('; ')}`)
    }
    const before = JSON.stringify((await target.observeProvisionedState?.()) ?? null)
    await target.runtime.provisionToolAccess()
    const after = JSON.stringify((await target.observeProvisionedState?.()) ?? null)
    if (before !== after) {
      fail('a second provisionToolAccess changed durable state — provisioning must be idempotent')
    }
    const reverified = await target.runtime.verifyToolAccess()
    if (!reverified.ok) {
      fail(`verifyToolAccess reports drift after re-provisioning: ${reverified.issues.join('; ')}`)
    }
  },
  /**
   * listWorkspaceFiles enumerates RECURSIVELY (D5 of the runtime-switch-carry
   * spec): agent memory lives in subdirectories (`memory/*.md`), and a
   * top-level-only listing silently hides it from every consumer — the
   * runtime-switch workspace carry most critically. Round-trips a nested
   * write → list → read → remove through the workspace-file surface.
   */
  async workspaceFileEnumerationIsRecursive(target: RuntimeConformanceTarget): Promise<void> {
    const rel = `memory/conformance-recursive-${Math.random().toString(36).slice(2, 10)}.md`
    const content = '# conformance: nested workspace file'
    await target.runtime.agents.writeWorkspaceFile(target.agentId, { path: rel, content })
    try {
      const files = await target.runtime.agents.listWorkspaceFiles(target.agentId)
      if (!files.includes(rel)) {
        fail(
          `listWorkspaceFiles omitted nested '${rel}' — enumeration must be recursive `
          + `(agent memory lives in subdirectories); got: ${JSON.stringify(files)}`,
        )
      }
      const read = await target.runtime.agents.readWorkspaceFile(target.agentId, rel)
      if (read?.content !== content) {
        fail(`nested workspace file did not round-trip (read returned ${read === null ? 'null' : JSON.stringify(read?.content)})`)
      }
    } finally {
      await target.runtime.agents.removeWorkspaceFile(target.agentId, rel)
    }
  },

  /**
   * initialize() performs no filesystem writes to the adapter home (D4 of
   * the runtime-switch-carry spec). Seeding and config writes are
   * provisioning concerns — every supported boot/install/switch path calls
   * provisionToolAccess, while read-only consumers (bakin check, dry-run
   * secondary construction) call only initialize and must stay write-free.
   */
  async initializeIsWriteFree(target: RuntimeConformanceTarget): Promise<void> {
    if (!target.makeFreshInitScenario) return
    const scenario = await target.makeFreshInitScenario()
    try {
      const before = snapshotTree(scenario.homeDir)
      await scenario.initialize()
      const after = snapshotTree(scenario.homeDir)
      if (before !== after) {
        fail(
          `initialize() wrote to the adapter home — initialization must be read-only (provisioning owns writes).\n`
          + `before:\n${before || '<empty>'}\nafter:\n${after || '<empty>'}`,
        )
      }
    } finally {
      await scenario.cleanup?.()
    }
  },
} as const

/**
 * Deterministic snapshot of a directory tree: sorted relative paths with a
 * content hash per file. An absent root is a valid (distinct) state — a
 * write-free initialize against a never-created home must not create it.
 */
function snapshotTree(root: string): string {
  if (!existsSync(root)) return '<absent>'
  const lines: string[] = []
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, relPath)
      else lines.push(`${relPath} ${createHash('sha256').update(readFileSync(abs)).digest('hex')}`)
    }
  }
  walk(root, '')
  return lines.sort().join('\n')
}

/** Stable stringify with recursively-sorted object keys (structural compare). */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    )
  }
  return value
}

const CHUNK_TYPES = new Set(['text', 'tool', 'status', 'done', 'error'])
const TEXT_FORMATS = new Set(['markdown', 'plain', 'code'])

/** Classified chunk types only; format hints valid when present (R5b). */
function assertClassifiedChunks(chunks: ChatChunk[]): void {
  for (const chunk of chunks) {
    if (!CHUNK_TYPES.has((chunk as { type: string }).type)) {
      fail(`stream yielded unclassified chunk type '${(chunk as { type: string }).type}'`)
    }
    if (chunk.type === 'text' && chunk.format !== undefined && !TEXT_FORMATS.has(chunk.format)) {
      fail(`text chunk carries invalid format hint '${String(chunk.format)}'`)
    }
  }
}

function assertDoneExactlyOnceAndLast(chunks: ChatChunk[]): void {
  const doneIndexes = chunks.map((c, i) => (c.type === 'done' ? i : -1)).filter((i) => i >= 0)
  if (doneIndexes.length !== 1) {
    fail(`stream yielded ${doneIndexes.length} done chunks (must be exactly 1)`)
  }
  if (doneIndexes[0] !== chunks.length - 1) {
    fail(`done was not the final chunk (done at ${doneIndexes[0]}, ${chunks.length - 1 - doneIndexes[0]} chunk(s) after it)`)
  }
}

export function runRuntimeConformanceSuite(
  name: string,
  getTarget: () => RuntimeConformanceTarget,
  options?: RuntimeConformanceSuiteOptions,
): void {
  describe(`runtime conformance: ${name}`, () => {
    it('threaded send returns metadata.sessionId', async () => {
      await runtimeConformanceChecks.threadedSendReturnsSessionId(getTarget())
    })

    it('session-origin labels are honest where a transcript tier exists', async () => {
      await runtimeConformanceChecks.sessionOriginLabelsAreHonest(getTarget())
    })

    it("abort settles as kind 'aborted'", async () => {
      await runtimeConformanceChecks.abortSettlesAsAbortedKind(getTarget())
    })

    it('messaging failures are typed RuntimeErrors', async () => {
      await runtimeConformanceChecks.failuresAreTypedRuntimeErrors(getTarget())
    })

    it('ping reflects serveability (false, never throws, when unserveable)', async () => {
      await runtimeConformanceChecks.pingReflectsServeability(getTarget())
    })

    it('stream yields done exactly once, last', async () => {
      await runtimeConformanceChecks.streamDoneExactlyOnceAndLast(getTarget())
    })

    it('stream done carries usage where send does (usage parity)', async () => {
      await runtimeConformanceChecks.streamDoneCarriesUsageWhereSendDoes(getTarget())
    })

    it('declared thinking levels are honored (thinking honesty)', async () => {
      await runtimeConformanceChecks.thinkingLevelHonesty(getTarget())
    })

    it('tool turns stream classified, structured chunks', async () => {
      await runtimeConformanceChecks.toolTurnStreamsClassifiedStructuredChunks(getTarget())
    })

    it('terminal stream failure is a typed error chunk (iterator never throws)', async () => {
      await runtimeConformanceChecks.streamTerminalFailureIsTypedErrorChunk(getTarget())
    })

    it('onActivity taps tool+status only; throwing taps are contained', async () => {
      await runtimeConformanceChecks.onActivityTapsToolAndStatusOnly(getTarget())
    })

    it('capabilities() is honest about its surfaces', async () => {
      await runtimeConformanceChecks.capabilitiesAreHonest(getTarget(), options)
    })

    it('provisionToolAccess is idempotent', async () => {
      await runtimeConformanceChecks.provisionToolAccessIsIdempotent(getTarget())
    })

    it("unknown-agent CRUD: get returns null, mutations reject typed 'not_found'", async () => {
      await runtimeConformanceChecks.unknownAgentCrudIsTypedNotFound(getTarget())
    })

    it('cron member matches its declaration (presence is the contract)', async () => {
      await runtimeConformanceChecks.cronMemberMatchesDeclaration(getTarget(), options)
    })

    it('cron CRUD round-trips against the real store (when the member exists)', async () => {
      await runtimeConformanceChecks.cronCrudRoundTrip(getTarget())
    })

    it('initialize() is write-free (provisioning owns home writes)', async () => {
      await runtimeConformanceChecks.initializeIsWriteFree(getTarget())
    })

    it('workspace file enumeration is recursive', async () => {
      await runtimeConformanceChecks.workspaceFileEnumerationIsRecursive(getTarget())
    })
  })
}
