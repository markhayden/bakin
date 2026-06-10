# Post-#480 Hardening — Duplicate-Worker Guards, Reference Adoption, Feed Transparency

**Status:** Approved (Mark, 2026-06-09)
**Branch:** `feat/image-reference-images` — extends open PR #480; update the PR description to cover the new scope.
**Companion change:** `bakin-bits-official` repo (separate PR there) — pixel agent content. Never edit `~/.openclaw` directly.

## 1. Objective

The first live test of PR #480 (task `d1b213a5`, 2026-06-10) succeeded but exposed three failure classes:

1. **Duplicate worker:** `main` created + dispatched a task, then `bakin_exec_team_message`d the assignee about it 7s later. The unthreaded message landed in pixel's main session, which did the whole job in parallel with the dispatched run — two billed generates, two assets. Every existing guard (ledger, idempotency) sits *downstream* of this and correctly didn't fire.
2. **Zero feature adoption:** neither session passed `referenceImages` — no agent-facing guidance surface (managed blocks, workflow skill, OpenClaw bakin skill) mentions it; only the raw MCP tool description does. The `media://` reference URI in the task description cost ~70s of discovery friction.
3. **Opaque transparency:** the feed showed raw `task.completion_suppressed` / `task.dispatch_failure_ignored` event names at exactly the moments the user was most confused.

Plus: the #480 code review found the #379 shim guardrail is unreachable from the production call path, and several hygiene nits.

Target user: Mark (single operator) watching the Live Activity feed; agents (OpenClaw sessions) consuming Bakin tools and guidance. The product value proposition is transparency into the process — every fix here either prevents silent duplicate work or explains system behavior in human terms.

## 2. Work Items, Commits, Acceptance Criteria

Dependency-ordered, one commit each unless noted. Conventional commits with scope.

### C1 — `fix(media): forward full option surface through shim fallback + reject size`
*Items 3 + review finding 2.*

