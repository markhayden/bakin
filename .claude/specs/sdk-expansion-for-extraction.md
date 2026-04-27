# SDK Expansion for Plugin Extraction

**Status:** Draft 1 — for review
**Companion to:** `.claude/specs/plugin-extraction-and-hotreload.md`
**Unblocks:** Phase 4 (extract messaging) + Phase 5 (extract projects)
**Author:** Claude (drafted 2026-04-27)

## 1. Objective

Expand `@bakin/sdk` so an out-of-tree plugin (one installed via
`bakin plugins install` or `bakin plugins link`) can talk to the
runtime surfaces a real plugin needs — OpenClaw streaming, vault
secrets, content-dir paths, audit logging, task creation, the main
agent id — through stable, permission-gated APIs.

This is the precursor that unblocks the messaging + projects
extraction. Every other phase of plugin-architecture-v2 is shipped or
in PR; only Phase 4-5 depend on this work landing first.

## 2. Why this is blocked today

The audit (`.claude/specs/plugin-extraction-and-hotreload-plan.md` §
Phase 4 P4.B2) flagged the SDK gap as a risk. Phase 4-5 in their
written form said *"Where SDK doesn't expose what's needed: file an
SDK gap issue."* This spec is that issue, materialized.

Messaging + projects together import these bakin-internal modules:

| Source | Symbols used | Plugin |
|---|---|---|
| `@/core/openclaw-client` | `streamMessage`, `chatCompletion`, `sendChannelMessage` | messaging |
| `@/core/vault` | `vault.get('gateway-token')` | messaging |
| `@/core/audit` | `appendAudit` | projects (messaging uses `ctx.activity.audit` already) |
| `@/core/content-dir` | `getContentDir`, `getBakinPaths` | both |
| `@/core/main-agent` | `getMainAgentId` | both |
| `@/core/logger` | `createLogger` | both |
| `@/core/task-service` | `createTaskWithEffects` | messaging |

None of these are on `@bakin/sdk/*` today. Vendoring them into each
extracted plugin would duplicate ~1000+ lines of bakin internals AND
violate the layering rule we just enforced in Phase 7. Direct imports
of `../../src/core/...` from a plugin installed in
`~/.bakin/plugins/<id>/` don't resolve at runtime — the plugin runs
inside the bakin process but its module graph doesn't include
bakin's source tree.

The only correct fix is to make the bakin runtime hand these
capabilities to plugins through a stable surface that survives hot
reload, rebuild, and binary distribution.

## 3. Design principles

These shape every decision in §4 and §5:

1. **Plugins reach the runtime through ctx, not through imports.**
   Permission-gated APIs (vault, openclaw, tasks) become methods on
   `PluginContext` so the runtime can audit, rate-limit, and refuse
   them per `bakin-plugin.json#permissions`.
2. **Pure utilities can be re-exports.** `createLogger`,
   `getContentDir`, `getBakinPaths`, `getMainAgentId` carry no
   capability — they read process state. Re-exporting them from
   `@bakin/sdk/runtime` is fine and saves the ctx surface from
   bloat.
3. **The browser-side SDK does NOT change.** Hooks, components, slots
   all stay where they are. This work is server-only.
4. **Hot reload must keep working.** Every new ctx method must be a
   closure over runtime state, not a captured import — otherwise the
   reload pipeline's same-ctx-reused contract breaks.
5. **No new dependencies in the SDK package.** The SDK stays
   import-graph-light; runtime resolution happens via the host's
   externals + import map (the same way `@bakin/sdk/components`
   already works).

## 4. The new SDK surface

### 4.1 New ctx methods (permission-gated)

#### `ctx.openclaw`

```ts
interface OpenClawAPI {
  /** Stream a chat completion through the OpenClaw gateway. */
  streamMessage(opts: ChatOpts): Promise<Response>
  /** Non-streaming chat completion. */
  chatCompletion(opts: ChatOpts): Promise<string>
  /** Send a message to a notification channel (Discord, Slack, etc). */
  sendChannelMessage(channel: string, target: string, message: string, attachments?: unknown[]): Promise<void>
  /** Send a direct message to an agent by id. */
  sendMessage(agentId: string, message: string): Promise<string>
  /** Probe the gateway. */
  ping(): Promise<boolean>
}
```

Permission required: `openclaw.write` (new — see §5).

The `ChatOpts` type re-exports from `@bakin/sdk/types` so plugins
don't have to redeclare it.

