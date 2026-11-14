# Spec: Provider integrations — Google Workspace + GitHub via capability packs

Status: **rev 5, for Mark's sign-off** (2026-11-13). Rev 1 was reviewed by Mark
(interview) and by Codex (static source review); rev 2 closed those findings and
got a second Codex round whose six blocking defects rev 3 closed; a third round
found replay/recovery windows that rev 4 closed (replayable approval
application, ledger-held admission identity, `attempting` consumption, account
verification) and two pre-existing scheduler bookkeeping gaps recorded in §10;
a fourth round found three contradictions inside rev 4's text that rev 5
fixes (replay guard, `accountEnv` in the schema, admission on recovery).
Every Codex factual finding was verified against the source before adoption. Supersedes the research handoff
`20261113-engineering-handoff-fa3f767d` (margo) and its seven supporting assets
as the controlling document. Plan: `provider-integrations-plan.md` (written after
sign-off).

## 1. Objective

Give Bakin agents real, human-gated access to Mark's Google Workspace (Gmail,
Calendar, Drive, Docs, Sheets) and GitHub (issues, PRs, Projects v2) using the
primitives Bakin already has — capability packs, secret slots, the approvals
primitive, the Bakin-owned scheduler and the chat kit — with **zero new
integration infrastructure**: no connector platform, no token broker, no
wrappers, no MCP bridge.

Success = four workflows passing live on this box (3737 serving the branch)
with Mark's real accounts; each is a PR's acceptance test:

| # | Workflow | Proves | PR |
|---|---|---|---|
| W1 | In chat: "what needs my attention from this week's mail, and what is on my calendar tomorrow?" | pack install → gog pinned bin → login check → skill quality | Bits + PR1 |
| W2 | A dispatched task drafts a reply to a named thread, saves the draft as an asset, calls `request_approval`; Mark approves on the board or Discord; the agent sends | the task approval gate end to end incl. Discord card and resume | PR2 |
| W3 | A task triages open issues on a repo Mark names, proposes labels/comments, requests approval; Mark picks "Approve all `github.comment` for this task"; the agent applies the rest without asking | standing grants | PR2 |
| W4 | A schedule job targets a chat: every morning the agent posts a mail + calendar digest as a chat reply | the schedule chat target + unread attention | PR3 |

### What the research got wrong, and why this spec differs

The handoff blocks every write until Bakin proves agents cannot bypass tool
policy via shell, plugins or inherited credentials, and sizes the work for an
engineering org. It never saw capability packs, the `google-workspace`/`github`
packs already in Bits (merged 2026-07-30, never installed), the approvals
primitive, `bakin_exec_ask_user`, or the 546 commits since the checkout it
inspected. Its provider semantics (handoff §7, §9.4, §10) are accurate and are
folded into the skills. Codex's framing is adopted: this is a **cooperative
approval policy** — the research's non-bypass finding stands; we choose a
policy that does not need it.

## 2. Decisions

| ID | Decision | Consequence |
|---|---|---|
| D1 | **Trusted operator, human-gated effects.** Agents hold real credentials via packs; safety = skill guidance + a Bakin approval before outward-facing writes. No attempt to make the shell non-bypassable. | Handoff V4/V5/X02 dropped. |
| D2 | **Google Workspace + GitHub now.** Microsoft 365 and Jira Cloud are follow-up packs (§10). | — |
| D3 | **Approval unblocks; the agent executes** on re-dispatch with a structured resume section. (Server-side execution of a frozen argv was offered and declined.) | §4.3. |
| D4 | **Chat: `ask_user`. Task: approval record.** | §4.3 caller rule. |
| D5 | **Gated = anything other people can see, or that cannot be undone. Unknown operation → ask.** No ownership exceptions (Codex, adopted over rev 1). Ungated: reads; gmail drafts and label changes; calendar freebusy; GitHub draft PRs on the agent's own branch. Classes in §4.3. | Skills carry the lists. |
| D6 | **Standing grants per task**, `approvedActions: string[]`, set by the card option, the task editor, the CLI, or inherited from a schedule job; refused for any detected agent context. Lifecycle in §4.3. | — |
| D7 | **Gate lives in the tasks plugin** (`bakin_exec_tasks_request_approval` + a `tasks` plugin-gate kind). | No new plugin, no new approval kind in core. |
| D8 | **Data policy: accept as-is with skill restraint.** `--wrap-untrusted` is guidance, not isolation; a body saved as an asset or shown on a card persists there. | No redaction machinery. |
| D9 | **Login verification is explicit** (hybrid, adopted over rev 1): the probe runs at pack install/sync completion, on `bakin check capabilities`, and from a "Check login" action; passive readiness reads never spawn anything and report the last result with its age. `unknown` blocks ready. | §4.1. |
| D10 | **gog is a sha256-pinned bin from upstream tar.gz** (all four platforms committed); gh stays a PATH prereq with a documented floor (≥ 2.90). | §4.2. |
| D11 | **One Bakin entry skill per pack; gog's MIT skills vendored under `references/`** at the pinned tag (adopted over rev 1's nine side-by-side skills). | §4.2. |
| D12 | **Accounts:** Google via OAuth on Mark's Workspace-org account (Internal consent screen); the skill always passes an explicit account (`GOG_ACCOUNT` set by the operator, or `--account`), never an ambient default. GitHub via the existing `gh auth login`; the login probe reports the active account. | — |
| D13 | **Digest = chat reply from a schedule job with a chat target**, built properly as PR3 with its own design (§4.4), after Codex recommended deferral and Mark chose to build. | — |
| D14 | **Delivery:** three stacked bakin PRs + one Bits PR; ≥2 Codex rounds per PR; branches in the main checkout; **Mark live-tests before any merge; nothing is self-merged or released.** Server-side changes need a 3737 restart to test (CLAUDE.md dev loop). | §8. |

