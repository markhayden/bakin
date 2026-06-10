---
title: "Implementation plan — post-#480 hardening"
spec: ./post-480-hardening.md
issues: [480]
status: ready-for-review
---

# Plan — post-#480 hardening

Companion to `post-480-hardening.md`. Seven commits appended to
`feat/image-reference-images` (PR #480), dependency-ordered; each commit
builds, type-checks, and passes its tests independently. Plus one companion
PR in `../bakin-bits-official` (content only).

## Dependency graph

```
C1 fix(media): shim forwards options + rejects size
  T1.1 DirectImageRequest.size + assertShimCanHonor rejects it (test-first)
  T1.2 generateImageViaShim forwards count/aspectRatio/resolution/background/outputFormat/size
  T1.3 tests: each option → throws pre-billing on shim route, no fetch; honored path green
        ▼ checkpoint A → commit 1
C2 fix(images): review hygiene                       [touches tools.ts before C3 does]
  T2.1 editImage rejects reference === base assetId (test-first)
  T2.2 reference gate: servedBy !== 'runtime' (test-first)
  T2.3 idempotency.ts drift comment (doc only)
  T2.4 tests: unresolvable assetId ref; mixed assetId+path list
        ▼ checkpoint B → commit 2
C3 feat(images): media:// reference URIs             [touches tools.ts + adapter after C1/C2]
  T3.1 concepts.ts: optional resolveMediaUri on AgentRuntimeAdapter
  T3.2 adapter-openclaw impl (media root mapping + traversal guard + existsSync)
  T3.3 tools.ts resolveReferences: media:// branch → resolve → existing auto-import path
  T3.4 tests: resolve+import+lineage / missing / unsupported adapter / traversal — all pre-billing
        ▼ checkpoint C → commit 3
C4 feat(team): duplicate-worker guard                [independent of C1–C3]
  T4.1 task-token extraction + getLiveRun check + hard refuse + team.message_blocked audit
  T4.2 tests: refused+audited+send-not-called / other-agent delivered / settled delivered / no-tokens delivered
        ▼ checkpoint D → commit 4
C5 feat(tasks): liveRun in tasks_get + create copy   [shares ledger read with C4]
  T5.1 tasks_get result.liveRun (test-first)
  T5.2 tasks_create dispatch-notified copy in notice (test-first)
        ▼ checkpoint E → commit 5
C6 feat(core): humanized suppressed/ignored events   [independent]
  T6.1 map-audit-message.ts cases ×2 (test-first) + title added to completion_suppressed emit data
        ▼ checkpoint F → commit 6
C7 docs(agents): guidance updates                    [after C3 so media:// is real]
  T7.1 managed-blocks.ts (media-delegation + Tool Reference + hard rules)
  T7.2 skill/SKILL.md
  T7.3 plugins/images/defaults/workflow-skills/generate-image.md
        ▼ checkpoint G → commit 7 → push, update PR #480 description
COMPANION (bakin-bits-official, separate PR)
  T8.1 agents/pixel/workspace/AGENTS.md (style-guide policy + referenceImages in Generate-vs-Edit)
  T8.2 agents/pixel/workflow-skills/generate-image.md (mirror T7.3)
```

Plan-level refinements vs the spec (rationale, not scope change):

1. **C4 uses a direct core-facade import, not a hook.** The spec sketched a
   `tasks.live-run` hook, but the execution ledger is core, not a plugin —
   the HookRegistry rule governs *plugin↔plugin* calls. `plugins/team/index.ts`
   already imports `src/core/agents` directly (line 32); importing
   `src/core/execution-ledger`'s `getLiveRun` is the same established pattern,
   with no new registration surface. C5 reads the same facade from
   `plugins/tasks`.
2. **C6 uses the existing humanization point.** The feed's main line is
   `mapAuditMessage(entry.event, data)` (`src/lib/map-audit-message.ts`,
   called from `packages/host/src/api/activity.ts:39`); raw event names render
   only because the mapper has no case for these events. Add two cases there
   (client+server-safe lib, no schema change) instead of the spec's emit-time
   `summary` field. One emit-site change remains: `task.completion_suppressed`
   gains `title` in its data so the copy can name the task.

---

## Tasks

### C1 — `fix(media): forward full option surface through shim fallback + reject size`

**T1.1** `packages/core/src/media/direct-image-provider.ts`: add `size?: string`
to `DirectImageRequest` (same "carried to reject" block, lines 31-35) and a
rejection in `assertShimCanHonor` ("pass width/height instead").
Test-first in `tests/core/media/direct-image-provider.test.ts`.

**T1.2** `packages/adapter-openclaw/src/runtime.ts` `generateImageViaShim`
(~933): spread `count/aspectRatio/resolution/background/outputFormat/size`
from `RuntimeImageGenerateInput` into the `generateDirectImage` call.
Only defined fields (exactOptionalPropertyTypes-safe spreads as in #480).

**T1.3** `tests/adapter-openclaw/runtime-images.test.ts`: shim-routed generate
with each unsupported option throws before any provider call (mock
`generateDirectImage`... no — mock fetch/exec and assert neither fired, same
pattern as existing shim tests); honored path (`outputFormat:'png'`, no
options) still succeeds.

**Verify:** `bun test tests/core/media/direct-image-provider.test.ts tests/adapter-openclaw/runtime-images.test.ts --isolate` → commit.

### C2 — `fix(images): review hygiene`

**T2.1** `plugins/images/lib/tools.ts` `editImage` (~458): if
`params.referenceImages?.includes(params.assetId)` → fail with "reference
equals the asset being edited — references add *other* context images".

**T2.2** Same file, `resolveReferences` (~202): `servedBy !== 'runtime'` →
error names the actual `servedBy` value ("served via the direct shim" /
"provider not configured").

**T2.3** `plugins/images/lib/idempotency.ts` (~40): comment block on the
accepted drift edge (reference version advances between client timeout and
retry → new fingerprint → re-bill; accepted because the inputs genuinely
changed).

**T2.4** `tests/plugins/images/tools.test.ts`: unresolvable assetId reference
→ "Reference asset not found", no billed call; mixed assetId+raw-path list
resolves both and records both lineage entries; T2.1/T2.2 cases.

**Verify:** `bun test tests/plugins/images/tools.test.ts --isolate` → commit.

### C3 — `feat(images): resolve runtime media:// URIs as reference images`

**T3.1** `packages/core/src/adapters/runtime/concepts.ts`: on
`AgentRuntimeAdapter`, `resolveMediaUri?(uri: string): Promise<string | null>`
— doc comment: runtime-private URI scheme → absolute local path, null when
unresolvable; never throws for not-found.

**T3.2** `packages/adapter-openclaw/src/runtime.ts`: implement —
`media://<rel>` → `getOpenClawPath('media', <rel>)`; guard:
`resolve()`d path must start with the media root (reject traversal), must
exist. Non-`media://` schemes → null.

**T3.3** `plugins/images/lib/tools.ts` `resolveReferences`: before the
assetId/path branch, entries matching `/^media:\/\//` resolve via
`ctx.runtime.resolveMediaUri`; missing method → error "the active runtime
cannot resolve media:// URIs"; null → error "Reference media URI not found".
The resolved path then flows through the **existing** raw-path auto-import
(asset gets `taskId` linkage + lineage like any path reference).

**T3.4** Tests: plugin side in `tools.test.ts` (mock ctx.runtime with/without
the method); adapter side in `runtime-images.test.ts` or a focused file —
happy path under mocked OpenClaw home, traversal rejection, missing file.
All failures asserted pre-billing (no exec/fetch). CLAUDE.md mocks: both
content-dir resolvers + OpenClaw home; env vars set before imports.

**Risk:** the optional method must also be absent-safe for the Imitation Crab
mock (`dev/imitation-crab`) — optional means no mock change required; verify
`bun run dev:mock` type-checks (covered by `tsc --noEmit`).

**Verify:** images + adapter test files, `bunx tsc --noEmit` (only
pre-existing errors), `bun scripts/build-plugins.ts` → commit.

### C4 — `feat(team): refuse team messages that would spawn a duplicate task worker`

**T4.1** `plugins/team/index.ts` `bakin_exec_team_message` handler (~1896):
extract candidate ids `message.match(/\b[0-9a-f]{8}\b/g)` (dedup, cap ~10);
for each, `getLiveRun(taskId)` (import from `../../src/core/execution-ledger`,
matching the file's existing `src/core/agents` import). If a live run's
`agent` equals the target `agentId` → return
`{ ok: false, error: '<agent> is already working task <id> (run <runId>, started <relative>). Sending this message would start a duplicate worker in their main session. Add a task comment (bakin_exec_log) or wait for completion.' }`,
`appendAudit(…, 'team.message_blocked', sender, { agentId, taskId, runId })`,
and do NOT call `sendMessageToAgent`. Ledger-unavailable: `getLiveRun`'s
guard already fails closed — a throw surfaces as a refused send for
task-bearing messages only.

**T4.2** New `tests/plugins/team/message-guard.test.ts` (pattern:
`tests/plugins/team/exec-tools.test.ts` + the in-memory execution-ledger mock
from `tests/core/task-service.test.ts`): four acceptance cases from the spec;
spy on the runtime messaging mock to assert non-delivery.

**Verify:** `bun test tests/plugins/team/message-guard.test.ts tests/plugins/team/exec-tools.test.ts --isolate` → commit.

### C5 — `feat(tasks): live-run visibility + dispatch-notified copy`

**T5.1** `plugins/tasks/index.ts` `bakin_exec_tasks_get` handler (~721): after
enrichment, `liveRun: getLiveRun(taskId)` mapped to
`{ runId, agent, startedAt } | null` (ledger row → ISO timestamp).

**T5.2** Same file, `bakin_exec_tasks_create` (~777): when `parentId || assignee`
triggered dispatch, push notice: `'Assigned to <assignee> — dispatch will
notify them with the full task. Do NOT send them a separate message about
this task; that starts a duplicate worker.'` (joins the existing `notices`).

**T5.3** Tests in `tests/plugins/tasks/` (reuse integration/exec patterns +
ledger mock): liveRun present while running, null when settled; create-notice
present with assignee, absent without.

**Verify:** affected tasks test files → commit.

### C6 — `feat(core): humanized suppressed/ignored feed events`

**T6.1** `src/lib/map-audit-message.ts`: cases —
`task.completion_suppressed` → `Ignored a duplicate completion — ${data.firstAgent} already completed this task via ${data.firstChannel}.`
`task.dispatch_failure_ignored` → `Session error arrived after "${data.title}" was already ${data.column} — no action needed.`
**T6.2** `src/core/task-service.ts:163`: add `title` to the emit data (read
from the task snapshot already in scope).
**T6.3** Test: extend/create the mapper test (`tests/` location matching
existing lib tests) asserting both strings.

**Verify:** mapper test + `bun test tests/core/task-service.test.ts --isolate` → commit.

### C7 — `docs(agents): teach referenceImages + attachment-import`

**T7.1** `src/core/agent-rules/managed-blocks.ts`:
- media-delegation: referenceImages on generate/edit — assetIds, local paths,
  or `media://` URIs; max 4; native runtime only; *"brief says 'like this
  image' → pass the image as referenceImages, don't transcribe it into prose."*
- Tool Reference: `referenceImages='["<assetId|path|media://uri>"]'` example
  line on the images_generate command.
- hard-rules/dispatch guidance: creating a task dispatches it — never also
  message the assignee about it; channel-message tasks with attachments →
  `bakin_exec_images_import taskId=… filePath=…` and reference the assetId in
  the description.
**T7.2** `skill/SKILL.md`: same teachings, brief.
**T7.3** `plugins/images/defaults/workflow-skills/generate-image.md`:
reference mechanics section.
**T7.4** If managed-blocks content is asserted by tests
(`grep -rn managed-blocks tests/`), update them.

**Verify:** grep all three surfaces for `referenceImages`; full suite
`bun run test`; push; update PR #480 title/description for the new scope.

### COMPANION — bakin-bits-official PR

**T8.1** `agents/pixel/workspace/AGENTS.md`: style-guide policy (series/brand
only, dedupe same surface+cues, cap ~10/surface prune-oldest) +
referenceImages in Generate-vs-Edit policy (imitate → reference on generate;
revise → edit).
**T8.2** `agents/pixel/workflow-skills/generate-image.md`: mirror T7.3.
**Verify:** `cd ../bakin-bits-official && bun test` (package-contract), new
branch + PR there.

---

## Verification cadence

- Per checkpoint: the listed focused test files (`--isolate`) + the commit.
- Before C7's commit (last code already in): `bun run test` full suite +
  `bunx tsc --noEmit` + `bun scripts/build-plugins.ts`.
- Each commit message: conventional, scoped, body references the live-test
  incident (task d1b213a5) where it motivated the change.

## Risks / watch-list

1. **C4 false positives:** an 8-hex token that coincidentally matches a live
   task of the target agent blocks an unrelated message. Accepted: collision
   requires both the token match *and* a live run for that exact agent; the
   error tells the sender exactly how to proceed.
2. **C3 type ripple:** `resolveMediaUri` is optional, so adapter mocks and
   Imitation Crab need no change — `tsc --noEmit` is the guard.
3. **C2 gate widening** changes an error string the #480 tests assert —
   update `tools.test.ts:451`-area assertions in the same commit.
4. **C5 ledger reads in tests:** any test touching `getLiveRun` needs the
   `db` key in `getBakinPaths` mocks or the in-memory ledger fake.
5. **C7 managed-blocks drift:** doctor re-projects managed sections; content
   edits are mechanically safe but `bakin check agent-assets` consumers in
   tests may pin strings — T7.4 covers.
