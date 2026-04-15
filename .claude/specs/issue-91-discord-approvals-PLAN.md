# Issue #91 — Build Plan (commit-by-commit)

_Created: 2026-04-14 | Status: DRAFT (awaiting build-phase kickoff)_
_Spec: `.claude/specs/issue-91-discord-approvals.md`_
_Follow-up: #98 (per-gate `notify_format` YAML — out of scope)_

This is the executable build plan. Spec sections are referenced by name (`§ Design`, `§ Data model changes`, etc.) — not repeated.

---

## Commit Summary

| # | Commit | Theme | Depends on | Parallelizable |
|---|---|---|---|---|
| C1 | `feat(workflows): add ApprovalActor type and StepState decision fields` | Data model | — | **Parallel with C6** |
| C2 | `feat(core): extract approver from Discord interaction payloads` | Gateway plumbing | — | **Parallel with C1, C6** |
| C3 | `refactor(workflows): approveGate/rejectGate accept options object (approver, contentDir, rewindTo)` | Runtime signature | C1 | Serial — gates everything downstream |
| C4 | `refactor(workflows): preserve context in editDiscordGateMessage` | Discord edit | C1 | Parallel with C5 planning |
| C5 | `feat(workflows): two-message Discord approval pattern` | Summary message + audit | C2, C3, C4 | Serial |
| C6 | `feat(workflows): thread reply for long gate prior outputs` | Thread overflow | — | **Independent — ship anytime** |
| C7 | `docs(workflows): document approval audit fields and Discord pattern` | Knowledge | C5, C6 | Final |

**7 commits total, matches spec § Commit strategy.** Total estimate: ~4–6 hours focused work, ~400–550 lines added, ~60 changed/removed.

### Dependency graph

```
C1 ─┐
    ├─→ C3 ─→ C5 ─→ C7
C2 ─┘       │
            │
C4 ────────┘
C6 ──────────────→ C7
```

C1, C2, C6 can land in any order. C3 is the serialization point — every later commit assumes the new signature.

---

## Validation of spec ordering

Spec § Commit strategy is **correct in intent but swaps two commits**. The spec lists:

> 1. ApprovalActor types → 2. Discord gateway extraction → 3. Runtime timeline → 4. editDiscordGateMessage rewrite → 5. two-message + audit → 6. thread overflow → 7. docs

My plan preserves that order. The only structural change is **making commit 3 a signature refactor separate from timeline capture** — see R6 below. In practice the spec's commit 3 ("capture gate decision timeline in StepState") already required the signature change; the plan just names it explicitly.

---

## Per-commit detail

### C1 — `feat(workflows): add ApprovalActor type and StepState decision fields`

**Files**
- `plugins/workflows/types.ts` — add `ApprovalActor` interface; add `requestedAt`, `decidedAt`, `approver` to `StepState` (all optional).

**No other files touched.** Pure type addition. Compiles cleanly because every consumer treats the new fields as optional.

**Acceptance**
- `pnpm typecheck` passes.
- `pnpm test` passes (no test changes yet, existing tests remain green because `StepState` additions are optional).
- `rg "ApprovalActor" plugins/workflows/types.ts` returns the interface definition.

**Risks:** None. This is the safest possible commit.

---

### C2 — `feat(core): extract approver from Discord interaction payloads`

**Files**
- `src/core/discord-gateway.ts` — import `ApprovalActor` from `plugins/workflows/types`; extend `GateInteraction` with `approver: ApprovalActor`; extract in both `MESSAGE_COMPONENT` and `MODAL_SUBMIT` handlers from `data.member?.user` (guild) with `data.user` fallback (DM).
- `tests/core/discord-gateway.test.ts` — new tests for approver extraction.

**Cross-boundary import note:** `src/core/` importing from `plugins/workflows/` is unusual. Preferred: **move `ApprovalActor` to `src/lib/plugin-types.ts`** or a shared file, and have both workflows and core import from there. Plan assumes the shared-type location; confirm during C1 implementation.

**Extraction logic**