- `packages/adapter-openclaw/src/runtime.ts` (`generateImageViaShim`, ~926-940): forward `count`, `aspectRatio`, `resolution`, `background`, `outputFormat` from `RuntimeImageGenerateInput` into the `DirectImageRequest` so `assertShimCanHonor` actually executes in production.
- `packages/core/src/media/direct-image-provider.ts`: add `size` to `DirectImageRequest` and to the rejected set in `assertShimCanHonor` (reject, don't parse — shim callers must use width/height).

**Acceptance:**
- A shim-routed generate with `outputFormat: 'webp'` (or `count: 2`, `aspectRatio`, `resolution`, `background`, `size`) throws before any billed call; test asserts no fetch fired.
- A shim-routed generate with `outputFormat: 'png'` and no unsupported options still succeeds (existing honored-path test stays green).

### C2 — `fix(images): review hygiene — edit-base dedupe, wider shim gate, drift doc, missing tests`
*Item 10.*

- `plugins/images/lib/tools.ts`: `editImage` rejects (or silently dedupes — pick reject, clearer) a `referenceImages` entry equal to the base `assetId`; reference gate widens from `servedBy === 'shim'` to `servedBy !== 'runtime'` so unconfigured providers get the pre-flight message.
- `plugins/images/lib/idempotency.ts`: comment documenting the accepted fingerprint-drift edge (reference version advancing between timeout and retry → different signature → re-bill; accepted: inputs genuinely changed).
- Tests: unresolvable assetId reference ("Reference asset not found"), mixed assetId + raw-path reference list.

**Acceptance:** new tests pass; gate-widening has a test (unconfigured provider + references → clear error, no exec/fetch).

### C3 — `feat(images): resolve runtime media:// URIs as reference images`
*Item 6.*

- `packages/core/src/adapters/runtime/concepts.ts`: optional `resolveMediaUri(uri: string): Promise<string | null>` on the runtime adapter concept (null = unresolvable).
- `packages/adapter-openclaw/src/runtime.ts`: implement — `media://<rel>` maps under `getOpenClawPath('media', <rel>)` with traversal guard (resolved path must stay under the media root); existence-checked; null otherwise. `media://` knowledge stays adapter-private.
- `plugins/images/lib/tools.ts` (`resolveReferences`): entries matching `^media://` are resolved via `ctx.runtime.resolveMediaUri` *before* the existing existsSync/auto-import path, so a resolved reference becomes a tracked asset with `taskId` linkage exactly like a raw path. Adapter without the method, or null resolution → clear pre-billing error.

**Acceptance:**
- `referenceImages: ['media://inbound/x.png']` with the file present under the (mocked) OpenClaw home resolves, auto-imports, records lineage.
- Missing file / unsupported adapter → error before any billed call (no exec/fetch asserted).
- Traversal attempt (`media://../secrets`) → error.
- Tests mock both content-dir resolvers AND OpenClaw home per CLAUDE.md.

### C4 — `feat(team): refuse team messages that would spawn a duplicate task worker`
*Item 1. The headline guard.*

- *(As implemented — refined from the original hook sketch: the execution
  ledger is core, not a plugin, so the HookRegistry rule doesn't apply;
  `plugins/team` imports the `src/core/execution-ledger` facade directly,
  matching its existing `src/core/agents` import.)*
- `plugins/team/index.ts` (`bakin_exec_team_message` handler): extract ALL distinct task-id-shaped tokens (`/\b[0-9a-f]{8}\b/g`, no cap) from the message; for each, `getLiveRun(taskId)`. If a live run exists **and its agent is the message target**, hard-refuse: return `{ ok: false, error }` naming the task, runId, run age, and the alternatives (task comment via `bakin_exec_log`, or wait). Emit audit event `team.message_blocked` with `{ agentId, taskId, runId }` so the save is visible in Live Activity (humanized by the audit-message mapper, see C6).
- Ledger-unavailable: fail CLOSED for task-bearing messages — `LedgerUnavailableError` is caught (`instanceof`, never message text) and returned as a structured refusal explaining the ledger is down; token-free messages deliver unaffected.

**Acceptance:**
- Message naming a task with a live run for the target agent → refused, audited, runtime `sendMessageToAgent` NOT called (asserted).
- Message naming a task whose live run belongs to a *different* agent → delivered.
- Message naming a completed/settled task → delivered.
- Message with no task tokens → delivered.
- Ledger unavailable + task-bearing message → structured refusal, send NOT called (asserted); token-free message still delivers.

### C5 — `feat(tasks): live-run visibility in tasks_get + dispatch-notified copy in tasks_create`
*Items 2 + 8.*

- `bakin_exec_tasks_get`: result gains `liveRun: { runId, agent, startedAt } | null` (same ledger facade).
- `bakin_exec_tasks_create`: when creation auto-dispatched, append to the result message: dispatch already notified `<agent>` — do **not** send them a separate message about this task.

**Acceptance:** tasks_get on a task with a running ledger row returns the liveRun block; on a settled task returns null. tasks_create result contains the copy only when a dispatch actually fired.

### C6 — `feat(core): human-readable summaries for suppressed/ignored task events`
*Item 7.*

- *(As implemented — refined from the original emit-time-`summary` sketch:
  the feed already has a canonical humanization point, `mapAuditMessage` in
  `src/lib/map-audit-message.ts`, used by both the activity API and the SSE
  hook; these events rendered raw only because no case existed for them.
  Per-event cases there match how every other event renders. Trade-off
  accepted: the human copy is derived at read time and does not land in
  `audit.jsonl`/search rows — the raw data fields it derives from do.)*
- `src/lib/map-audit-message.ts`: cases for `task.completion_suppressed`,
  `task.dispatch_failure_ignored`, and `team.message_blocked` (C4's own
  event must not render raw either).
- `src/core/task-service.ts:163`: `task.completion_suppressed` emit data
  gains `title` so the copy can name the task.

**Acceptance:** mapper unit tests assert the exact copy for all three events (including missing-optional-field variants); existing audit consumers unaffected (the only emit change is the additive `title` field, no schema bump).

### C7 — `docs(agents): teach referenceImages + attachment-import across guidance surfaces`
*Items 4 + 5 + 2(rules half). Bakin-repo guidance surfaces only.*

- `src/core/agent-rules/managed-blocks.ts`:
  - Media-delegation section: `referenceImages` exists on generate/edit (assetIds, local paths, or `media://` URIs after C3; max 4; native runtime only); rule of thumb — *when the brief says "like this image," pass the image as a reference; don't transcribe it into prose*.
  - Tool Reference: add a `referenceImages=` example line to the `images_generate` mcporter command.
  - Hard rules / dependency section: creating a task dispatches it — never also message the assignee about it; for channel-message tasks with attachments, import the attachment (`bakin_exec_images_import taskId=…`) and put the assetId in the task description.
- `skill/SKILL.md` (source of the OpenClaw `bakin` skill): same teachings, skill-appropriate brevity.
- `plugins/images/defaults/workflow-skills/generate-image.md`: reference mechanics (when to use, parameter forms, native-only constraint).

**Acceptance:** `grep -ri referenceImages` hits all three surfaces; managed-blocks tests (if any assert content) updated; doctor projection unchanged mechanically (content-only edit).

### Companion (bakin-bits-official, separate PR in that repo)
*Items 9 + 4(bits half).*

- `agents/pixel/workspace/AGENTS.md`: style-guide instruction tightened — append only for series/brand/recurring work (skip one-offs), dedupe before append (same surface + materially-same cues = skip), cap ~10 entries per surface (prune oldest). Add referenceImages to the Generate vs Edit policy ("a provided source image to *imitate* → pass as referenceImages on generate; a source to *revise* → edit").
- `agents/pixel/workflow-skills/generate-image.md`: mirror the bakin-repo skill update.

**Acceptance:** content review only; `package-contract.test.ts` in bits still passes.

## 3. Commands

- Full suite: `bun run test` (CI parity). Single file: `bun test tests/path/foo.test.ts --isolate`.
- Typecheck: `bunx tsc --noEmit` (pre-existing astro/fixture errors are known-ignorable).
- Plugin build sanity: `bun scripts/build-plugins.ts`.
- No binary build (CI owns it). No server restart needed for managed-blocks content (doctor projects it).

## 4. Project Structure (touched)

```
packages/adapter-openclaw/src/runtime.ts        C1, C3
packages/core/src/media/direct-image-provider.ts C1
packages/core/src/adapters/runtime/concepts.ts   C3
plugins/images/lib/tools.ts                      C2, C3
plugins/images/lib/idempotency.ts                C2 (comment only)
plugins/images/defaults/workflow-skills/generate-image.md C7
plugins/team/index.ts                            C4
plugins/tasks/index.ts                           C4 (hook), C5
src/core/task-service.ts                         C6
src/core/dispatch.ts                             C6
packages/host/src/components/layout/layout-shell.tsx (+ activity item renderer) C6
src/core/agent-rules/managed-blocks.ts           C7
skill/SKILL.md                                   C7
tests/**                                         per commit
../bakin-bits-official/agents/pixel/**           companion
```

## 5. Code Style

Per CLAUDE.md: strict TS, Zod at boundaries, `createLogger`, no empty catches, kebab-case files, import order. Error classification by `kind`/`instanceof`, never message text. New audit event: `team.message_blocked`.

## 6. Testing Strategy

- Every test file mocks **both** content-dir resolvers and OpenClaw home; `getBakinPaths` mocks include `db`; ledger-touching tests use the in-memory execution-ledger fake (`tests/core/task-service.test.ts` pattern) or call `closeDb()` before cleanup.
- Plugin tests use `tests/plugins/test-helpers.ts` (`activatePlugin`, `callRoute`, `callTool`).
- Billed-call safety tests assert no `exec`/`fetch` fired on every new rejection path (C1, C2, C3) — same pattern as #480's existing tests.
- C4 needs a team-plugin test harness with a mocked runtime (`sendMessageToAgent` spy) + mocked hook registry or a real tasks-plugin activation alongside.
- Run full suite before each commit (`bun run test`); each commit is an independent rollback point.

## 7. Boundaries

**Always:**
- All new failure modes throw **before** any billed provider call.
- `media://` semantics stay inside `packages/adapter-openclaw`; the images plugin sees only "the runtime can resolve runtime URIs".
- Guidance edits for agents go to bakin-bits-official or bakin-repo sources — **never** `~/.openclaw`.
- Audit additions are additive data fields — no search `SCHEMA_VERSION` bump, no manifest migration.

**Ask first:**
- Any change to ledger schema or completion semantics (none planned — the ledger behaved correctly).
- Widening the team-message guard beyond exact task-token matches (e.g. fuzzy "are they busy" heuristics) — out of scope.

**Never:**
- Edit `~/.openclaw` or `~/.bakin` content as part of this work.
- Add a parallel stat/tracking system (usage recorder is the single recorder).
- Dedupe billed generates with different prompts at the idempotency layer — the upstream guard (C4) is the fix.
- Block or alter ledger completion-suppression behavior — narration only (C6).

## 8. Round 2 — second live test (task 6abc2131, 2026-06-10)

The guard + guidance worked (single dispatch, references used, QA loop ran).
Three remaining failure classes, fixed on the same branch:

### R1 — `feat(images)`: reference tag + iteration-as-version
- Auto-imported references get `tags: ['reference']` (filterable in the
  assets view; also distinguishes reference material from deliverables).
- **Iteration trap:** pixel's correction pass referenced its own first pass
  and minted a sibling asset. Fix (Mark-approved design): `versionOf` on
  `images_generate` appends the render as a new version (op `'generate'`,
  participates in the idempotency key via `source`, target validated
  pre-billing, rejected on edit); a generate referencing the agent's own
  same-task GENERATED output without `versionOf` is refused with a teaching
  error; `allowNewAsset=true` is the explicit companion-image escape hatch.
  Imported same-task references never trip the guard.

### R2 — `feat(channels)`: deliver-once guard on post_channel
- The same asset was posted to Discord twice (main's monitor loop + the
  completion reply; different captions, so the existing signature TTL cache
  could not catch it — and the posts were runtime-native, bypassing Bakin).
- Deterministic half: `post_channel` records successful asset deliveries in
  the durable ledger (`channel-post:<taskId>:<channel>:<assetId>`) and
  refuses a re-delivery regardless of caption; `repost=true` is the explicit
  escape hatch; failed deliveries never burn the slot.
- Guidance half (the part that actually bit): orchestrator rules — finished
  assets go to channels exactly once, via `post_channel` with
  `imageAssetId` + `taskId` (never pasted natively); only as the
  reply/handoff for the originating request; monitoring a task is never a
  posting trigger.

### R3 — guidance: iterate-as-version across all surfaces
managed-blocks media-delegation + Tool Reference, `skill/SKILL.md` (incl. a
Channel Delivery Discipline section), `generate-image` workflow skill, and
the bits companion PR (pixel AGENTS.md policy + skill mechanics, within the
350-word budget).

## 9. Round 3 — third live test (task 627ee59e, penguin screenshot, 2026-06-10)

Versioning held where the agent used edit (deliverable got v1→v2). Two
identity leaks minted duplicates; both closed deterministically:

### R4 — `feat(assets)`: store-path reflection + same-task content dedupe
- **Duplicate reference:** pixel passed a reference as a file path INTO the
  asset store (`…/store/<id>/v1.png`) instead of the assetId; source-path
  dedup keyed on the original `media/inbound` path, so a clone was minted —
  with `source.path` pointing inside another asset's directory.
  Fix: `resolveStoreFile()` maps store-internal paths (version files and
  thumbs) back to `assetId@version`; `upsertFromSource` returns that identity
  (`changed: false`) instead of cloning, and `resolveReferences` reflects the
  path into proper lineage (a thumb path resolves to the real version file).
- **Duplicate deliverable:** pixel copied the finished render to
  `workspace/tmp/…` and re-saved it via `bakin_exec_assets_save` (following
  the OUTPUT DISCIPLINE rule literally) — new path, new asset (op upload).
  Fix: when an upsert would CREATE an asset and the input carries a taskId,
  byte-identical content against any version of the same task's same-type
  assets (size prefilter + sha256) returns the existing identity instead.
  Deliberately task-scoped: reusing an image on a different task remains a
  new asset.
- Considered and rejected: a task-level "one asset unless declared" rule —
  needs intent inference and fights legit multi-deliverable tasks; the
  iteration guard (R1) already owns the intent layer, these close the
  identity layer (same file, new clothes).

### R5 — guidance: never re-save managed assets, references by assetId
asset-rules + OUTPUT DISCIPLINE managed blocks, bakin skill, generate-image
workflow skill (both repos): image tool results are already managed assets —
report the assetId, never copy-and-resave; references go by assetId once
imported, never by file path.

## 10. Out of Scope (ticketed/follow-up)

- `ctx.assets.upsertFromSource` on `AssetsAPI` (architecture nit from review — pre-existing pattern).
- References UI chip linking to the recorded (not current) version — pre-existing URL-state gap.
- Style guides as a managed product feature.
- Accepted residuals from the final review (documented, low-risk):
  `resolveStoreFile` prefix match is byte-case-sensitive (APFS case-variant
  paths bypass reflection) and lexical (symlinks not followed) — agents echo
  canonical tool-result paths; export paths (`exports/<name>`) don't reflect
  to the parent asset; the deliver-once ledger check is check-then-act
  (concurrent different-caption posts can race — observed incident was
  sequential); the iteration guard keys off the CURRENT version's op, so an
  imported-then-edited asset referenced via store path trips it
  (`allowNewAsset` covers); same-prompt re-roll into `versionOf` is swallowed
  as reuse (tweak the prompt for a pure RNG re-roll — consistent with edit
  idempotency).
