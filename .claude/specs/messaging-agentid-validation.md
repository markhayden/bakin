# Messaging `agentId` Validation + Persona-Load Consolidation

Tracks GitHub issue: **#122 — security(messaging): validate agentId before persona file path join**.

## Problem

Two code paths read an agent persona markdown file using a user-supplied `agentId` concatenated into a filesystem path with zero validation:

1. `plugins/messaging/index.ts` — `/brainstorm` POST handler (currently ~line 436):
   ```ts
   const personaPath = join(CONTENT_DIR, 'team', 'personas', `${body.agentId}.md`)
   ```
2. `plugins/messaging/lib/prompt-builder.ts:30` — private `loadPersona(agentId, contentDir)`:
   ```ts
   const personaPath = join(dir, 'team', 'personas', `${agentId}.md`)
   ```

A client body of `{ "agentId": "../../../etc/passwd" }` walks outside `~/.bakin/team/personas/`. Bakin is single-user Tailscale-only today, so impact is bounded — but this is a traversal primitive that becomes an exploit the moment the auth boundary changes (marketplace plugins, multi-user, exposed gateway).

A secondary smell: the `/brainstorm` handler **duplicates the persona-load logic** inline instead of reusing `prompt-builder.ts`. Both paths therefore have to be patched independently, and any future third caller would silently inherit the traversal primitive.

## Scope

**In scope:**

- Remove the path-traversal primitive at both call sites.
- Consolidate persona loading so there is exactly one loader, in one place, gated by validated agent ids.
- Make the fix cover any future caller of `buildSystemPrompt`/`buildMessages` automatically — no rediscovery required.

**Out of scope:**