```ts
function extractApprover(data: Record<string, unknown>): ApprovalActor {
  const user = (data.member as { user?: { id: string; username: string; global_name?: string } } | undefined)?.user
    ?? (data.user as { id: string; username: string; global_name?: string } | undefined)
  if (!user) {
    return { source: 'discord', id: 'unknown', displayName: 'unknown Discord user' }
  }
  return {
    source: 'discord',
    id: user.id,
    displayName: user.global_name || user.username,
  }
}
```

**Acceptance**
- `GateInteraction.approver` is non-optional and always populated after this commit (fallback to `'unknown'` if Discord somehow omits user — should never happen in a guild but defensive).
- Tests cover: (a) `member.user.global_name` preferred over `username`, (b) fallback to `username` when `global_name` absent, (c) fallback to `data.user` when `member` absent, (d) `'unknown'` sentinel when both absent (logs a warning).
- `plugins/workflows/index.ts` ignores the new field for now — deliberate; C5 wires it in.
- `pnpm test tests/core/discord-gateway.test.ts` passes.

**Risks:** Discord payload shape varies between guild/DM/ephemeral contexts. Spec-reviewed: guild MESSAGE_COMPONENT always includes `member.user`, guild MODAL_SUBMIT same. We never post in DMs, so `data.user` fallback is defensive-only.

---

### C3 — `refactor(workflows): approveGate/rejectGate accept options object`

**⚠ Signature landmine not explicit in the spec — flagging for review.**

**Current signatures**

```ts
approveGate(taskId, stepId, contentDir?)          // 3rd param is contentDir
rejectGate(taskId, stepId, reason, rewindTo?, contentDir?)
```

**Spec implies**

```ts
approveGate(taskId, stepId, approver?, contentDir?)  // inserts approver as 3rd
rejectGate(taskId, stepId, reason, approver?, contentDir?, rewindTo?)
```

**Problem.** Inserting `approver` as positional arg 3 breaks every existing caller, including 5 test sites that pass `testDir` as the 3rd arg (`tests/plugins/workflows/runtime.test.ts:389, 425, 433`). The spec said "single-user, no BC shims" which licenses breaking callers — fine. But positional-inserted means 5 test call sites + 3 production call sites need updating, with high risk of silent bugs if someone mistakenly treats the `approver` object as `contentDir`.

**Proposed resolution.** Convert both to an options-object pattern:

```ts
approveGate(taskId: string, stepId: string, opts?: {
  approver?: ApprovalActor
  contentDir?: string
}): { success, errors?, nextStep? }

rejectGate(taskId: string, stepId: string, reason: string, opts?: {
  approver?: ApprovalActor
  rewindTo?: string
  contentDir?: string
}): { success, errors?, rewoundTo? }
```

**Why this is a tech-debt win** (per CLAUDE.md priority):
- No positional-arg confusion between `contentDir` (string) and `approver` (object).
- Future parameters slot in without rippling through callers again.
- Matches the existing Bakin convention of options-objects on public lib functions (see `src/core/audit.ts`, `src/core/search-registry.ts`).
- Callers become self-documenting: `approveGate(taskId, stepId, { approver, contentDir })`.

**Callers updated** (8 sites total)

| File | Line(s) | Change |
|---|---|---|
| `plugins/workflows/index.ts` | 319, 338, 520, 563 | `approveGate(taskId, stepId, { approver })`; same for reject with `rewindTo` for REST |
| `tests/plugins/workflows/runtime.test.ts` | 389, 401, 414, 425, 433, 445, 568, 577 | `{ contentDir: testDir }` in options; add explicit `approver` in decision-flow tests |

**Files**
- `plugins/workflows/lib/runtime.ts` — rewrite both signatures; `approveGate` sets `stepState.decidedAt = now`, `stepState.approver = opts?.approver`; `rejectGate` same plus `stepState.rejectionReason = reason`.
- `plugins/workflows/lib/runtime.ts` — `advanceWorkflow` gate branch (line 757): set `instance.stepStates[nextStep.id].requestedAt = now`.
- `plugins/workflows/index.ts` — update 4 call sites to options-object form.
- `tests/plugins/workflows/runtime.test.ts` — update 8 call sites; add 3 new tests for `requestedAt` / `decidedAt` / `approver` persistence.