## 3. Tech stack and constraints

Bun 1.4.3, TypeScript strict, zod at boundaries, React 19 + `@makinbakin/sdk`
kit. No new dependencies in bakin. Bits packs are `skill-pack` manifests
contract-tested by `packs/pack-contract.test.ts`. Standing rules: UI
conformance skill on every UI touch; `bun run lint` zero-warning; every test
mocks both content-dir resolvers + OpenClaw home; Pi pinned for throwaway
boots; never edit `~/.openclaw`; agent content edits land in Bits.

## 4. Design

### 4.1 Login verification (bakin PR1)

**Manifest** (`packages/core/src/agent-packages/manifest.ts`), beside `prereqs`:

```ts
const LoginRequirementSchema = z.object({
  name: z.string().min(1),                       // "Google account (gog)"
  probe: z.array(z.string().min(1)).min(1),      // argv, no shell
  setup: z.string().min(1),                      // exact operator command(s), shown verbatim
  help: z.string().url(),
  accountEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),  // env var naming the intended account
  expect: z.string().min(1).optional(),          // regex the probe's STDOUT must match for `ok` (must compile)
}).refine(p => !p.probe[0].includes('/'), { message: 'probe[0] must be a bare binary name' })
```

Two login entries of one pack may not share a receipt key (`loginEntryKey`,
the name slugged — owned by the manifest module); the schema refuses the
collision (build-time amendment, Codex PR1 round 2).

**`expect` (build-time amendment 2026-11-14, found by the PR1 verify boot):**
exit status alone cannot express "logged in" for gog — on v0.48.0 `gog auth
list`, `gog auth list --check`, `gog auth doctor --check` and `gog auth status`
ALL exit 0 with no account stored ("No tokens stored" on stderr, `{"accounts":
[]}` with `--json`). `gog auth list --check --json` does report `"valid":
true|false` per account (`internal/cmd/auth_list_helpers.go`
`annotateAuthListCheck`), so a login entry may declare `expect`: a regular
expression the probe's STDOUT must match for `ok`; exit 0 without a match is
`missing` with reason `no-match` (the remediation is the same `setup`
command). Its first capturing group, when present, is the account readiness
shows (a JSON probe's first stdout line is `{`, never an account); without a
group, no account is shown. With `accountEnv` beside it the pattern MUST
capture (schema-refused otherwise, as is a pattern over 1 KB) and the
configured account must equal a capture of some match — every match is read,
so the configured account valid in second place is `ok` and a valid second
account never vouches for a revoked first one (Codex r4 B2; the earlier
whole-stdout substring check let it). The pattern runs in a killable child,
never on the server's event loop (Codex r4 B1: a backtracking pattern such as
`a*a*a*a*a*a*a*a*b` over 10 KB stalls a thread indefinitely and a Worker's
`terminate()` does not stop it): `src/core/agent-packages/expect-match.ts`
spawns the checkout's script or, in the compiled binary, the binary itself on
the hidden `__bakin-expect-match` command (stdin JSON in, a bounded
`{ matched, captures, wantedFound }` summary out — match count, at most 256
distinct first captures for display, and the configured account's exact
membership decided over every match; flushed before the child exits; the
server reads at most 8 MB),
SIGKILLs it at the login deadline (the child, which runs the regex on a worker
thread, also exits itself a second later — an orphan never spins for good),
and reports `unknown`/`expect-timeout`
(or `expect-error` when the matcher cannot run or compile the pattern).
`expect` is a receipt input (a manifest edit that changes it makes the receipt
stale and re-keys the in-flight dedupe). The Google pack's probe is `gog auth list --check --json
--no-input` with `expect: "email":\s*"([^"]+)"[^}]*"valid":\s*true`
(`[^}]*` stays inside one account object — an invalid first account never
lends its email to a valid second one). `gh auth status` exits 1 when logged
out, so the GitHub pack declares no `expect`.

Host-side admission (not only the Bits contract test): the binding predicate
is `bins.some(b => b.name === probe[0])` OR `prereqs.some(p => p.kind ===
'binary' && p.probe === probe[0])` (prereq `name` is display text — never
matched). Neither ⇒ manifest error at install/sync (`manifestValid: false`,
visible finding). Precedence: a `bins` match resolves ONLY to the verified
managed path under `~/.bakin/bin` (`verifyInstalledBin` must pass; drifted or
missing ⇒ `unknown`, never a PATH fallback); only a prereq-only binding
resolves on the server PATH.

