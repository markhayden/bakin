# Execution Plan — Messaging `agentId` Validation (#122)

Companion to `.claude/specs/messaging-agentid-validation.md`. Read the spec first for the *what* and *why*; this document is the *how*, with exact files, line numbers, and verification steps per checkpoint.

## Locked Decisions (from spec)

1. Invalid `agentId` → HTTP 400 (fail hard).
2. `persona` becomes a required `PromptBuilderOptions` field; caller supplies it. No backwards-compat.
3. If `team.getAgentIds` is unavailable, the shape-guard alone gates reads (resilient mode).
4. Four commits, one PR, tech-debt focus.

## Critical Files

| # | Path | Role in this change | Rough edit surface |
|---|---|---|---|
| 1 | `plugins/messaging/lib/prompt-builder.ts` | Home of the offending `loadPersona`. Becomes pure. | Delete `loadPersona` (28-37), change `PromptBuilderOptions` (17-23) to require `persona: string` and drop `contentDir`, update `buildSystemPrompt` (75-145) to read `options.persona` instead of `loadPersona(agentId, …)`. |
| 2 | `plugins/messaging/index.ts` | Both call sites + `/brainstorm` route. Owner of validation + resolution helper. | Rework `resolvePromptOptions` (70-91) to return `{ agentName, contentTypes, persona }`. Add `validateAgentId(ctx, agentId)` helper. Rewrite `/brainstorm` POST (415-500-ish) to call `validateAgentId` + `resolvePromptOptions`, delete the inline persona-read (431-439). Update the two existing `resolvePromptOptions` callers (632-633 and 1193-1194) — they already get the new `persona` field for free. |
| 3 | `tests/plugins/messaging/prompt-builder.test.ts` | Unit tests that currently pass `contentDir` and write a real persona file to disk. | Replace `opts()` helper (52-58) to take `persona`, delete the `beforeAll` `mkdirSync`/`writeFileSync` persona setup, simplify `afterAll` cleanup. Test bodies (79-200ish) now assert against the passed-in persona string directly. |
| 4 | `tests/plugins/messaging/orphan-refs.test.tsx` | Calls `buildSystemPrompt` at 90, 101. | Pass `persona: ''` in the options. |
| 5 | `tests/plugins/messaging/agentid-validation.test.ts` | **New.** Exercises `/brainstorm` against the three input buckets. | Full file — ~120 lines. Uses `activatePlugin` + `callRoute` pattern from `tests/plugins/test-helpers.ts`, mocks `team.getAgentIds` via the ctx's HookRegistry. |
| 6 | `.claude/knowledge/messaging-plugin.md` | Knowledge doc. | Add "Security" subsection under "Planning Sessions (Brainstorm)". |

**No changes to:**
- `plugins/team/index.ts` — `team.getAgentIds` hook already exists and is correct.
- `plugins/team/lib/openclaw-adapter.ts` — `getAgentIds()` impl unchanged.
- `packages/core/src/hooks/hook-registry.ts` — no new hook plumbing needed.
- `CLAUDE.md` / `README.md` — user-facing behavior identical on happy path; no user docs to update.

## Dependency Graph (between commits)

```
C1 (refactor persona option) ──┬──▶ C2 (validation + real load) ──▶ C3 (tests)
                               │                                      ▲
                               └──────────────────────────────────────┘

C4 (docs) is independent — can land anywhere; I'll put it last so the knowledge doc
reflects the landed state, not the plan.
```

- **C1 must land before C2** because C2 relies on `PromptBuilderOptions.persona` existing.
- **C1 must leave the suite green** (passes `persona: ''` as a stub at the three call sites so tests continue to run). This gives us a safe checkpoint even if C2 is reverted.
- **C3 depends on C2** — there's nothing to test before validation exists.
- **C4 depends on C2** — docs describe behavior that only exists after C2.

## Commit Plan

### Commit 1 — `refactor(messaging): promote persona to a caller-supplied option`

**Change set:**

- `plugins/messaging/lib/prompt-builder.ts`
  - Delete `loadPersona` (lines 25-37) and the `readFileSync`/`existsSync`/`getContentDir` imports (lines 12-14). The file loses its only FS dependency.
  - Change `PromptBuilderOptions`:
    ```ts
    export interface PromptBuilderOptions {
      agentName?: string
      contentTypes: ContentTypeOption[]
      persona: string   // was: contentDir?: string
    }
    ```
  - In `buildSystemPrompt` (line 75), replace `const persona = loadPersona(agentId, options.contentDir)` with `const persona = options.persona`.