**Acceptance**
- New tests: `advanceWorkflow sets requestedAt on gate entry`, `approveGate with approver persists approver and decidedAt`, `rejectGate with approver persists approver and decidedAt`.
- Existing tests still pass after call-site migration.
- No positional-arg ambiguity: attempting to pass a `string` as the 3rd arg now errors at type check.
- `pnpm typecheck && pnpm test` green.

**Risks**
- R6 (signature refactor) — mitigated by options-object pattern.
- Missing a caller: search says 8 sites total (`rg "approveGate\\(|rejectGate\\(" --type ts`); plan is to rerun that grep in the commit and verify all 8 are updated.

---

### C4 — `refactor(workflows): preserve context in editDiscordGateMessage`

**Files**
- `plugins/workflows/lib/notifications.ts` — rewrite `editDiscordGateMessage`. New signature:
  ```ts
  editDiscordGateMessage(
    channelName: string,
    messageId: string,
    decision: 'approved' | 'rejected',
    approver: ApprovalActor,
    decidedAt: string,
    reason?: string,
  ): Promise<void>
  ```
  Behavior: GET the existing message, preserve embed `title` and `fields`, append two new fields (`Decision`, `Decided by`), update `color`, remove `components`. On GET failure, fall back to the current strip-and-replace behavior and log a warning.
- `plugins/workflows/index.ts` — update the 4 `editDiscordGateMessage(...)` call sites (lines 334, 352, 535, 575) to pass the new args. Until C5 lands, the Discord handler (lines 334, 352) passes `approver` from `interaction.approver`; REST handlers (535, 575) pass an ActorActor synthesized from `os.userInfo()` with `source: 'web'`.
- `tests/plugins/workflows/notifications.test.ts` — add/update tests for the new edit shape.

**Acceptance**
- Test: edit preserves existing `fields` from the mocked GET response.
- Test: edit appends `Decision: Approved` and `Decided by: {displayName} ({source})`.
- Test: edit updates `color` to green (5763719) for approve, red (15548997) for reject.
- Test: edit removes `components: []` on success.
- Test: GET failure → fallback to stripped embed + `log.warn` called with the failure reason.
- `pnpm test tests/plugins/workflows/notifications.test.ts` passes.

**Risks**
- R1 (Discord GET permission). The bot needs `VIEW_CHANNEL` + `READ_MESSAGE_HISTORY` on the approvals channel to GET a message. Already implicitly required to edit, but a GET failure triggers fallback — log clearly so a missing permission is diagnosable. Documented in C7.
- R2 (stale read-modify-write). Between GET and PATCH, the message could in theory be edited by another process. For single-user Bakin this is effectively zero-risk; not worth an ETag.

---

### C5 — `feat(workflows): two-message Discord approval pattern`

**Files**
- `plugins/workflows/lib/notifications.ts` — add `sendDiscordGateSummary` per spec § Design. Returns `Promise<void>`. Fire-and-forget from callers; internal errors log but do not throw.
- `plugins/workflows/index.ts` — Discord handler (lines 315–355) and REST handlers (500–580):
  - Pull `approver` (Discord: from `interaction.approver`; REST: construct from `os.userInfo()` with `source: 'web'`).
  - Pass `approver` to `approveGate` / `rejectGate` via options object.
  - Reload instance after approve/reject; read `stepState.{requestedAt, decidedAt, approver}`.
  - Call `editDiscordGateMessage` first, then `sendDiscordGateSummary`.
  - Extend `ctx.activity.audit('gate.approved', source, payload)` with `approver`, `gateLabel`, `requestedAt`, `decidedAt`, `durationMs` (same for `gate.rejected` plus `reason`).
  - **Audit source tag correction:** REST handlers currently pass `'system'` (lines 526, 569). Change to `'web'` per spec. This is a behavioral change in the audit log — flagging for user ack.
- `tests/plugins/workflows/discord-flow.test.ts` — **new file** — end-to-end Discord + REST flow tests with mocked fetch.