#### `ctx.vault`

```ts
interface VaultAPI {
  /** Read a named secret. Throws if the key isn't allowed for this plugin. */
  get(key: string): string | undefined
  /** Check whether a key exists without reading the value. */
  has(key: string): boolean
  /** Plugin-scoped key list. Excludes secrets the plugin lacks read access to. */
  listKeys(): string[]
}
```

Permission required: `vault.read` (new — see §5). PER-PLUGIN
allowlist of keys is enforced too: a plugin's manifest declares
`vaultKeys: ['gateway-token']`, and `ctx.vault.get('something-else')`
throws even if the plugin has the broad permission.

The existing `createPluginVault(pluginId)` factory in
`packages/core/src/vault.ts` is the implementation seam — it already
takes a plugin id; we feed the manifest's allowlist through.

No `vault.set` or `vault.write` exposed via ctx. Secret writing
remains a CLI-only operation (`bakin secrets set`) so plugins can't
silently install credentials.

#### `ctx.tasks`

```ts
interface TasksAPI {
  /** Create a task with all the side-effect plumbing — Antfly index,
   *  audit, broadcast, dependent re-dispatch. */
  create(opts: CreateTaskOpts): Promise<Task>
  /** Move a task to a different column. */
  move(taskId: string, column: string, opts?: MoveOpts): Promise<void>
  /** Block a task with a reason. */
  block(taskId: string, reason: string): Promise<void>
  /** Mark a task complete with a summary. */
  complete(taskId: string, summary: string): Promise<void>
  /** Read full task detail. */
  get(taskId: string): Promise<TaskDetails | null>
  /** Trigger an immediate dispatch cycle. */
  triggerDispatch(): void
}
```

Permission required: `tasks.write` (new). Read-only methods (`get`)
require `tasks.read`.

This wraps the existing `task-service.ts` exports. The runtime
implementation lives behind the ctx so the audit + Antfly + broadcast
side effects fire reliably across reloads.

### 4.2 New `@bakin/sdk/runtime` re-exports (no permission gate)

```ts
// @bakin/sdk/runtime
export { createLogger, type Logger } from '...'
export { getContentDir, getBakinPaths, type BakinPaths } from '...'
export { getMainAgentId, getMainAgentName, tryGetMainAgentId } from '...'
```

These are pure reads of process state. No capability is granted by
exposing them. They DON'T appear on `ctx` because:

- `ctx.logger` would be a stylistic regression (every plugin already
  has `const log = createLogger('plugin-id')` at the top).
- Path helpers are used at module scope (e.g. `const SESSIONS_DIR =
  join(getContentDir(), 'messaging', 'sessions')`) where `ctx` isn't
  in scope.

### 4.3 New SDK type re-exports

`@bakin/sdk/types` gains:

```ts
export type { ChatOpts } from '...'
export type { Task, TaskDetails, CreateTaskOpts, MoveOpts, Channel } from '...'
export type { BakinPaths } from '...'
```

Adding to the existing `types/` re-export bundle, no new sub-path
needed.

### 4.4 Permission schema additions

`packages/core/src/plugins/permissions.ts` gains four new entries:

| Permission | Capability |
|---|---|
| `openclaw.write` | Stream/send messages via OpenClaw, send channel messages |
| `vault.read` | Read named secrets (further gated by per-plugin allowlist) |
| `tasks.read` | Read tasks via `ctx.tasks.get` |
| `tasks.write` | Create / move / block / complete tasks via `ctx.tasks.*` |

Existing permissions stay (`storage.read`, `storage.write`,
`events.emit`, `openclaw.read`).

The Zod enum gains the new values; the install/upgrade consent
prompt surfaces them at install time — same flow as today.

### 4.5 Manifest schema additions

```jsonc
// bakin-plugin.json
{
  "id": "messaging",
  // ... existing fields ...
  "permissions": ["openclaw.write", "vault.read", "tasks.write", "storage.read", "storage.write", "events.emit"],
  "vaultKeys": ["gateway-token"]   // NEW: per-plugin allowlist
}
```

`vaultKeys` is optional. When `vault.read` is in `permissions` AND
`vaultKeys` is omitted, the plugin can read NOTHING — explicit
allowlisting required. That's the principle of least privilege; if
a plugin needs to read every secret, it has to enumerate them.

## 5. Permission model

### 5.1 The four-tier escalation