- `plugins/messaging/index.ts`
  - Update `resolvePromptOptions` to return `persona: ''` for now (real load arrives in C2):
    ```ts
    return { agentName, contentTypes, persona: '' }
    ```
  - The two existing callers (lines 632-633, 1193-1194) automatically pick up `persona` because they spread the return value into `options`. No other change needed at this commit.
  - `/brainstorm` (lines 415-500ish) is **untouched** in C1 — it still inlines the unsafe persona read. That's the C2 fix.

- `tests/plugins/messaging/prompt-builder.test.ts`
  - Replace the persona-file setup (`beforeAll` mkdir + writeFileSync) with nothing — we no longer need a test dir just for persona.
  - Update `opts()` helper:
    ```ts
    function opts(overrides: { agentName?: string; contentTypes?: ContentTypeOption[]; persona?: string } = {}) {
      return {
        contentTypes: overrides.contentTypes ?? DEFAULT_TYPES,
        agentName: overrides.agentName,
        persona: overrides.persona ?? '',
      }
    }
    ```
  - Tests that previously asserted persona inclusion by writing a persona file and checking the output now pass `persona: 'Chef is a chef...'` directly and assert the string appears in the prompt. Much cleaner.

- `tests/plugins/messaging/orphan-refs.test.tsx`
  - Add `persona: ''` to the two `buildSystemPrompt` calls (lines 90-91, 101-102).

**Acceptance (C1):**
- `bun test --isolate tests/plugins/messaging/` — all green.
- `grep -n "readFileSync\|existsSync" plugins/messaging/lib/prompt-builder.ts` — zero hits.
- `grep -n "loadPersona" plugins/messaging/` — zero hits.
- `grep -n "contentDir" plugins/messaging/lib/prompt-builder.ts` — zero hits.
- No type errors: `bun tsc --noEmit` clean (or equivalent — project uses Bun; typecheck config may differ; use whatever the existing CI runs).

**Rollback unit:** Single revert returns to pre-refactor; the FS read is back but the bug is the same bug we had before the PR started — acceptable baseline.

**Checkpoint before C2:** Run `bun test --isolate` full suite. Stop and investigate before proceeding if any non-messaging test breaks.

---

### Commit 2 — `security(messaging): validate agentId against roster + shape guard`

**Change set:** only `plugins/messaging/index.ts`.

- Add validation helper at the top of the file (near other helpers, ~line 85):
  ```ts
  const AGENT_ID_SHAPE = /^[a-z0-9-]+$/

  /**
   * Validates an agentId against a strict shape allowlist + live team roster.
   * Shape guard is load-bearing (blocks path traversal); roster check is a
   * nicety that filters orphan refs. When the team plugin is unavailable,
   * the shape guard alone suffices — messaging stays functional.
   */
  async function validateAgentId(ctx: PluginContext, agentId: string): Promise<boolean> {
    if (!agentId || !AGENT_ID_SHAPE.test(agentId)) return false
    try {
      const knownIds = await ctx.hooks.invoke<string[]>('team.getAgentIds', {})
      if (Array.isArray(knownIds) && knownIds.length > 0 && !knownIds.includes(agentId)) {
        return false
      }
    } catch (err) {
      log.warn('team.getAgentIds hook failed during validation; falling back to shape guard', { agentId, err: err instanceof Error ? err.message : String(err) })
    }
    return true
  }
  ```

- Extend `resolvePromptOptions` to load the persona **after** validation succeeds:
  ```ts
  async function resolvePromptOptions(ctx: PluginContext, agentId: string) {
    const valid = await validateAgentId(ctx, agentId)
    let persona = ''
    if (valid) {
      const personaPath = join(getContentDir(), 'team', 'personas', `${agentId}.md`)
      if (existsSync(personaPath)) {
        try {
          persona = readFileSync(personaPath, 'utf-8')
        } catch (err) {
          log.warn('failed to read persona file', { agentId, err: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    let agentName: string | undefined
    try {
      const agent = await ctx.hooks.invoke<AgentMetaLike | null>('team.getAgent', { id: agentId })
      agentName = agent?.name
    } catch (err) {
      log.warn('team.getAgent hook failed; falling back to raw agentId', { agentId, err: err instanceof Error ? err.message : String(err) })
    }

    const settings = ctx.getSettings<MessagingSettings>()
    const contentTypes = settings.contentTypes ?? DEFAULT_CONTENT_TYPES
    return { agentName, contentTypes, persona }
  }
  ```