**Verification engine** (`src/core/agent-packages/login-verify.ts`, new):
`verifyLogin(packKey, req)` spawns the resolved argv with `Bun.spawn` (no
shell, stdin closed, stdout/stderr captured and bounded at 16 KB, server env),
5 s timeout that KILLS the child, in-flight dedupe per `(bakinHome, packKey,
installedVersion, resolvedBinaryPath, probe)`. Outcome → `ok` (exit 0, and the
stdout matches `expect` when declared), `missing` (non-zero; or exit 0 without
an `expect` match, reason `no-match`; or a configured account that is not a
capture of any `expect` match, reason `account-mismatch`), `unknown` (timeout,
spawn error, killed, unverifiable binary, `expect-timeout`, `expect-error`). The receipt (`~/.bakin/packages/receipts/login/<packKey>.json`)
stores `checkedAt`, exit code, the resolved binary path + its sha256, the
pack version, and the probe's stdout (bounded; the probe commands print account
names — never secrets — and are read-only by contract). **Account
verification:** the login entry may declare `accountEnv?: string` (gog:
`GOG_ACCOUNT`). When set and the env var is non-empty, `ok` additionally
requires the stdout to contain that value; otherwise the status is `missing`
with remediation `${accountEnv}=<value> is not a logged-in account — run:
${setup}`. The receipt records `account` (the matched value, or the first
non-empty stdout line when no `accountEnv`) and `accountInputHash` (sha256 of
the `accountEnv` value, or empty). **Invalidation:** readiness reports a
receipt as `unknown` (stale) when the pack version, the resolved binary sha
or `accountInputHash` differs from the current values, when a secret slot the
pack declares changed after `checkedAt`, or on explicit re-check; stale
receipts are re-run on the next explicit trigger (a `GOG_ACCOUNT` change is
one, via the secret-save trigger or `bakin check capabilities`). Install consent discloses
"Bakin runs `<probe>` to check login after install, on sync and on request".

**Triggers:** pack install and `bakin packages sync` completion (through the
requirements installer so every projection pass checks), `POST
/api/packages/:id/login-check` (the "Check login" button in Explore's
installed card, the runtime hub's Capabilities tab and the Health incident;
the CLI verb `bakin packages login-check <id>`), and a secret save for a slot
the pack declares. Never on a GET — and **not** on `bakin check capabilities`:
the onboarding rule "checks change nothing" (read-only services, no log line)
outranks rev 2's wording, so the check REPORTS receipts and names the
explicit verb as remediation (build-time amendment, plan 1.4c).

**Readiness** (`capability-readiness.ts`) gains a `login` leg that READS the
receipt: `CapabilityLoginStatus { name, setup, help, status: 'ok' | 'missing'
| 'unknown', checkedAt?: string, account?: string }`. `missing` and `unknown`
block `ready`; remediation: `${name}: not logged in — run: ${setup}` /
`${name}: login not verified — click Check login or run: bakin check
capabilities`. Consumers (all thin): Health `capabilities` check adds
`not-ready-login` (`human`, `needs: 'credential'`, `handoff.command = setup`,
plus a `request` choice that runs the check); Explore's installed card shows
"Installed — needs login" / "Login not verified"; `bakin check capabilities`
prints status + age; the SDK exports the leg type. Older hosts: the pack
declares `bakin: ">=<the rc this ships in>"` and PR1 makes the install path
ENFORCE that range (today `manifest.bakin` is parsed but "cosmetic", and
`RequiresSchema` is not strict, so an older host would silently drop `login`
and report ready without checking) — mirroring plugins' `bakinRange`,
prerelease-aware via `Bun.semver`.

### 4.2 Packs (Bits PR)

**google-workspace 2.0.0**
- `bakin: ">=0.0.1-rc.NN"` (the rc that ships PR1).
- `requires.bins[]`: `gog` 0.48.0 from `github.com/openclaw/gogcli/releases/download/v0.48.0/gogcli_0.48.0_<os>_<arch>.tar.gz`, `archive: { format: 'tar.gz', member: 'gog', extractedSha256 }`, `verifyArgs: ['--version']`. Committed pins (checksums.txt + member hashes, 2026-11-13):

  | platform | tarball sha256 | extracted `gog` sha256 |
  |---|---|---|
  | darwin-arm64 | `a8c6142fcb9f41f0eff02ffef78298cbe4981061f149c2b3a42d5a13bad931bd` | `7957d49fe75bef040bdb191cccd41cca0000e79c8f497b05f8ff8a4887c552b9` |
  | darwin-x64 | `423d8ac93530e13cd7cb599de2655db3262ddc763181996771d74188ffcefc5a` | `023744603a56c9b88386ba6f0ddf94ed16b81d973d3b406822a5feb6f7c2a1eb` |
  | linux-x64 | `8809d2f4fe95a0299b1a2a5c6bc912c4aba4b90a7b5e2c1f5cf11b9945a50004` | `7d86d981714c624d5b0719040fa632b245aeb61ae53c379646524a67cf037c15` |
  | linux-arm64 | `fc40524368d2cb6213bdfe0b736b5884e1b55c6368706d7a285542cb7e559b68` | `1137f6e970ea95ca225054ef646510d666a968e6e3a261901e0e0bc5f0f0620c` |