```
Tier 0 — no permission required:
  ctx.events.*, ctx.activity.*, ctx.search.*, ctx.hooks.*,
  ctx.storage.* (read-only methods)
  + all @bakin/sdk/runtime re-exports

Tier 1 — broad declared permission:
  storage.write    → ctx.storage.write*
  events.emit      → already required for ctx.events.broadcast
  openclaw.read    → ctx.openclaw.ping(), ctx.openclaw.{getAgentLastReply}
  openclaw.write   → ctx.openclaw.{streamMessage, chatCompletion, sendChannelMessage, sendMessage}
  tasks.read       → ctx.tasks.get
  tasks.write      → ctx.tasks.{create, move, block, complete, triggerDispatch}

Tier 2 — broad permission + per-key allowlist:
  vault.read + vaultKeys: [...]    → ctx.vault.{get, has, listKeys}
  (listKeys returns only keys in the allowlist)

Tier 3 — never granted to plugins:
  vault.set
  Direct registry mutation (route registration etc. — those go
  through ctx.registerRoute and friends at activate time only)
  Process-level operations (process.exit, signal handlers, etc.)
```

### 5.2 Runtime enforcement

The `buildContext` helper in `src/lib/plugin-registry.ts` reads the
plugin's permissions from its manifest at activate time and
constructs a ctx where forbidden methods throw clear errors:

```ts
ctx.vault.get = (key: string) => {
  if (!hasPermission('vault.read')) {
    throw new Error(`plugin "${id}" lacks vault.read permission`)
  }
  if (!allowedVaultKeys.has(key)) {
    throw new Error(`plugin "${id}" not allowed to read vault key "${key}"`)
  }
  return realVault.get(key)
}
```

The error wording is consistent across every permission gate so
plugin authors learn the format once.

### 5.3 Audit trail

Every Tier-1 / Tier-2 invocation appends an audit row:

```jsonl
{"ts":"...","event":"plugin.openclaw.write.stream","agent":"system","pluginId":"messaging","duration":380}
{"ts":"...","event":"plugin.vault.read","agent":"system","pluginId":"messaging","key":"gateway-token"}
{"ts":"...","event":"plugin.tasks.create","agent":"system","pluginId":"messaging","taskId":"task-123"}
```

Operators can `grep ~/.bakin/audit.jsonl 'plugin\.vault'` to see
every secret read across every plugin. Same pattern as the existing
`plugin.install.rejected` security audit rows.

## 6. Implementation plan

### 6.1 Phase ordering

Goal: ship in one PR per the user's "everything in same PR" pref.
Six commits, each independently reviewable but landing together:

| # | Commit | Files | Tests |
|---|---|---|---|
| 1 | `feat(plugins): permission schema gains openclaw.write/vault.read/tasks.{read,write}` | `packages/core/src/plugins/permissions.ts` | new permission cases in `permissions.test.ts` |
| 2 | `feat(plugins): manifest gains vaultKeys allowlist` | `packages/host/src/api/plugins/install.ts`, `lockfile.ts`, manifest validation | install.test.ts cases for valid + malformed |
| 3 | `feat(sdk): runtime re-exports — createLogger, getContentDir, getBakinPaths, getMainAgentId` | `packages/sdk/src/runtime/index.ts` (new), `packages/sdk/package.json` (new export), bakin shell + bundle externals | runtime.test.ts unit-level |
| 4 | `feat(plugins): ctx.vault permission-gated read API` | `src/lib/plugin-registry.ts` (buildContext), `packages/core/src/plugin-types.ts` | per-plugin allowlist enforcement, audit emission |
| 5 | `feat(plugins): ctx.openclaw + ctx.tasks permission-gated APIs` | same files; wraps existing openclaw-client + task-service surfaces | gate enforcement, audit emission, rate-limit smoke (deferred — see §7.3) |
| 6 | `docs(plugins): SDK runtime + ctx surface authoring guide` | `docs-old/plugin-authoring.md`, `.claude/knowledge/plugin-system.md` | none |

### 6.2 ctx interface evolution

```ts
// packages/core/src/plugin-types.ts (existing PluginContext + new fields)

export interface PluginContext {
  // ... existing fields ...

  /** Server-side OpenClaw gateway client. Permission-gated by
   *  openclaw.write (broad) + openclaw.read (narrow). */
  openclaw: OpenClawAPI

  /** Permission-gated secret reads. Per-plugin key allowlist
   *  enforced via bakin-plugin.json#vaultKeys. */
  vault: VaultAPI

  /** Task service surface. Permission-gated by tasks.{read,write}. */
  tasks: TasksAPI
}
```

