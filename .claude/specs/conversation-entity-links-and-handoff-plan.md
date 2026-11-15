# Implementation Plan: Conversation entity links and hand-off

Spec: `.claude/specs/conversation-entity-links-and-handoff.md` (approved).
Status: APPROVED 2026-11-14 (rev 2 — revised after an independent Codex review, 14 findings,
all addressed; see "Review changes"). The A2 own-or-dependency reporting rule is approved.
Location note: plan and task list live in this one file, following the repo's
`<name>-plan.md` convention (`tasks/` holds evidence files here).

## Overview

Agents' tool calls report what they created or changed. The host turns each report into a
card on the tool's row in the conversation, resolved through one manifest-declared entity
registry that also replaces every hand-built entity link in both repos. When a chat turn
creates something that owns a conversation (a project, a Messaging brainstorm session), chat
carries its transcript into that conversation and redirects the user.

## Architecture Decisions

### A1. Correlation: a host-minted receipt in a fixed outer envelope

Tool handlers never learn the runtime's tool-call id or calling thread, and the turn engine
never sees a handler's structured result. We generalise the mechanism `bakin_exec_ask_user`
already uses on both runtimes.

- Both invoke paths (`src/core/exec-tools/provider.ts`, `src/core/mcp-server.ts`) share one
  post-handler step. When a successful result carries `entities` or a `question`, the host
  stores a **receipt** `{ id, agentId, toolName, entities?, question? }` in an in-memory
  registry (TTL + capacity bound) and serialises a **fixed host-controlled envelope**:
  `{"receipt":"bakin-receipt:<id>","result":{…}}`.
  - Not "receipt as first key of the result": result objects allow arbitrary keys, and
    integer-like keys serialise ahead of it, which loses the token to preview truncation on
    both runtimes.
  - `unwrapToolResult` / `summarizeStructured` peel the envelope so summaries are unchanged.
- **Provenance check before consumption.** Enrichment takes a receipt only when the result
  chunk's tool name and the turn's agent match the receipt's. A different tool that merely
  quotes a live token cannot consume it. The existing regression test for this stays.