- `requires.login[]`: `{ name: 'Google account (gog)', probe: ['gog','auth','list','--check','--json','--no-input'], setup: 'gog auth setup you@example.com --credentials ~/Downloads/client_secret_*.json --login', help: 'https://gogcli.sh/quickstart', accountEnv: 'GOG_ACCOUNT', expect: '"email":\\s*"([^"]+)"[^}]*"valid":\\s*true' }` (see §4.1 `expect`: every `gog auth` command exits 0 when logged out). README: the one-time Google Cloud steps (project, APIs, **Internal** consent screen for Workspace orgs, Desktop client), `GOG_ACCOUNT` export, admin "unconfigured apps" caveat.
- `contributions.skills`: ONE skill `google-workspace`: `SKILL.md` (when to use gog; the fast path `gog auth list --check`; read discipline `--readonly --no-input --wrap-untrusted --json`, explicit `--account`; the gate rule and classes; chat vs task confirmation; assets discipline; honest failure; the handoff cautions that matter — opaque IDs, lost send response → never resend, all-day vs timed events, `sheets update` overwrites, Docs edits need batchUpdate semantics) + `references/gog.md`, `references/gog-gmail.md`, `-calendar`, `-drive`, `-docs`, `-sheets`, `-inbox-triage.md`, `-weekly-digest.md` vendored verbatim from the v0.48.0 tag (LICENSE kept; `agents/openai.yaml` dropped). SKILL.md names each reference and when to open it. A `scripts/vendor-gog-skills.ts` in Bits re-vendors from a tag; the pack contract test asserts the vendored tag equals the bin version.
- Drops the stale `prereqs.gog` and the wrong `gog auth credentials` example.
- Context cost is measured: `bakin agents context` before/after on the live box, recorded in the PR.

**github 1.1.0**
- `bakin` floor as above; `requires.prereqs.gh` keeps `probe: 'gh'`, help text states the floor (≥ 2.90; margo 2.93, local current).
- `requires.login[]`: `{ name: 'GitHub account (gh)', probe: ['gh','auth','status'], setup: 'gh auth login', help: 'https://cli.github.com/manual/gh_auth_login' }`.
- SKILL.md: gate rule + classes; chat vs task confirmation; Projects v2 cautions (node IDs, `read:project`/`project` scopes); `GH_TOKEN` note: when the slot is set it overrides the keyring login — the login probe's account line shows which identity is active.

**Action classes** (documented in each pack; core validates only the shape):

| class | gated operations |
|---|---|
| `gmail.send` | send, reply, forward (drafts and labels ungated) |
| `calendar.write` | create, update, delete, respond, invite |
| `drive.share` | permissions, link sharing |
| `drive.delete` | trash, delete |
| `docs.write` / `sheets.write` | any mutation of a document/spreadsheet |
| `github.issue` | create, edit, close, reopen, label, assign |
| `github.comment` | issue/PR comments |
| `github.pr` | create non-draft, ready-for-review, edit, close |
| `github.merge` | merge, delete branch |
| `github.release` | publish/edit a release |
| `github.project` | Projects v2 item/field mutations |

Anything not listed → ask (chat) / request with the closest class or
`<provider>.other` (task).

**Contract test**: `login` entries bind to a declared bin/prereq, have a
non-empty `setup`, an https `help`; vendored references match the pinned tag.
Catalog entries unchanged (`defaultSelected: false`).

### 4.3 Task approval gate + standing grants (bakin PR2)

**Field** `approvedActions?: string[]` (classes, shape
`^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`) on `Task`, `TaskCreateInput`,
`TaskUpdateInput` (null clears), the task store schema, the REST task routes,
`BakinJobMeta`, and the schedule job routes.

**Provenance (one policy, every HUMAN entry path):** every REST/CLI/plugin-
hook request that sets, adds or removes `approvedActions` on a task OR a
schedule job first runs `assertOperatorDecision(approvalProvenanceFromRequest(
req))` (the ONE policy from `src/core/approvals/service.ts`; refusal → 403
with its `code`). The `bakin_exec_tasks_*` / `bakin_exec_schedule_*` tools
never expose the field. `bakin tasks allow|disallow` and `bakin schedule …
--allow` need `--as human`. A job's grants are stored WITH the provenance and
revision of the request that set them (`grants: { actions, setBy:
ApprovalProvenance, revision }`); the fire engine COPIES that record onto each
task it creates (no request, no new declaration — the copy carries
`inheritedFrom: { jobId, revision, setBy }`). The card's `approve-all` writes
the grant from the committed approval record's provenance. Every grant change
is audited (`task.grant.added|removed`, provenance, source: card / editor /
cli / schedule-inherit).

**Grant lifecycle:** grants live on the task until it is archived or deleted;
reopening a done task keeps them (the human who reopens sees the chips).
Schedule grants are copied onto each task at creation (audited
`schedule-inherit`); editing or removing the job's grants affects future tasks
only. Moving a task to another agent keeps grants (they are per task).