All three new fields ALWAYS exist on ctx — methods just throw when
permission is missing. This is friendlier than `ctx.openclaw ?
ctx.openclaw.streamMessage(...) : ...` polymorphism and keeps types
stable.

### 6.3 Vault per-plugin allowlist plumbing

`createPluginVault(pluginId)` in
`packages/core/src/vault.ts` already takes a plugin id; today it
returns a vault scoped to that plugin's namespace. We extend it:

```ts
export function createPluginVault(
  pluginId: string,
  allowlist: ReadonlySet<string>,
): PluginVault {
  return {
    get(key) {
      if (!allowlist.has(key)) {
        throw new Error(`plugin "${pluginId}" not allowed to read vault key "${key}"`)
      }
      return realVault.get(key)
    },
    has(key) {
      if (!allowlist.has(key)) return false
      return realVault.has(key)
    },
    listKeys() {
      return realVault.listKeys().filter((k) => allowlist.has(k))
    },
  }
}
```

The allowlist comes from the lockfile entry's manifest copy — it's
written at install time and re-read at activate time. Hot reload
re-reads it from the freshly-imported manifest, so a plugin can't
expand its own allowlist mid-flight without going through the
upgrade consent flow.

## 7. Migration path for messaging + projects

### 7.1 Messaging delta

```diff
- import { streamMessage, chatCompletion } from '@/core/openclaw-client'
- import { sendChannelMessage } from '../../src/core/openclaw-client'
- import * as vault from '../../src/core/vault'
- import { getContentDir } from '../../src/core/content-dir'
- import { createLogger } from '../../src/core/logger'
- import { getMainAgentId } from '../../src/core/main-agent'
+ import { createLogger, getContentDir, getMainAgentId } from '@bakin/sdk/runtime'
+ // openclaw.*, vault.*, tasks.* now come through ctx — bind in activate.

 const log = createLogger('messaging')

 const plugin: BakinPlugin = {
   id: 'messaging',
   async activate(ctx) {
+    const { openclaw, vault, tasks } = ctx
     // ... rest of activate uses openclaw.streamMessage(...)
     //      vault.get('gateway-token'), tasks.create(...)
   }
 }
```

Manifest gains:

```diff
   "permissions": [
     "storage.read",
     "storage.write",
     "events.emit",
+    "openclaw.write",
+    "vault.read",
+    "tasks.write"
   ],
+  "vaultKeys": ["gateway-token"]
```

### 7.2 Projects delta

Smaller surface — projects only uses `appendAudit`,
`getContentDir`, `getBakinPaths`, `getMainAgentId`,
`createTaskWithEffects`. No vault, no openclaw streaming.

```diff
- import { appendAudit } from '../../../src/core/audit'
- import { createLogger } from '../../../src/core/logger'
- import { createTaskWithEffects } from '../../../src/core/task-service'
- import { getBakinPaths, getContentDir } from '../../../src/core/content-dir'
- import { getMainAgentId } from '../../../src/core/main-agent'
+ import { createLogger, getContentDir, getBakinPaths, getMainAgentId } from '@bakin/sdk/runtime'
```

`appendAudit` migrates to `ctx.activity.audit(event, agent, data)`
which already exists. `createTaskWithEffects` migrates to
`ctx.tasks.create(...)`.

Manifest:

```diff
   "permissions": [
     "storage.read",
     "storage.write",
     "events.emit",
+    "tasks.write"
   ]
```

### 7.3 Rate limiting (deferred)

Not in scope for this spec. A bad plugin could spam
`ctx.openclaw.streamMessage` or `ctx.tasks.create` and exhaust the
gateway / overflow the task store. Mitigation tracked separately —
likely a token-bucket layer behind the ctx methods, configurable
per-plugin in `~/.bakin/settings.json`. Audit trail (§5.3) is
sufficient observability to spot abuse meanwhile.

## 8. Testing strategy

### 8.1 Unit (per-commit)

- Permission enum: every new value parses; malformed rejects with the
  Levenshtein "did you mean…" suggestion (existing test file gains
  cases).
- `createPluginVault(id, allowlist)`: get/has/listKeys all enforce
  the allowlist; cross-plugin access throws.
- `buildContext` permission gating: each Tier-1 / Tier-2 method
  throws when permission missing; succeeds when granted.
- Audit emission: every Tier-1+ method writes an audit row in the
  expected shape.