**Acceptance**
- Test: Discord approve flow → extracted approver → `approveGate` called with correct options → `editDiscordGateMessage` called with correct args → `sendDiscordGateSummary` called with an embed containing Decision, Decided by, Workflow, Task, Step, Requested (relative timestamp), Decided (relative timestamp), Duration, footer with instance id.
- Test: Discord reject flow → same, plus `Reason` field and red color.
- Test: Web (REST) approve flow with Discord enabled and `discordMessageId` present → summary fires with `source: 'web'` tag and `displayName = os.userInfo().username`.
- Test: Web reject flow → same treatment.
- Test: audit JSONL entry for `gate.approved` contains `approver`, `gateLabel`, `requestedAt`, `decidedAt`, `durationMs`.
- Test: summary failure logs but does not throw (verified by completing a decision with fetch mocked to reject only on the summary call).
- Test isolation: every test mocks `getContentDir`, `logger`, `watcher`, `openclaw-client`, `fetch` per CLAUDE.md. New file uses `tests/plugins/test-helpers.ts` wherever possible.

**Risks**
- R3 (rate limits). Two messages + potential thread post = up to 3 Discord API calls per decision. Discord's per-channel rate limit is ~5 msg/5sec. For single-user Bakin this is well under the limit, but bursty workflows (e.g., a parallel gate that approves 4 gates in quick succession) could theoretically trip it. Mitigation: deferred; add a rate-limit observer only if we actually see 429s.
- R4 (audit source semantics). Flipping `'system'` → `'web'` in the REST handler is a **correctness fix**, not a regression. Memory plugin's audit view reads the raw JSONL, so the change surfaces immediately. Future log readers filtering on `'system'` would miss new REST approvals — but per spec review, the only legitimate `'system'` source is auto-approve / watchdog / auto-timeout, not a human hitting the REST endpoint.
- R5 (instance reload race). Between `approveGate` writing the instance and the handler reloading it to read `stepState.{requestedAt, decidedAt}`, a concurrent writer could in theory clobber. In practice the only writers are `approveGate`/`rejectGate` themselves, which now set these fields atomically. Low risk.

---

### C6 — `feat(workflows): thread reply for long gate prior outputs`

**Files**
- `plugins/workflows/lib/notifications.ts` — add `postThreadReply(channelId, messageId, threadName, content)`. Implementation per spec § Design. Splits content > 2000 chars into sequential posts.
- `plugins/workflows/lib/notifications.ts` — `sendDiscordGateAlert`: if any prior-output field would exceed 1024 chars, keep a truncated preview in the embed + chain a `postThreadReply` off the message id (fire-and-forget, log-on-fail).
- `tests/plugins/workflows/notifications.test.ts` — add tests for thread helper + overflow trigger.

**Independent of C1–C5.** Could ship first if priorities shift.

**Acceptance**
- Test: `postThreadReply` calls `POST /channels/{channelId}/messages/{messageId}/threads` with the given name and `auto_archive_duration: 60`.
- Test: `postThreadReply` splits a 3000-char content into two sequential POSTs to the thread's messages endpoint.
- Test: `sendDiscordGateAlert` triggers `postThreadReply` when prior output exceeds 1024 chars; does not trigger when under the limit.
- Test: `postThreadReply` failure logs but does not throw.

**Risks**
- R7 (thread permission). Bot needs `CREATE_PUBLIC_THREADS` + `SEND_MESSAGES_IN_THREADS`. Missing permission → 403; documented in C7 and failure logs clearly.
- R8 (thread name length). Discord caps thread names at 100 chars. Use `${instance.workflowId} — ${step.label}` truncated to 100 chars. Plan includes this in the helper.

---

### C7 — `docs(workflows): document approval audit fields and Discord pattern`