**Exec tool** `bakin_exec_tasks_request_approval`:

```ts
parameters: {
  taskId: z.string(),
  action: z.string().regex(ACTION_CLASS_RE),          // gmail.send
  command: z.string().max(4_000),                     // the exact command you will run
  summary: z.string().max(1_000),                     // one line: what, to whom
  contentAssetId: z.string().optional(),              // the saved draft/body (durable, hashed)
  details: z.string().max(8_000).optional(),          // recipients, ids, preview
}
```

Companion tool `bakin_exec_tasks_approval_outcome({ taskId, approvalId,
outcome: 'attempting' | 'done' | 'failed' | 'unknown', detail })`. The
contract is two calls per approved write: `attempting` BEFORE the command
runs (durable transition `approved-unconsumed → attempting`; the tool refuses
to mark `attempting` twice), then `done` / `failed` / `unknown` after.
`done` and `failed` consume the approval (never presented as executable
again). `unknown` (lost response, timeout) and an `attempting` with no later
report when the next dispatch starts both resolve to **verify-first**: the
resume section presents the request as `attempted, outcome unknown` with the
verification the skill prescribes (`gog gmail search` for the sent message,
`gh issue view` for the comment) and forbids re-running until verified; the
agent then reports `done` (already happened) or re-requests (a new
generation) if it did not. A standing-grant execution follows the same two
calls against its auto-approval record.

Behaviour:
1. **Caller rule:** the task must exist, be assigned to the calling agent, and
   have a live run for this agent (ledger). No valid task ⇒
   `fail({ code: 'no_task' , message: 'request_approval needs the task you are
   dispatched for; in a chat use bakin_exec_ask_user.' })`. (Chat detection
   via `chat.resolveActiveTurn` is NOT used — it answers null on ambiguity.)
2. **Workflow tasks are refused** in this PR (`workflow_task`): blocking
   cancels the workflow instance (`blockTaskWithEffects` →
   `workflows.cancelInstance`). Workflow steps keep their own gates.