- Hoist `readFileSync, existsSync` imports to the top of the file (currently at line 40 imports only `existsSync, readdirSync`). Add `readFileSync` to that import.

- Rewrite `/brainstorm` handler (lines 415-500ish):
  - After `if (!body.agentId || !body.message)`, add:
    ```ts
    if (!(await validateAgentId(ctx, body.agentId))) {
      return json({ error: 'invalid agentId' }, 400)
    }
    ```
  - Delete the dynamic-imported `readFileSync`/`existsSync` block (lines 431-439) and the local `personaPath` construction.
  - Replace with:
    ```ts
    const { agentName: resolvedName, contentTypes: brainstormTypes, persona } = await resolvePromptOptions(ctx, body.agentId)
    const agentName = resolvedName || body.agentId
    ```
  - `persona` is now the validated-load result. The rest of the handler that uses `persona` in the prompt template (line ~447 area) continues to work unchanged.

- The two existing `resolvePromptOptions` callers (632-633, 1193-1194) now automatically use the gated persona-load via the same helper. No inline change needed at those sites — gate is inherited.

**Acceptance (C2):**
- `bun test --isolate tests/plugins/messaging/` — all green (no new tests yet, just "don't break existing").
- `grep -n "join(.*'team', 'personas'" plugins/messaging/index.ts` — only one hit, inside `resolvePromptOptions`.
- `grep -n "readFileSync\|existsSync" plugins/messaging/index.ts` — `existsSync` hits are outside `/brainstorm` (sessions dir, migration checks); zero in `/brainstorm`.
- `grep -n "personaPath" plugins/messaging/` — zero hits.

**Rollback unit:** Revert restores C1's state (refactored prompt-builder, but no validation; `/brainstorm` would be broken because its inline persona-read was deleted — so rollback of C2 alone would be broken). **Pair C2 + C3 revert** if rolling back, or re-revert the `/brainstorm` inline block. Simpler: just revert C2 + C3 together, which returns us to the C1 checkpoint.

**Checkpoint before C3:** Manual smoke test.

```bash
# Terminal A
bun run dev

# Terminal B — shape-invalid
curl -sX POST http://localhost:3737/api/plugins/messaging/brainstorm \
  -H 'content-type: application/json' \
  -d '{"agentId":"../evil","message":"hi"}' | jq
# → expect {"error": "invalid agentId"}, HTTP 400

# Terminal B — live agent (substitute a real roster id)
curl -sX POST http://localhost:3737/api/plugins/messaging/brainstorm \
  -H 'content-type: application/json' \
  -d '{"agentId":"<real-agent-id>","message":"plan me one post"}' | head
# → expect a brainstorm response (200)

# Terminal B — shape-valid-but-unknown
curl -sX POST http://localhost:3737/api/plugins/messaging/brainstorm \
  -H 'content-type: application/json' \
  -d '{"agentId":"ghost","message":"hi"}' | jq
# → expect {"error": "invalid agentId"}, HTTP 400
```