**Files**
- `.claude/knowledge/workflow-approvals.md` — **new file**. Document:
  - `ApprovalActor` shape + the three source tags and when each applies.
  - `StepState.{requestedAt, decidedAt, approver}` semantics; how to compute duration.
  - The two-message Discord pattern: what the awaiting card looks like, what the summary looks like, when the thread reply fires.
  - Discord bot permissions required: `VIEW_CHANNEL`, `READ_MESSAGE_HISTORY`, `SEND_MESSAGES`, `CREATE_PUBLIC_THREADS`, `SEND_MESSAGES_IN_THREADS`.
  - Audit JSONL entry shape for `gate.approved` / `gate.rejected`.
  - Cross-link to issue #98 as the follow-up for per-gate `notify_format`.
- `README.md` — **not impacted** (confirmed by rereading relevant sections; the root README doesn't currently document gate notifications).
- `CLAUDE.md` — single-line update to the "Key Patterns" section referencing the new knowledge doc if it helps discoverability. Optional; only if reviewer asks.

**Acceptance**
- Knowledge doc exists and covers the five bullets above.
- `rg "#91\|#98" .claude/knowledge/` shows the cross-link.
- Manual read-through confirms no stale references to the old `"Gate Approved" / "Approved"` card shape.

**Risks:** None.

---

## Parallelization plan

If multi-agent or multi-session work is desired:

- **Stream A (data model):** C1 → C3 → C5
- **Stream B (gateway):** C2 → merges into C5
- **Stream C (overflow):** C6 (fully independent)
- **Stream D (docs):** C7 (final, after A+B+C)

All three streams can run simultaneously after C1 lands. A single-operator serial flow is C1 → C2 → C3 → C4 → C5 → C6 → C7 (the spec's order, preserved).

---

## Risks (inventory)

Numbered for cross-reference in commits above.

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | Discord bot lacks `READ_MESSAGE_HISTORY` → GET in editDiscordGateMessage fails | Low (bot has it today) | Low (falls back to strip+replace) | Log clearly; document perms in C7 |
| R2 | Stale read-modify-write on message GET→PATCH | ~Zero (single-user) | Low | Not worth an ETag |
| R3 | Discord rate limits on summary+edit+thread burst | Low (single-user) | Low | Ignore; add observer only if 429s appear |
| R4 | REST audit `'system'` → `'web'` change hides old entries from a filter | Low | Low | Correctness fix; spec already authorizes |
| R5 | Instance reload race after approveGate | ~Zero | Low | Atomic write in runtime |
| R6 | Positional-arg confusion between `contentDir: string` and `approver: object` | High if positional | High (silent bugs) | **Options-object signature** — C3 |
| R7 | Bot lacks thread creation permission | Low | Low (thread post fails, card still works) | Log; document perms in C7 |
| R8 | Thread name exceeds Discord 100-char limit | Medium | Low | Truncate in helper |
| R9 | Test isolation: new tests leak to `~/.bakin/` | Medium if negligent | **Critical** per CLAUDE.md | Every new test MUST mock `getContentDir`, `logger`, `watcher`, `openclaw-client`, `fetch`. New test file uses `tests/plugins/test-helpers.ts`. |
| R10 | Cross-boundary import: `src/core/discord-gateway.ts` importing from `plugins/workflows/types.ts` | Medium (violates layering) | Medium | Move `ApprovalActor` to `src/lib/plugin-types.ts` during C1 |

---

## Spec changes surfaced by this plan

1. **Signature shape.** Spec said `approveGate(taskId, stepId, approver?, contentDir?)`. Plan upgrades to an options-object signature because positional insertion would produce silent bugs at the 5 test call sites that pass `testDir` as arg 3. Tech-debt win per CLAUDE.md priority. **No scope expansion.**

2. **Location of `ApprovalActor`.** Spec put it in `plugins/workflows/types.ts`. Plan moves it to `src/lib/plugin-types.ts` (or equivalent shared location) because `src/core/discord-gateway.ts` needs to import it — `src/core/` importing from `plugins/` would reverse the layering CLAUDE.md enforces.

3. **REST audit source tag.** Spec implicitly requires REST handlers to emit `source: 'web'`. Current code emits `'system'` (`plugins/workflows/index.ts:526, 569`). Plan calls this out as a **behavioral change** to the audit log — flagging so it's not mistaken for a regression when the memory plugin's audit view starts showing `web` alongside `discord`.

4. **Commit 3 explicit rename.** Spec's commit 3 was "capture gate decision timeline in StepState" but actually needed the signature refactor too. Plan splits the naming to "`refactor(workflows): approveGate/rejectGate accept options object`" with timeline capture inside. Still 7 commits, ordering preserved.

No other scope expansion. Follow-up #98 stays out.

---

## Manual one-time ops on this machine

Per user direction: no migration code — single user, single system. Audit against the single install after C5 ships and run any cleanup by hand.

| Item | Required? | Action |
|---|---|---|
| Existing `~/.bakin/workflows/instances/*.json` missing new `StepState` fields | **No action** | Fields are optional. Instances in `pending_approval` today will get populated on decision. Instances already completed stay as they are — no historical timeline to reconstruct. |
| Existing `~/.bakin/audit.jsonl` entries with `gate.approved` / `gate.rejected` and no `approver` / `gateLabel` / `decidedAt` | **No action** | Old lines stay; new lines carry the new fields. Memory plugin audit view renders blanks for missing fields — acceptable. |
| Existing `~/.bakin/audit.jsonl` entries where `source: 'system'` actually came from REST (human hit /gates/:taskId/approve) | **Optional manual retag** | If you want historical cleanliness, post-C5: `rg '"gate\\.(approved|rejected)".*"source":"system"' ~/.bakin/audit.jsonl` and spot-check against task timestamps. Retag to `'web'` only the ones you remember clicking yourself. Not worth doing unless audit archaeology matters. |
| Discord bot permissions on the approvals channel | **Verify once** | Before C5/C6 smoke: confirm bot has `VIEW_CHANNEL`, `READ_MESSAGE_HISTORY`, `SEND_MESSAGES`, `CREATE_PUBLIC_THREADS`, `SEND_MESSAGES_IN_THREADS`. If any missing → grant in Discord server settings, no code change needed. |
| Stale Discord messages from workflows approved before this change | **No action** | They stay in their current "Gate Approved / Approved" shape. Not worth retro-editing — new decisions look right going forward. |

If any of these shift from "optional" to "needed" during build, add them inline to the commit notes rather than standing up a migration path.

---

## Verification gates between phases

- **After C1:** `pnpm typecheck` passes. No test changes expected.
- **After C2:** `pnpm test tests/core/discord-gateway.test.ts` passes. Existing gateway integration tests still green.
- **After C3:** `pnpm test tests/plugins/workflows/runtime.test.ts` passes (including 3 new tests). All call sites updated — `rg "approveGate\\(|rejectGate\\(" --type ts` shows every call uses the options-object form.
- **After C4:** `pnpm test tests/plugins/workflows/notifications.test.ts` passes. Manual smoke in dev env: trigger a gate, approve via Discord, verify the card retains its fields (no more "Gate Approved / Approved" collapse).
- **After C5:** `pnpm test` full suite green. Manual smoke: trigger a gate, approve via Discord, verify a second summary message appears with all fields; approve via REST (Bakin UI) with Discord enabled, verify same.
- **After C6:** Manual smoke: trigger a gate with a prior step output > 1024 chars, verify the gate card has a truncated preview and a thread with the full output.
- **After C7:** Manual read of `.claude/knowledge/workflow-approvals.md`. Confirm cross-link to #98.

---

## Open questions

**Resolved during spec review:**
- Web-source approver uses `os.userInfo().username` — user confirmed, iterate later if the display is poor.
- REST-initiated approval fires Discord summary when `discordGateAlerts=true` — user confirmed.

**Surfaced during planning, awaiting confirmation:**
- Options-object signature shift (R6) — plan recommends; user ack requested.
- `ApprovalActor` location in `src/lib/plugin-types.ts` vs `plugins/workflows/types.ts` (R10) — plan recommends shared location; user ack requested.
- Audit source tag `'system'` → `'web'` for REST handlers (R4) — plan recommends; user ack requested.

**Not blocking build-phase kickoff** if user responds "proceed with plan recommendations."