3. **Request identity:** `requestHash = sha256(action, command, contentAssetId
   + its current version hash, details)`. The gate record for a task is
   `~/.bakin/tasks/…` sidecar-free: the tasks plugin keeps `approvalGen` and
   the current pending `{ approvalId, requestHash }` in plugin storage keyed by
   task (Projects' generation pattern); same hash while pending ⇒ return the
   same approval (retry-safe); different hash ⇒ new generation.
4. **Standing grant** (`approvedActions` includes `action`) ⇒ task log entry
   `approval: auto-approved <action> by standing grant — <summary>` with
   `{ command, requestHash }` in `data`, audit `task.approval.standing`,
   return `{ approved: true, by: 'standing-grant' }`.
5. Otherwise `ctx.approvals.request` id `tasks:<taskId>:action:<gen>`,
   gateKind `action`, entityId `<action>`, title `${agent} wants to ${summary}`,
   body: command + details as plain text (escaped; asset link when given),
   options `approve` ("Approve this one", primary), `approve-all` ("Approve
   all <action> for this task", primary), `reject` (destructive, reason per
   settings); block the task with reason `AWAITING_APPROVAL_REASON` (a
   constant the schedule fire engine exempts from failure counting, like
   `MISSED_WINDOW_REASON`); log `approval: requested <action> — <summary>`;
   return `{ approved: false, approvalId, status: 'pending' }` with the
   instruction to end the turn. Content must be durable before asking: a
   draft in the run worktree dies at settle, so the skill saves it as an asset
   and passes `contentAssetId`.

**Gate handler** (`registerPluginGate('tasks','action', …)` at activation):
- `ownerState`: `live` while the task is blocked with this approval pending in
  plugin storage; `orphaned` when the task is done/archived/deleted or a newer
  generation exists; `unknown` on read errors.
- `onResolve` runs BEFORE the record's compare-and-set
  (`src/core/approvals/service.ts` awaits the handler, then CAS), so it
  **validates only**: the task still exists, is blocked on exactly this
  approval id/generation, and the option is one of the three — otherwise it
  throws `ApprovalResolveError(…, 409)` and the record stays pending. It
  writes nothing.
- **Apply after commit.** ONE pure function `applyCommittedApproval(record)`
  derives everything from the committed record and is idempotent. Entry
  guard from plugin state `pending`: `record.status ∈ {approved, rejected}`
  (NOT `cancelled` — `cancelApproval` publishes the same `approval.resolved`
  event), the id equals the task's current pending `{ approvalId,
  generation }`, and the task is still blocked with
  `AWAITING_APPROVAL_REASON`. Entry from plugin state `applying` (a replay
  after a partial application) re-checks ONLY the record status and the
  generation — the task may already be in todo from step (d) — and re-runs
  the remaining steps.
  Then, as a replayable sequence: (a) plugin state ← `applying` with the
  committed status (idempotent); (b) task log entry keyed by approvalId
  (skipped if present); (c) for `approve-all`, add the class (set
  semantics); (d) move blocked → todo (no-op if already todo); (e) plugin
  state ← `approved-unconsumed` | `rejected` and `triggerDispatch`. Called
  from the `approval.resolved` subscriber and from boot reconciliation over
  every `tasks:` record whose plugin state is `pending` OR `applying` (a
  resolve that committed, or an application that crashed midway, while the
  server was down); every step is idempotent so a partial application
  replays to the same end state.
  Reject also returns the task to todo (the agent reads the reason and
  decides; Projects' signoff precedent).
- Manual moves/deletion/reassignment while pending: a move out of blocked by a
  human cancels the pending approval (`ctx.approvals.cancel`, reason `task
  moved`) and marks the plugin state `cancelled`; delete/archive ⇒ orphaned
  at rehydration. A cancelled or superseded generation never resumes.

**Dispatch resume section:** `buildDispatchMessage` does NOT carry the task
log, and the main/triage branches return early. PR2 adds an `approvals`
section to every dispatch branch: the standing grants; the ONE actionable
request (`approved-unconsumed`, or `pending` ⇒ stop) with its FULL recorded
command (bounded by the tool's own 4 000-char cap — never truncated; the
section's budget is the cap + 2 KB of framing), its approvalId, requestHash,
who decided and the reject reason if any; older decisions as one-line
summaries up to 1 KB with a visible omission marker; and the rule: "a pending
approval means stop; execute an approved request exactly as recorded, then
report with `approval_outcome`; a standing grant covers that class for this
task; everything else asks again". Pinned by the dispatch-prompt byte
fixtures.

**UI:** ApprovalPanel's plugin-gate renderer already draws custom options;
`approve-all` gets a distinct visual (secondary + a one-line "grants this
class for the rest of the task" caption) so one-shot and standing are not
confused. Standing grants render in the task detail editor as a removable
token list composed from `@makinbakin/sdk/ui` (the pattern the UI conformance
skill approves for free-form string lists; chosen in the plan, not assumed),
same composition on the schedule job form. CLI: `bakin tasks create …
--allow=<class,…>`, `bakin tasks allow|disallow <id> <class>`.

### 4.4 Schedule chat target (bakin PR3)

**Job shape:** `BakinJobMeta.target?: 'task' | 'chat'` (default `'task'`).
**Binding:** `BakinJobMeta.chat?: { chatId }` is the ACTIVE binding
(replaceable: set on first fire, replaced when the chat is deleted or the
job's agent changes — chat agent is immutable — the old chat stays, visible
and deletable). `ChatSummary.scheduleJobId?: string` is provenance only
(set at creation, immutable, shown in the chat list as "scheduled"), never a
lookup key. `ChatSummary.externalKey` is NOT used (the inbound bridge relays
to channels for ANY non-empty value). A crash between `createChat` and
recording the binding leaves one unbound chat titled by the job; the next
fire creates and binds a new one — accepted and stated, not healed. Task-only
fields (`requireTriage`, `workflowId`, `teamId`) are refused on REST/hook
validation for chat targets, not just hidden in the form. Chat jobs require
`agentId`.

**Admission:** after `claimCronFire`, the fire engine runs
`preDispatchGate(agentId, contentDir, memo, { })` — kill switch, agent pause,
model eligibility, budget — and skips the fire (`markCronFireSkipped`,
reason) on a hold; the same `allowOverlap` rule applies with "the chat has a
turn in flight or queued for this job" as the overlap predicate, decided in
the same step as admission. Prompt windows are occurrence-anchored: the
rendered prompt carries the occurrence time (`{fireAt}` var) so a delayed fire
still asks for the intended day.

**Admission identity lives in the ledger, not the transcript.** The fire
engine mints `turnId = randomUUID()` and writes it to the `cron_fires` row
with disposition `starting` BEFORE calling the chat hook; the occurrence's
identity therefore survives chat deletion. The ONE turn engine
(`packages/core/src/conversation/turns.ts`) gains `start(…, { turn?: {
turnId, admissionKey } })`: with it, the engine uses the supplied `turnId`,
persists `turnId` + `admissionKey` ON the user row BEFORE launching (today a
user row carries neither — the interrupted-turn boot sweep, `store.ts
sweepInterruptedTurns`, stamps by that `turnId` so a keyed terminal row
always exists), and when a user row with that `admissionKey` already exists
it starts nothing, emits nothing, logs the dedupe and answers `'accepted'`
(idempotent success — the caller already holds the turnId it supplied).
**`StartTurnResult` does not change**: `'accepted'` is a published SDK
literal (`ConversationStartTurnResult`) that Bits plugins compare against, so
no caller changes and no SDK floor bump. The schedule's key is
`schedule:<jobId>:<runId>`.

**Hook:** chat registers `chat.startScheduledTurn({ jobId, runId, turnId,
chatId?, agentId, title, message })` → use `chatId` when it exists, else
create a chat (`scheduleJobId` provenance) and return its id; call
`startChatTurn(…, { turn: { turnId, admissionKey }, queueIfBusy: false })`
(an in-flight turn ⇒ `busy`; occurrences never merge into one queued turn);
return `{ chatId, started: true } | { busy } | { chat_missing }` (a dedupe
is `started: true` too — the row's turnId is the identity). No chat plugin /
hook absent ⇒ skip `chat_unavailable`.

**Ledger:** `cron_fires` gains `target TEXT NOT NULL DEFAULT 'task'` written
AT CLAIM (immutable occurrence target — the healer re-drives by the ROW's
target, never the job's current one), nullable `chat_id`/`turn_id`, and the
disposition `starting`. Verbs: `claimCronFire(…, target)`,
`markCronFireStarting(jobId, runId, chatId, turnId)`,
`attachCronChatTurn(jobId, runId)` (→ `created`). Order per fire:
claim(target) → admission gate (`preDispatchGate`, overlap) → resolve or
create the chat → record `job.chat.chatId` if changed → mark `starting`
(chatId, turnId) → hook → `created` (busy ⇒ `skipped: chat_busy`). The healer
selects `pending` AND `starting` rows older than `HEAL_AFTER_MS`: `pending` ⇒
the full flow; `starting` ⇒ first ask the hook whether the user row with this
`admissionKey` exists (an effect-free probe, `chat.findScheduledTurn`): yes
⇒ `created` (duplicate recognised, nothing started); chat gone ⇒ `skipped:
chat-deleted` (never replayed into a fresh transcript); no ⇒ the turn never
started, so recovery re-runs the CURRENT admission checks (job still
enabled and unpaused, `preDispatchGate`, overlap) exactly as `runClaimedFire`
does for tasks, then calls the hook with the row's chatId/turnId (⇒
`created`) or skips with the hold's reason.
Readers (`runs-reader`, run history, job row) show chat runs with a link to
the chat. Failure tracking reads the row's `turn_id` terminal row (`done` ⇒
success, `error`/`aborted`/swept-interrupted ⇒ failure, none ⇒ in flight) the
way the task path reads the board today; `maxFailures` auto-pause applies
unchanged. Completion bookkeeping (`lastTaskId`-equivalent `lastRun`, one-shot
`completedAt`) is written AFTER `created`, mirroring the task path's existing
order and its existing crash window (§10).

**Catch-up:** missed-window occurrences for chat targets are skipped
(`missed-window`, audited) — there is no triage-task equivalent and a stale
digest is noise. Pausing/skipping/one-shot completion behave as for tasks.

**Attention:** the reply bumps `unreadCount` exactly as any reply — nav badge,
toast, OS notification, title prefix. Humans may reply in the job's chat;
their messages are ordinary turns, and the next fire still starts its own
turn (queue is not used).

**Out of scope:** cursor storage; deleting the job deletes nothing in chat
(the chat stays, unbound); switching a job's target resets `chat`.

### 4.5 Deliberately not built

No connection inventory UI, vault, cursor store, provider wrappers, Pi MCP
bridge, Linux validation (pins declared, untested stays untested), per-agent
grants, gog safety-profile binary (stock gog; the gate is the policy), shipped
schedule jobs, redaction.

## 5. Commands

```
bun run lint && bun run typecheck && bun run check:cycles
bun test tests/<file>.test.ts --isolate
bun run test                          # never concurrently with ui:conformance
bun run ui:conformance --quick        # every UI touch; full mode before merge-ready
cd ../bakin-bits-official && bun run test
bakin packages install ../bakin-bits-official/packs/google-workspace   # live, this box
bakin check capabilities
```

## 6. Files (by PR)

```
PR1  packages/core/src/agent-packages/manifest.ts              login schema + bin/prereq binding
     src/core/agent-packages/login-verify.ts                   NEW engine + receipts
     src/core/agent-packages/{capability-readiness,requirements-installer}.ts
     packages/host/src/api/packages/*                           POST login-check
     plugins/health/lib/system-checks/capabilities.ts          not-ready-login
     plugins/explore/components/{catalog-entry,install-dialog}.tsx
     src/core/onboarding/components/capabilities.ts, src/cli/commands/packages.ts
     packages/sdk public-api schema; tests/core/agent-packages/login-verify.test.ts (+ readiness, health, explore)
PR2  packages/sdk/src/types/services.ts; packages/core/src/tasks/{store,public-task}.ts
     plugins/tasks/lib/{exec-tools,approval-gate(NEW),routes}.ts; plugins/tasks/components/{task-detail-modes,approval-panel}.tsx
     plugins/schedule/{types.ts,lib/fire-engine.ts,lib/job-service.ts,lib/routes/*,components/job-form.tsx}  (approvedActions + exempt reason)
     src/core/dispatch-prompts.ts (+ fixtures); src/cli/commands/tasks.ts
     tests/plugins/test-helpers.ts (+ memory approvals backend); tests/plugins/tasks/*, tests/core/dispatch-prompts*
PR3  packages/core/src/execution/ledger.ts (+ migration test); plugins/schedule/{types.ts,lib/fire-engine.ts,lib/runs-reader.ts,lib/routes/*,components/{job-form,job-row,run-history}.tsx}
     plugins/chat/{index.ts,lib/stream-bridge.ts}; tests/plugins/{schedule,chat}/*; tests/core/execution/*
Docs .claude/knowledge/{capability-packs,approvals,tasks-plugin,bakin-owned-scheduler,chat-plugin,agent-packages}.md
     .claude/knowledge/provider-integrations.md (NEW); CLAUDE.md pointers; README (capabilities list if present)
     docs/src/content/docs/extending/agents/packages.md (login leg)
Bits packs/{google-workspace,github}/**, packs/pack-contract.test.ts, scripts/vendor-gog-skills.ts
```

## 7. Code style

```ts
// plugins/tasks/lib/approval-gate.ts — one gate, typed refusals, no message parsing
export const ACTION_CLASS_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/
export const AWAITING_APPROVAL_REASON = 'Awaiting approval'

export function approvalIdFor(taskId: string, generation: number): string {
  return `tasks:${taskId}:action:${generation}`
}

export function requestHash(input: { action: string; command: string; contentHash?: string; details?: string }): string {
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(input)).digest('hex')
}
```

`createLogger('tasks-approval-gate')`; zod at tool boundaries; typed errors;
identifiers never display names; `const` over `let`; kebab-case files.

## 8. Testing strategy

- **Unit** — login-verify: fake probe scripts (exit 0 / 1 / sleep / missing
  binary) → ok/missing/unknown, kill on timeout, receipt shape, in-flight
  dedupe, binding refusal, readiness reads receipts only (no spawn: a probe
  that writes a marker file must not fire on GET). Gate: caller rule, workflow
  refusal, standing auto-approve + log, request hash reuse vs new generation,
  pending path blocks with the exempt reason, resolve matrix (approve /
  approve-all / reject → log, grants, move after `approval.resolved`),
  ownerState matrix, boot reconciliation, manual move cancels, provenance
  refusals on every grant path (REST task + schedule, CLI identity). Dispatch
  prompt: the approvals section in every branch, byte budget. Schedule chat
  target: typed binding (no externalKey), admission via `preDispatchGate`,
  overlap/busy skip, hook payload, attach + healer idempotency, run readers;
  the inbound bridge never sees a schedule chat.
- **Harness** — `tests/plugins/test-helpers.ts` gains the in-memory approvals
  backend so plugin tests decide gates as the operator; SDK harness tests for
  the public types.
- **Architecture/contract** — public-api schema; dispatch-prompt fixtures;
  Bits `pack-contract.test.ts`.
- **UI** — RTL for the grants token list, the approve-all option rendering,
  the job-form target switch; `ui:conformance --quick` per PR, full on PR3.
- **Integration** — `verify` skill boot (Pi pinned): install the pack from the
  local Bits checkout; the install trigger runs the probe once, so with a
  verified binary and no login the leg reads `missing` with the setup
  command; `unknown` is exercised separately (stale receipt after a pin
  change, unverifiable binary); `bakin check capabilities` exit code.
- **Live acceptance (Mark, 3737)** — W1 after Bits+PR1, W2+W3 after PR2, W4
  after PR3.

## 9. Boundaries

- **Always:** mock both content-dir resolvers + OpenClaw home; lint +
  typecheck + touched tests before each commit; `ui:conformance --quick` for
  UI; knowledge docs in the same PR; Bits pack versions bumped in the same PR;
  provider semantics in skills, never core; every grant mutation through
  `assertOperatorDecision`.
- **Ask first:** new dependency; changes to approvals core types or the
  ledger schema beyond §4.4; a different gog pin; any merge, release, or
  anything on margo.
- **Never:** self-merge or release; edit the live `~/.openclaw`/`~/.bakin` by
  hand; spawn anything from readiness but the manifest's bound `login` probe
  on an explicit trigger; let a detected agent context set grants; put tokens
  or OAuth JSON in the repo, assets, logs or chat.

## 10. Follow-ups recorded, not built

- **Microsoft 365 pack** — Softeria is MCP-only and Pi has no bridge; a CLI
  lane (PnP `m365`) when Mark has a test tenant. Classes follow §4.2.
- **Jira Cloud pack** — ACLI, login probe `acli jira auth status`, terms review
  first; DC only against a named instance.
- **gh as a pinned bin** — needs zip support in the bin installer.
- **Per-agent grants** — declined (D6); revisit if per-task grants are tedious.
- **Workflow-task approvals** — refused in PR2; a workflow-aware gate later.
- **Chat queue for scheduled turns** — `busy ⇒ skip` now; queueing with
  occurrence identity later if skips prove common.
- **Scheduler bookkeeping after attach (pre-existing)** — the task path
  attaches the claim, then writes `lastTaskId` / one-shot `completedAt` in a
  separate write (`fire-engine.ts`), and the healer only revisits `pending`
  rows; a crash between the two leaves a `created` row with stale job
  bookkeeping. The chat path inherits the same window by design (same order).
  Fixing it is a scheduler change for both targets, filed separately.
- **Orphan chat on create-then-crash** — one unbound chat titled by the job
  (§4.4); a sweep is not worth its code today.

## 11. Open questions

None blocking. Plan-stage choices: the exact SDK composition for the grants
token list (conformance skill decides), and whether `{fireAt}` joins the
existing `{date}` template vars or replaces it.