- Pi gains a redacted, clipped `outputPreview` on result chunks (parity with OpenClaw; the
  tool drawer's Output pane stops being empty on Pi). Its one-field `summary` cannot carry
  the token.
- `ask_user` moves onto the same path; `questionRegistry`, `enrichQuestionChunk` and the
  tool-name constant are deleted.
- Receipts from dispatch runs (which bypass the turn engine) expire by TTL.

### A2. Entity identity, declaration and who may report

- Manifest `contributes.entities[]`:
  `{ kind, label, icon (Lucide name), href, handoff? }`. Public identity is
  `<pluginId>:<kind>` (`tasks:task`, `projects:project`).
- **href templates use named placeholders**, each segment-encoded: `/projects/{id}`,
  `/tasks?taskId={id}`, `/brands/{brandId}/docs/{kind}/{name}`. `EntityRef` carries `id`
  (canonical identity, always available as `{id}`) plus optional `params` for compound
  routes.
- **Reporting rule (approved; the spec's D8 wording is updated to match):** a tool may
  report its own plugin's kinds, **or kinds owned by a plugin its manifest declares as a
  dependency**. Images creates assets and Workflows updates tasks; a strict "own kinds only"
  rule makes those impossible, and duplicating declarations would break canonical identity
  and dedupe. Refs always use the owner's canonical id (`assets:asset`).
- **`reports` is declarative, in the manifest's tool entries**
  (`contributes.tools[].reports: ['projects:project']`), so the release guard can check it
  without executing code. Activation asserts every registered tool's reported kinds match
  the manifest and resolve to a loaded declaration, for core and user plugins alike.
- Runtime: refs outside the tool's declared `reports` are dropped, logged and audited
  (`exec.entities.rejected`) — never rendered.

### A3. Registry lifecycle

- Server registry is populated from the **freshly parsed** manifest, published only after a
  successful activation, and swept (declarations **and** hand-off acceptors) on failure,
  disable, removal and reload. Linked-plugin reload today reuses the cached manifest; the
  reload pipeline is changed to re-read and re-validate it.
- Browser registry is seeded and replaced (including removals) where the host applies
  manifest metadata (`PluginHost`), fed by `/api/plugins/manifest`.

### A4. Rendering

- `foldConversation` derives `TurnItem { type: 'entities'; refs }` from
  `metadata.bakinEntities`, placed at the tool call's position, outside the collapsed
  activity group. Dedupe per identity per turn; `created` beats `updated`. An asset ref
  whose id is embedded as an inline image in the same turn is suppressed.
- Layering: the visual `EntityCard` lives in `packages/ui` and takes resolved
  `{ label, icon, href, title, action }`. The SDK conversation wrapper binds the browser
  registry and `PluginLink`. `packages/ui` gains no registry or router dependency.
- An unknown kind (plugin since removed) renders a non-link card.

### A5. Hand-off

- **Settlement snapshot (engine change).** `onSettled` today receives no turn identity and
  runs after the slot releases and queued sends drain, so re-reading the transcript can
  include a later message. The engine captures, before release, an immutable
  `{ turnId, entities, boundary }` and passes it to `onSettled`. Chat cuts its transcript at
  the boundary.
- **Row kind**, shared by both ends:
  `{ kind: 'handoff', ts, handoffId, direction: 'out' | 'in', peers: [{ entity, id, title }] }`.
- **Acceptor contract.** `ctx.conversations.acceptHandoff(kind, handler)`. The handler must:
  - throw when the target does not exist;
  - write the carried rows plus the `in` row as **one atomic batch** (new optional
    `appendRows` batch writer on the turn-service config, used by `appendExternal`);
  - resolve only after the batch is durable (`written`), including when the target is busy;
  - be idempotent on `handoffId` (`<chatId>:<turnId>:<entityId>`): a repeat is a no-op.
- **Trigger.** Chat, in `onSettled`, calls the core hand-off entry once per created
  hand-off ref in the snapshot, then appends one `out` row and emits
  `chat.handoff { chatId, created, targets }`. Error and aborted turns still hand off what
  was created.
- **Redirect.** The chat page navigates on the live event only when the reply **created**
  exactly one hand-off target (`created === 1`), that target succeeded, and the chat is the
  current route. Two created with one failed does not redirect. Loading a chat never
  redirects.
- **Priming (derived, per receiving agent).** A pure core helper returns a byte-budgeted
  preamble of the carried rows when, after the `in` row, there is **no assistant row from
  the agent about to be sent to**. A turn that failed before reaching the runtime
  therefore still primes on retry, and switching agents in a project primes the new agent's
  thread. Target plugins prepend it to `runtimeContent`.
- **Failure.** A failed acceptor leaves ordinary cards in the chat, gets no `out` peer, and
  is audited (`chat.handoff.failed`).

### A6. Link migration

`entityHref(kind, id, params?)` and `EntityLink` live in `@makinbakin/sdk/navigation`; a
core twin serves server-side callers. Every entity-link producer in **both repos** moves to
it. Each repo gets an architecture test banning literal entity hrefs outside manifests.

### A7. UI patterns selected (bakin-ui-conformance)

| Surface | Closest public story | Composition |
|---|---|---|
| Entity card in a turn | `storybook/public/primitives/card.stories.tsx` — `InteractiveCard`, `RowMedia`; placement precedent `conversation/turns.stories.tsx` — `QuestionCards` | `Card` (interactive, row media = icon) with kind + action label and title; sits in the turn like a question card. |
| "Continued in …" (`out`) | same as above | The same `EntityCard` with a "Continued in" label. |
| "Carried over from chat" (`in`) | `storybook/public/primitives/separator.stories.tsx` | `Separator` with a caption line containing an `EntityLink`. |

- Not `feedback/handoff-card` — that is the operator-command hand-off, a different thing.
- States to cover in stories: long title (truncation, no widows), narrow width, several
  cards in one turn, unknown kind (non-link), `created` vs `updated`.
- `EntityCard` is a new export on the existing `@makinbakin/sdk/conversation` entrypoint: a
  reusable system extension with its own `CanonicalUsage` story. No new entrypoint, token
  or archetype. **Deviation: none expected.** If the labelled separator needs anything the
  primitive lacks, I stop and bring you the seven-point explanation before building.

## Dependency Graph

```
T1 receipt + envelope ─ T2 enrichment, ask_user, Pi preview
                              └────────────────────────────┐
T3 manifest schema + registry lifecycle                    │
 ├─ T4 core plugin declarations + browser hydration        │
 │    └─ T5 sdk navigation helpers ─┬─ T7 EntityCard ──────┤
 │                                  └─ T9–T11 link migration
 └─ T6 EntityRef + reports validation ─ T8a–c tools report ┘
T12 settlement snapshot ─┐
T13 handoff row + batch append + acceptor API ─ T15 chat trigger ─ T16 redirect
T14 handoff rendering ───┘                    └─ T17 preamble helper
Bits: T18 SDK ref + stubs → T19–T21 Projects → T22–T25 Messaging → T26 Bits links
T27 release guard ← T3, T6      T28 pin bump + e2e ← Bits      T29 docs reconciliation
```

## Task List

### Phase 0 — Preflight (no commits)

- [x] **T0: Confirm what would change the plan.** Answers (2026-11-14):
  - (a) **No.** The contract family is `EXTERNALS_CONTRACT`
    (`src/core/whiskit/externals.ts:102`) — the import-map externals, not the manifest
    schema. The guard's every-release manifest check
    (`scripts/check-plugin-contract.ts:116`) passes published Bits manifests as long as the
    new fields are optional, which they are.
  - (b) OpenClaw previews `data.result` with `previewUnknown`
    (`packages/adapter-openclaw/src/stream-events.ts:198`,
    `activity-summary.ts:158`): strings as-is, anything else `JSON.stringify`-ed, then
    redacted and middle-truncated at 500. The envelope's token sits within the first ~90
    characters even inside an escaped MCP `content[].text` wrapper. The redactor
    (`packages/core/src/redact.ts:13`) only touches keys containing token/password/secret/
    api-key, so the envelope key is `receipt`, never `token`. The real gateway's frame is
    confirmed at Checkpoint A.
  - (c) **Yes.** Core manifests declare `dependencies` (Images → assets, models; Workflows →
    tasks; Schedule → tasks).
  - Naming correction: manifest tool entries are `contributes.execTools[]`, not
    `contributes.tools[]`.
  - (a) Whether adding `contributes.entities` / tool `reports` counts as a contract-family
    change for `scripts/check-plugin-contract.ts`. **If yes: stop and ask.**
  - (b) The exact `data.result` shape OpenClaw previews for an MCP text result, and that the
    envelope's token sits inside the retained head (323 leading characters when clipped).
  - (c) Whether core plugins already declare `dependencies` the way user plugins do (needed
    for the A2 reporting rule).
  - Already settled by review: older hosts silently discard unknown `contributes` keys, so
    Bits must raise `bakinRange` regardless; Bits unit tests use a local `test-sdk` stub and
    CI builds the real SDK from `BAKIN_SDK_REF`.

### Phase 1 — Correlation (highest risk first) → PR 1

- [x] **T1: Receipt registry and envelope on both invoke paths.**
  - Acceptance: one shared post-handler function; envelope shape fixed; a plugin-supplied
    `receipt` key cannot override it; results without entities/question are unchanged;
    `unwrapToolResult`/`summarizeStructured` peel the envelope.
  - Verify: unit tests incl. integer-like keys, a 600-character leading value, large
    payloads, escaped MCP wrapper. Size: M.
- [x] **T2: Provenance-checked enrichment; migrate `ask_user`; Pi `outputPreview`.**
  - Acceptance: receipt consumed only on matching tool + agent; `bakinQuestion` behaviour
    unchanged for consumers; old question plumbing deleted.
  - Verify: live-token-quotation regression test kept; runtime-conformance check (with a
    teeth file) that a receipt reaches the emitted chunk and the persisted row on the dev
    mock, Pi and the OpenClaw mock; two concurrent turns for one agent each get their own.
    Size: M.

**Checkpoint A (2026-11-14, partial)** — suite, lint, typecheck green; envelope confirmed
over MCP on an isolated server. The real-model leg is OPEN: the isolated rigs could not run
a turn (Pi login expired, OpenClaw rig has no provider key). PR 1 (#1089) is held until it
passes. Original criterion: `bun run test`, `lint`, `typecheck` green. On the isolated rig
(`--mode isolated`, each runtime) a chat question still renders its card. If the token does
not survive a real runtime, stop and revisit A1.

### Phase 2 — Declaration, registry, navigation → PR 2

- [x] **T3: Manifest schema and registry lifecycle.** Zod schema (kind slug, label, icon,
  href with named placeholders starting `/`, `handoff`, tool `reports`); duplicate kinds
  rejected; reload pipeline re-reads the manifest; publish after activation; sweep on
  failure/disable/removal/reload; `plugin-sync-manifest` capture keeps the new fields.
  - Verify: schema tests; **changed-manifest reload test** (add, change, remove a kind);
    failed-activation leaves no declarations. Size: L → two commits (schema, lifecycle).
- [x] **T4: Core plugin declarations and browser hydration.** task, asset, schedule job,
  workflow, brand, brand doc, chat, agent declared in their manifests; `PluginHost` seeds
  and replaces the browser registry. Size: M.
- [x] **T5: `entityHref`** in `@makinbakin/sdk/navigation` plus the core twin. (`EntityLink`
  moved to T14: a public kit component needs a public story and visual baseline, and its
  first use is the "Carried over" divider there.) Verify: segment escaping, query links, compound params, unknown kind. Size: S.
- [x] **T6: `EntityRef`, `ExecToolResult.entities`, `reports` validation.** Own-or-dependency
  rule; activation assertion for core and user plugins; runtime drop + audit; the
  `@makinbakin/sdk/testing` harness enforces the same so external authors fail in their own
  tests. Size: M.

**Checkpoint B** — suite green; `design-system/public-api.json` updated deliberately;
`bun run ui:conformance --quick`.

### Phase 3 — Cards → PR 3

- [x] **T7: Fold `entities` items; `EntityCard`; host resolver provider.** Stories per A7.
  - As built: instead of an SDK wrapper around each conversation component, `packages/ui`
    reads an `EntityKindResolverContext` and the host mounts one provider in `PluginHost`
    (registry + sidebar icon map + `PluginLink`). Every surface gets linked cards with no
    wiring. `EntityLink` moves to T14, its first consumer (the "Carried over" divider).
  - Verify: fold unit tests; RTL (with `rtl-settle`); `bun run ui:test:stories`;
    story interaction + visual evidence. Size: M.
- [x] **T8a: Tasks and Schedule report.** Size: S.
- [x] **T8b: Assets and Images report** (Images reports `assets:asset` via dependency).
  Size: S.
- [x] **T8c: Workflows, Brands, Team report** (Workflows reports `tasks:task`). Size: M.
- [x] **T8d: Prose links navigate in-app** — `renderInternalLink` on every conversation
  surface's `MarkdownContent`. Size: S.
- Knowledge docs for cards (`conversation-kit.md`, new `entity-links.md`) land in this PR.

**Checkpoint C** — `bun run ui:conformance --full`. In an isolated home (`/verify`), a chat
that creates a task, an asset and a scheduled job shows three working cards. Criteria 1, 2,
10.

### Phase 4 — Link migration (bakin) → PR 4

- [x] **T9: Browser-side links** — Home activity, health incident row, brands, approvals
  attention. One commit per area. Size: M.
- [x] **T10: Search hit renderers** resolve through the registry. Size: S.
- [x] **T11: Server-side links and the architecture test** — scheduled events, health
  checks, `HealthResource` kinds; `tests/architecture/no-literal-entity-href.test.ts` plus
  the mirrored ESLint rule. Verify: test fails when a literal is reintroduced. Size: M.
- `url-state-deep-linking.md` updated here (incl. removing `/projects/[id]/edit`).

**Checkpoint D** — suite green. Criterion 9 for `bakin`.

### Phase 5 — Hand-off (core + chat) → PR 5

- [ ] **T12: Settlement snapshot in the turn engine.** Verify: queued follow-up does not
  leak into the snapshot; overlapping settle tails; success, error and abort. Size: M.
- [ ] **T13: `handoff` row type, atomic batch append, acceptor API.** SDK types; chat store
  schema; `appendRows` batch writer honoured by `appendExternal`; acceptor registration
  validated against a `handoff: true` declaration; harness support.
  - Verify: busy target resolves only after `written`; mid-batch failure writes nothing;
    missing target throws; repeat `handoffId` is a no-op; undeclared kind rejected.
    Size: L → two commits (types + batch append, acceptor API).
- [ ] **T14: Hand-off rendering.** Fold item; `out` card and `in` divider stories per A7.
  Size: M.
- [ ] **T15: Chat trigger.** Attachments reduced to a note. Verify: one target; two
  targets; two created with one failed; no hand-off kinds; a second hand-off later in the
  same chat; error and aborted turns. Size: M.
- [ ] **T16: Redirect.** Verify each branch incl. two-created/one-failed (no redirect) and
  load-never-redirects. Size: S.
- [ ] **T17: Carried-history preamble helper**, published via `@makinbakin/sdk/utils`.
  Verify: budget boundary, multi-byte text, primes again after a pre-delivery failure,
  primes a second agent, stops after that agent's first reply. Size: S.
- Knowledge docs for hand-off (`chat-plugin.md`, `plugin-system.md`) land in this PR.

**Checkpoint E** — `ui:conformance --full`; core suite green using a test-only hand-off
plugin on the SDK harness; nothing in core names Projects or Messaging.

### Phase 6 — Bits (`bakin-bits-official`) → PRs 6–8

- [ ] **T18: Raise the SDK ref.** Bump `BAKIN_SDK_REF` to the merged PR 5 commit; update the
  `test-sdk` stub and types; raise `bakinRange` on Projects and Messaging. Size: S.
- [ ] **T19: Projects — declare and report.** `project` (`handoff: true`); `reports` on
  creating/mutating tools. Size: S.
- [ ] **T20: Projects — proper draft on tool create** (brief skeleton). Size: S.
- [ ] **T21: Projects — accept hand-off and prime.** Atomic batch writer; normaliser keeps
  `handoff` and `done` rows; ask route prepends the preamble; divider in the Conversation
  tab. Verify: round trip write → read → render; >300-row chat; a write after hand-off
  keeps carried rows intact. Size: M.
- [ ] **T22: Messaging — lossless row persistence.** Carried rows stored verbatim (no
  fenced-JSON splitting, original timestamps and authorship); the read mapper keeps tool
  `metadata` and `turnId` so cards survive a reload. Verify: round-trip tests per row kind
  incl. `done`. Size: M.
- [ ] **T23: Messaging — declare and report** (`session` with `handoff: true`, `plan`,
  `deliverable`). Size: S.
- [ ] **T24: Messaging — accept hand-off.** Batch writer; `appended` event; missing session
  throws (today's writer silently returns). Size: M.
- [ ] **T25: Messaging — prime the first session turn.** Size: S.
- [ ] **T26: Bits link migration and architecture test** — navigation, notifications,
  badge providers and search surfaces in Projects and Messaging. Size: M.
- Each client-bearing plugin: `bun run test:ui`, inspect `test-results/bakin-ui/index.html`.
  Projects and Messaging READMEs updated in their PRs.

**Checkpoint F** — Bits unit suites and CI (real SDK build) green.

### Phase 7 — Guard, integration, reconciliation → PR 9

- [ ] **T27: Release guard.** `check-plugin-contract.ts` validates manifest entities and
  that every tool's `reports` resolves to an own or dependency-owned kind. Bits publishing
  additionally runs an activation check on the harness (catches executable/manifest
  mismatch). Verify: failing fixtures for both. Size: M.
- [ ] **T28: Pin bump and end-to-end.** Bits ref in `design-system/compatibility.json`,
  with the canonical stylesheet update in the same PR. `/verify` in an isolated home, both
  adopters: card, `out` row, populated target transcript, redirect, and the target's agent
  recalling a chat-only fact. Criteria 3–8, 11. Size: S.
- [ ] **T29: Documentation reconciliation.** `CLAUDE.md` (Conversation Kit, URL State, the
  stale description of how Bits brainstorms reach the engine), plugin-author docs under
  `docs/src/content/docs/extending/plugins/`, `README.md` in either repo only if its
  plugin-authoring section is affected, `home.md` if touched. Verify: docs build; no
  reference to deleted names. Size: M.

**Checkpoint G** — all eleven success criteria checked against a running isolated instance;
`ui:conformance --full`.

## Commit and PR Strategy

Conventional commits, no AI attribution, one commit per task unless noted. Full build chain
(css + vendors + plugins + host + perf) before any commit touching UI or the SDK; never
`git add -A` after a local build. Merge each PR when its CI is green, never on red or
pending.

| PR | Repo | Tasks | Revert effect |
|----|------|-------|---------------|
| 1 | bakin | T1–T2 | Back to question-only enrichment. Nothing user-visible either way. |
| 2 | bakin | T3–T6 | Declarations, registry and validation gone. Nothing renders yet. |
| 3 | bakin | T7–T8d | Cards disappear; tools keep working. |
| 4 | bakin | T9–T11 | Hand-built links return. |
| 5 | bakin | T12–T17 | Hand-off gone; cards remain. |
| 6 | bits | T18–T21 | Projects loses cards and hand-off. |
| 7 | bits | T22–T25 | Messaging loses cards and hand-off. |
| 8 | bits | T26 | Bits hand-built links return. |
| 9 | bakin | T27–T29 | Pin returns to the prior Bits ref; guard and docs revert. |

Ordering:
- 1 → 2 → 3 → 5 are sequential. PR 4 needs PR 2 only and can run alongside 3 and 5.
- Bits work starts after PR 5 merges (T18 pins that commit). PR 7 and PR 8 are independent
  of each other and follow PR 6 (which carries the SDK ref bump).
- **The one deliberately red window:** if a Bits PR changes classes, the bakin stylesheet
  gate on Bits is red until PR 9 lands the pin and stylesheet together. That is the standing
  rule for Bits stylesheet changes and the only exception to "green at every checkpoint".
- Rollback is the reverse order; reverting PR 9 first makes every later revert safe.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Receipt token lost on a real runtime (redaction, truncation, wrapper shape) | High | Fixed outer envelope; T0(b); adversarial unit tests; conformance check with teeth; Checkpoint A on both real runtimes first. |
| Classed as a contract-family change, gating Bits publishing | Med | T0(a); ask before proceeding. |
| Partial or duplicated carried history | Med | Atomic batch append; `handoffId` idempotency; resolve only after durable. |
| Agent replies without the carried context | Med | Priming keyed to the receiving agent's first reply, not to a user row. |
| Messaging's writer rewrites carried rows | Med | Lossless path built first (T22), round-trip tested. |
| Hot-reloaded plugin keeps stale declarations | Med | Reload re-reads the manifest; changed-manifest test. |
| Link migration breaks a deep link | Med | Behaviour-preserving, one area per commit; architecture tests in both repos. |
| Token text visible to the agent | Low | Already true for questions; single-use, no secret. |
| Carried rows exceed a target's 300-row cap | Low | Most recent kept; divider says the history was trimmed. |
| Perf ceilings | Low | Record small attributed increases; ask for anything large. |

## Review changes (Codex, rev 1 → rev 2)

1. `onSettled` had no turn identity → settlement snapshot (T12).
2. `appendExternal` can return before rows are durable and writes row by row → atomic batch,
   resolve after `written`, idempotent (T13).
3. "Own kinds only" made Images/Workflows reporting impossible → own-or-dependency rule (A2).
4. Dropping the tool-name guard removed an attribution protection → provenance check (A1).
5. "No later user row" did not prove the runtime had the history → per-agent first-reply
   rule (A5, T17).
6. Messaging's writer and reader are lossy → dedicated lossless task, tasks split (T22–T25).
7. The release guard reads manifests, not tool code → `reports` moved into the manifest (A2,
   T27).
8. Bits builds against its own SDK pin → explicit SDK-ref task and sequencing (T18).
9. "Receipt first" could lose the token → fixed outer envelope (A1, T1).
10. Reload reused the cached manifest → lifecycle spelled out (A3, T3).
11. Redirect miscounted when one of several acceptors failed → `created` count (A5, T16).
12. Cards depended on helpers built later → declarations, hydration and navigation moved
    ahead of cards; UI/SDK layering fixed (A4, T4–T5).
13. `{id}` could not express brand-doc routes; Bits links were unmigrated → named
    placeholders (A2), Bits migration (T26).
14. UI pattern selection was deferred; docs were all at the end → patterns recorded (A7),
    full conformance at checkpoints, docs spread across PRs.

## Open Questions

1. T0(a) may raise a contract-family "ask first".