### 8.2 Integration (extraction round-trip)

- Local fixture plugin under `tests/fixtures/plugins/sdk-runtime-fixture/`
  declares the new permissions, calls every new ctx method, and
  asserts the runtime accepts/refuses based on manifest contents.
- Hot-reload integration test (existing) extended to verify the new
  ctx methods survive reload — closure over runtime state, not
  captured imports.

### 8.3 Manual smoke

- `bakin plugins install ./tests/fixtures/plugins/sdk-runtime-fixture/`
- Inspect `~/.bakin/audit.jsonl` after exercising the plugin's
  routes — verify per-method audit rows.
- Modify the fixture's manifest to drop `vault.read`, reinstall —
  verify the plugin's vault.get throws at runtime with a clear
  error.

## 9. Sequencing with Phase 4-5

```
Order of merge:
  1. THIS PR — SDK expansion (this spec).
  2. SDK npm publish (issue #178) — uses the new exports table from
     this PR. Ships the full surface to npm.
  3. Phase 4 — extract messaging into bakin-bits-official. Imports
     resolve cleanly because the SDK is now on npm with the runtime
     surface. ~5 commits in bakin-bits-official, ~5 commits in bakin
     (delete plugins/messaging/, dev.ts, plugin-static-imports,
     bakin.config.ts, embedded-assets regen, recommended-plugins
     entry).
  4. Phase 5 — same shape for projects.
  5. Update RECOMMENDED_PLUGINS array (Phase 6 file already wired)
     with the messaging + projects entries.
```

bakin-bits-official PR #1 (Phase 3 skeleton) is already merged —
once steps 1+2 land, Phase 4-5 can move in parallel against
bakin-bits-official's main.

## 10. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Plugin hot reload breaks the new ctx methods because they capture imports | Every ctx method wraps a runtime lookup of the underlying singleton (vault, gateway-client, task-service). The ctx itself is stable across reloads (Phase 2 invariant); only the captured singletons matter, and those live on `globalThis`. |
| Permission escalation via crafted manifest at upgrade time | Existing consent token flow already binds the manifest's permission set to the consent prompt. New permissions follow the same path; no escalation possible without user accept. |
| Vault allowlist bypass | Per-plugin allowlist is read from the LOCKED manifest copy in the lockfile, not the live one. A plugin can't rewrite its own bakin-plugin.json post-install to gain access to more keys. |
| Audit volume explodes when plugins call ctx methods in tight loops | Audit is best-effort + non-blocking. The volume risk is shifted to ~/.bakin/audit.jsonl growth — addressed by the existing audit rotation policy (or its absence today, tracked separately as #N). |
| API surface ossifies before we know what shape is right | All the new ctx methods are direct mirrors of existing core APIs the messaging + projects plugins already consume. No speculative additions. Future plugins drive future expansion. |

## 11. Definition of done

- [ ] All four new permissions in the schema; consent prompt renders them.
- [ ] `vaultKeys` allowlist accepted in manifest + lockfile; per-plugin enforcement verified by unit test.
- [ ] `@bakin/sdk/runtime` exports `createLogger`, `getContentDir`, `getBakinPaths`, `getMainAgentId` (+ tryGetMainAgentId, getMainAgentName).
- [ ] `ctx.openclaw`, `ctx.vault`, `ctx.tasks` exist on every plugin's PluginContext.
- [ ] Each new method audit-logs to ~/.bakin/audit.jsonl with `event: plugin.<surface>.<op>` shape.
- [ ] Plugin authoring docs updated.
- [ ] Full test suite green.
- [ ] Manual smoke: a fixture plugin exercises every new method against a live bakin and behaves as documented.

## 12. Open questions

- **Should `ctx.tasks` extend to scheduling primitives too?** The
  schedule plugin owns cron jobs; messaging today imports
  `messaging-cron.ts` indirectly. Probably yes, but out of scope for
  the messaging+projects extraction. Track separately as a follow-up.
- **Should audit rows include arguments?** We log `taskId` for
  task creation, `key` for vault reads — should we log `channel` +
  `target` for `sendChannelMessage`? Lean toward yes; the channel
  name isn't sensitive but is operationally useful for investigation.
- **Rate limiting design.** Token bucket per (plugin, surface)? Or
  per (plugin, surface, op)? Likely per-surface — "messaging is
  spamming streamMessage" is a useful diagnostic; "messaging is
  spamming streamMessage but only the chatCompletion variant" is
  too granular.