If any probe misbehaves, investigate before C3 (C3 locks these probes in as tests — don't codify a bug).

---

### Commit 3 — `test(messaging): add agentId traversal + orphan regression suite`

**Change set:** only `tests/plugins/messaging/agentid-validation.test.ts` (new file).

Test strategy:
- Use `activatePlugin` + `callRoute` from `tests/plugins/test-helpers.ts`.
- Mock `team.getAgentIds` via the ctx's HookRegistry by registering a handler that returns a known roster (e.g., `['chef']`).
- Mock fs temporarily to spy on reads — or simpler, assert via the response status and ensure no persona content leaks through on invalid inputs.

Test cases (each `it(...)`):

1. **shape-invalid (`../evil`)** → 400, `{ error: 'invalid agentId' }`, no fs read attempted for persona.
2. **shape-invalid (empty string)** → 400.
3. **shape-invalid (unicode `agent🚨`)** → 400.
4. **shape-invalid (absolute path `/etc/passwd`)** → 400.
5. **shape-valid-but-unknown (`ghost`)** — roster returns `['chef']`, `ghost` not in it → 400.
6. **happy path (`chef`)** — roster returns `['chef']`, a `personas/chef.md` fixture exists → 200, response body has the expected brainstorm shape (just assert status + one top-level key, don't over-assert).
7. **happy path with no persona file** — roster returns `['chef']`, no persona file → 200 (brainstorm proceeds with empty persona).
8. **roster unavailable (hook throws)** — shape guard alone passes `chef` through → 200.

Mocks required per CLAUDE.md test-isolation rules:
- `src/core/content-dir` AND `packages/core/src/content-dir` → temp dir.
- `src/core/logger` → no-op.
- `src/core/watcher` → no-op.
- Active runtime boundary (`ctx.runtime` or `src/core/runtime-registry`) → runtime messaging returns a canned response so the happy path doesn't try to reach a real provider.
- `src/core/settings` → stub only the settings fields the handler reads.

I'll pattern-match `tests/plugins/messaging/routes.test.ts` for mock scaffolding.

**Acceptance (C3):**
- `bun test --isolate tests/plugins/messaging/agentid-validation.test.ts` — all 8 cases pass.
- `bun test --isolate tests/plugins/messaging/` — full messaging suite green.
- `bun test --isolate` full repo green.
- No test leaks to `~/.bakin/` or `~/.openclaw/` (verify via `ls ~/.bakin/test-*` after running — should find nothing).

**Rollback unit:** Safe to revert alone — just drops the test file.

**Checkpoint before C4:** full `bun test --isolate` run. If anything non-messaging broke, stop.

---

### Commit 4 — `docs(messaging): note agentId validation in plugin knowledge`

**Change set:** only `.claude/knowledge/messaging-plugin.md`.

Add a new subsection under "Planning Sessions (Brainstorm)":

```markdown
### Security: agentId validation

All messaging routes that accept an `agentId` body field (`/brainstorm`, session
`/messages`, and the `bakin_exec_messaging_session_send` exec tool) validate
the id before any filesystem read. Validation is two-stage:

1. **Shape guard** — `/^[a-z0-9-]+$/`. The load-bearing check that blocks
   path traversal. A request whose `agentId` fails the regex returns
   HTTP 400 with `{ error: 'invalid agentId' }`.
2. **Roster check** — `team.getAgentIds` hook. Filters orphan references
   (shape-valid ids that aren't in the current OpenClaw roster). When the
   team plugin is disabled or the hook throws, the shape guard alone
   suffices and messaging stays functional.

The persona-load lives inside `resolvePromptOptions` in `plugins/messaging/index.ts`
and is gated by `validateAgentId`. `prompt-builder.ts` is pure — persona
is a required caller-supplied option, not a side-effect read.
```

**Acceptance (C4):**
- File saves cleanly; markdown renders.
- `grep -n "agentId\|validation" .claude/knowledge/messaging-plugin.md` — new section present.

**Rollback unit:** Safe to revert alone.

---

## PR Strategy

- Single branch `security/messaging-agentid-validation-122`.
- Four commits in order, each with the message from the spec.
- PR title: `security(messaging): validate agentId before persona file path join (#122)`.
- PR body: summary + link to spec + checklist from "Acceptance criteria" in the spec.
- PR closes #122.

## Verification Plan (post-PR, pre-merge)

1. CI green on the branch (repo convention — `bun test --isolate`).
2. Manual probes from the C2 checkpoint rerun against a local `bun run dev`.
3. `gh pr view` — one reviewer (single-user machine so self-review via `/ultrareview` is plausible but not required).
4. After merge: verify no `/brainstorm` 5xx spike in the server log over 24h.

## Open Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Hidden fourth call site that reads `personas/${agentId}` outside messaging | Low | Covered by the grep verification in the spec (`grep -rn "team/personas/" plugins/`). Ran during research — no other hits. |
| Prompt-builder tests depend on persona-file creation in ways not obvious from a skim | Low | Full read of the test file during C1 prep; any unexpected dependency surfaces when suite is run. |
| `/brainstorm` inline prompt string depends on `persona` in a way I haven't fully traced | Low | Line-by-line rewrite in C2 preserves the template; a grep for `persona` in the handler pre- vs post-edit confirms all references are routed through `resolvePromptOptions`. |
| `team.getAgentIds` returns `string[] \| undefined` — my check needs to handle both | Low | Plan's `validateAgentId` explicitly guards `Array.isArray(knownIds) && knownIds.length > 0` before the `.includes` check. |
| Hook invocation timing — is `ctx.hooks.invoke` stable across plugin activation order? | Low | `team` is core and activated before `messaging` per `bakin.config.ts` ordering. Verified by reading plugin-registry topo sort earlier. |

## Exit Criteria

- All four commits landed in `main`.
- Issue #122 closed by PR.
- `.claude/knowledge/messaging-plugin.md` updated.
- No new traversal primitives remaining in `plugins/messaging/`.