- Rewriting the `/brainstorm` prompt string (it's legitimately different from `buildSystemPrompt` — leave it alone).
- Hardening other agent-id consumers (avatars, workspace reads, etc.) — separate issue if discovered.
- Input validation for other messaging fields (`message`, `history`) — orthogonal.

## Design

### Architectural decision: persona becomes a caller-provided string

Today's `prompt-builder.ts` advertises itself as pure and testable:

> "Agent identity and the content-type taxonomy are resolved by the caller (who has plugin context + user settings) and passed in via options, so this module stays neutral and testable."

…but then violates this by calling `readFileSync(personaPath)` on its own. Promoting `persona` to a caller-passed option aligns the module with its own docstring, makes it pure, removes the FS dependency from its unit tests, and — critically — means **only callers that have `PluginContext` (and therefore access to `team.getAgentIds`) can provide a persona**. The validation gate is inherent to the architecture.

### New shape of `PromptBuilderOptions`

```ts
export interface PromptBuilderOptions {
  agentName?: string
  contentTypes: ContentTypeOption[]
  /** Pre-loaded agent persona markdown, or empty string. Caller is responsible
   *  for validating the agentId against the live roster before loading. */
  persona: string
}
```

No more `contentDir` option — it only existed to support the FS read, which now happens outside the module.

### New shape of `resolvePromptOptions(ctx, agentId)`

Single consolidated helper in `plugins/messaging/index.ts`. Returns the fully-resolved options bundle:

```ts
async function resolvePromptOptions(
  ctx: PluginContext,
  agentId: string,
): Promise<{ agentName: string | undefined; contentTypes: ContentTypeOption[]; persona: string }>
```

Internal flow:

1. **Shape guard (defense in depth).** `/^[a-z0-9-]+$/` on `agentId`. If it fails, `persona = ''` and we skip the roster hook. The shape guard is the hard path-traversal block — it holds even when the team plugin is disabled or the hook throws.
2. **Roster check.** `const knownIds = await ctx.hooks.invoke<string[]>('team.getAgentIds', {})`. If `knownIds` is returned and does not include `agentId`, `persona = ''`. Handles the orphan-reference case.
3. **Load persona.** Only when both gates pass: `readFileSync(join(personasDir, agentId + '.md'))`. If the file doesn't exist, `persona = ''`. If the read throws, log and return `persona = ''`.
4. **Resolve agent display name** (existing behavior via `team.getAgent` hook).
5. **Resolve content types** (existing behavior via `ctx.getSettings`).

### Route-level validation: `/brainstorm` returns 400 on invalid agentId

Per the issue's preferred path and the kickoff instruction "no backwards compatibility / shims":

- `/brainstorm` (and any other messaging route that takes an `agentId` from the client body) calls a thin `validateAgentId(ctx, agentId)` helper **before** doing any work. The helper runs the shape guard + roster check and returns the verdict.
- Invalid → respond `400 { error: 'invalid agentId' }`. No persona-load fallback — the request is rejected.
- Valid → proceed, reusing `resolvePromptOptions` for the persona/name/types.

The one-off inline persona read in `/brainstorm` is deleted. The whole handler uses `resolvePromptOptions` just like the other two callers (`buildMessages` sites at index.ts:633 and 1194), which — by consequence of the redesign — also become gated.

### What happens when the `team` plugin is disabled (hook unregistered)?

`HookRegistry.invoke()` returns `undefined` when no handler is registered. The helper treats `undefined` as "roster unavailable" and falls back to the shape-guard verdict alone (shape-valid → proceed, shape-invalid → reject). This keeps messaging functional in the degenerate case while still blocking path traversal. Rationale: the shape guard is the security boundary; the roster check is a "prevent orphan reads" niceness.

## Acceptance criteria

- [ ] No call site in `plugins/messaging/` constructs a persona file path from an un-validated agentId.
- [ ] `prompt-builder.ts` contains zero FS reads; `loadPersona` deleted.
- [ ] `PromptBuilderOptions.persona: string` is required (not optional).
- [ ] `resolvePromptOptions` in `plugins/messaging/index.ts` does shape-guard + roster-check before any FS read, and returns `persona` as part of the bundle.
- [ ] `/brainstorm` POST route:
  - Returns `400 { error: 'invalid agentId' }` for `agentId: "../evil"` or any `agentId` failing the shape guard, without touching the filesystem.
  - Returns `400` for a shape-valid-but-unknown agentId when the roster hook returns a populated list that doesn't include it.
  - Happy path for a live agent still returns a real prompt with the persona loaded.
- [ ] No regression in the two `buildMessages` call sites (sessions `:id/messages` POST and the `bakin_exec_messaging_session_send` exec tool) — happy-path behavior unchanged for live agents; orphan/invalid ids now render an empty persona (previously they'd silently read arbitrary filesystem paths if the path format matched).
- [ ] Tests:
  - New: `tests/plugins/messaging/agentid-validation.test.ts` — exercises `/brainstorm` with `../evil`, with a shape-valid-but-unknown id, and with a live roster id; asserts 400 / 400 / 200 respectively and verifies no read outside personas dir via an fs-read spy.
  - Existing `tests/plugins/messaging/prompt-builder.test.ts` — updated to pass `persona` via options (no more implicit FS reads). All existing assertions continue to hold.
  - Existing `tests/plugins/messaging/orphan-refs.test.tsx` — same update if it's affected.
- [ ] `bun test --isolate` green.
- [ ] No new `any` leaks, no new side-effects in `prompt-builder.ts`.

## Non-goals

- **Backwards compatibility.** Per kickoff: single-user machine, tech-debt reduction. The `PromptBuilderOptions.persona` field becomes required (no optional fallback). Callers must adapt.
- **Error messages beyond `invalid agentId`**. Not leaking "which of shape-guard or roster-check failed" to the client is a minor defense-in-depth nicety; we'll audit internally via `log.warn`.
- **Caching the roster.** `team.getAgentIds()` is a fast synchronous read from `~/.openclaw/` (already cached by the adapter). Per-request invocation is fine.

## Knowledge-base updates

- `.claude/knowledge/messaging-plugin.md` — add a "Security" subsection under "Planning Sessions (Brainstorm)" noting that all routes accepting an `agentId` body field validate against the live roster via `team.getAgentIds` + shape guard before any persona read. One paragraph.
- `.claude/knowledge/team-plugin.md` — no change (the hook contract is unchanged; we're just adding a new consumer).
- `CLAUDE.md` — no change (existing "Plugin Communication" section already describes `team.getAgentIds`).
- `README.md` — no change (user-facing behavior is identical on the happy path).

## Commit strategy

Four natural checkpoints, each landing a coherent unit that can stand alone and be rolled back independently:

1. **`refactor(messaging): promote persona to a caller-supplied option`**
   - `prompt-builder.ts`: delete `loadPersona`, change `PromptBuilderOptions` to require `persona: string`, remove `contentDir` option.
   - Update all three callers in `plugins/messaging/index.ts` to pass `persona: ''` (stub — the validation + real load arrives in commit 2).
   - Update `tests/plugins/messaging/prompt-builder.test.ts` and `orphan-refs.test.tsx` to supply `persona` through options.
   - Suite green at this point. `/brainstorm` still inlines its own (unvalidated) persona read temporarily.

2. **`security(messaging): validate agentId against roster + shape guard`**
   - Add `validateAgentId(ctx, agentId): Promise<boolean>` helper in `plugins/messaging/index.ts`.
   - Extend `resolvePromptOptions` to return `persona` (runs the guard, invokes `team.getAgentIds`, loads the file only when both pass).
   - Replace the `/brainstorm` inline persona-load block with `resolvePromptOptions` + a 400-return on `!await validateAgentId(...)`.
   - The `/messages` SSE POST and the `_send` exec tool automatically inherit the gate via `resolvePromptOptions`.

3. **`test(messaging): add agentId traversal + orphan regression suite`**
   - `tests/plugins/messaging/agentid-validation.test.ts` — three cases: shape-invalid (`../evil`), shape-valid-but-unknown, live-agent happy path. Uses an fs-read spy to assert no read outside the personas dir.

4. **`docs(messaging): note agentId validation in plugin knowledge`**
   - `.claude/knowledge/messaging-plugin.md` security subsection.

If anything blows up mid-stack, reverting the last commit restores a functional state; reverting commits 2-4 restores the pre-fix (still vulnerable) baseline, which is acceptable as a rollback because that's exactly where we are today.

All four commits go in one PR, one at a time, to give reviewers (and rollback) clean boundaries.

## Verification plan

- `bun test --isolate tests/plugins/messaging/` — all green, new suite passes.
- Manual: `curl -XPOST http://localhost:3737/api/plugins/messaging/brainstorm -d '{"agentId":"../evil","message":"hi"}'` → `400`.
- Manual: same with a real agent id → happy response.
- Grep for residual traversal primitives: `grep -rn "personas.*agentId\|team/personas/\`" plugins/` → zero hits outside `resolvePromptOptions`.

## Risks

- **Breaking existing prompt-builder unit tests.** The shape change makes `persona` a required option. Mitigation: commit 1 updates every test in the same atomic change.
- **Team plugin disabled in some scenario I haven't seen.** The shape guard is the load-bearing security check; the roster check is a bonus. We stay functional under that degraded mode, with a log warning.
- **Perf — one extra hook invocation per prompt build.** The invocation is in-process and backed by a cached sync read. Negligible.
