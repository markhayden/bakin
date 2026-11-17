# Spec: Provider integrations — Google Workspace + GitHub via capability packs

Status: **rev 6, for Mark's sign-off** (2026-11-14). Rev 5 (2026-11-13) was
signed off and PR1 was built against it. A spike
(`provider-integrations-spike.md`) then re-opened the integration surface:
the runtimes' own Google/GitHub integrations are the same CLIs, no native
plugin passes the bar, and runtime hooks are defense in depth only. Mark's
answers (spike § "Mark's answers") plus a seven-question interview, each
question run past Codex first, produced rev 6: agents reach providers through
**local MCP servers that Bakin runs and relays as Bakin tools**, gated by ONE
approval check at the relay, with a **Bakin-owned Google OAuth client**. PR1
(login verification) is unchanged. Rev 5's agent-executes-a-CLI gate, `ask_user`
chat path and tasks-plugin gate are retired. Supersedes the research handoff
`20261113-engineering-handoff-fa3f767d` (margo) as the controlling document.
Plan: `provider-integrations-plan.md` (rev 4 follows this sign-off).

## 1. Objective

Give Bakin agents real, human-gated access to Google Workspace (Gmail,
Calendar, Drive, Docs, Sheets) and GitHub (repos, issues, PRs) for any Bakin
user, using the primitives Bakin already has — capability packs, pinned bins,
the approvals primitive, exec tools, the scheduler and the chat kit — plus ONE
new piece: a **provider relay** that runs vetted local MCP servers and exposes
their tools to every runtime through the tool-access path each runtime already
uses (Pi's in-process exec-tool bridge, OpenClaw via Bakin's MCP server). No
per-runtime plugins or hooks, no token broker, no provider wrappers.

Success = six workflows passing live on this box (3737 serving the branch)
with Mark's real accounts; each is a PR's acceptance test:

| # | Workflow | Proves | PR |
|---|---|---|---|
| W1 | In chat: "what needs my attention from this week's mail, and what is on my calendar tomorrow?" | pack install → pinned bins → login check → relayed read tools | Bits + PR1 (CLI) → re-run on PR2 (relay) |
| W2 | A dispatched task drafts a reply to a named thread (draft = private, no card) and tries to send; the send is refused with a card showing the exact message; Mark approves on the board or Discord; the task resumes and the send goes through once | relay gate, exact-argument binding, task resume | PR2 |
| W3 | A task triages issues on a repo Mark names and comments; Mark picks "Approve all `github.comment` for this task"; the remaining comments go through without cards | standing grants per action class | PR2 |
| W4 | In chat: "email Sam that the meeting moved" → card inline in the chat; approve → a follow-up turn in that chat sends it | chat cards + follow-up turn | PR2 |
| W5 | A schedule job targets a chat: every morning the agent posts a mail + calendar digest as a chat reply | the schedule chat target + unread attention | PR3 |
| W6 | A fresh home: Explore → Google Workspace → Connect Google → consent in the browser → paste the final address back → login leg ready, no Google Cloud steps | Bakin-owned client + Connect flow | PR4 |

### What the research got wrong, and why this spec differs

The handoff blocks every write until Bakin proves agents cannot bypass tool
policy via shell, plugins or inherited credentials, and sizes the work for an
engineering org. It never saw capability packs, the Bits packs, the approvals
primitive or the 546 commits since its checkout. Its provider semantics
(handoff §7, §9.4, §10) are accurate and are folded into the skills and the
class tables. This is a **cooperative approval policy** (D1, reaffirmed by
Mark 2026-11-14): the non-bypass finding stands; we choose a policy that does
not need it. The shell, the CLIs and the stored tokens remain reachable by a
determined agent.

## 2. Decisions

| ID | Decision | Consequence |
|---|---|---|
| D1 | **Trusted operator, cooperative approvals.** Safety = skill guidance + ONE Bakin approval check at the relay before any write others can see or that destroys something. No attempt to make the shell non-bypassable (reaffirmed 2026-11-14, spike decision A). | Handoff V4/V5/X02 dropped. |
| D2 | **Google Workspace + GitHub now.** Microsoft 365 and Jira Cloud are follow-ups (§10). | — |
| D3 | **Refuse, card, one matching call.** A gated call without approval is refused with `needs_approval`; the card is bound to caller + provider account + tool + canonical arguments; after approval the agent's next identical call passes once (consumed atomically before forwarding); changed arguments need a new card. Approvals expire. | §4.3. Replaces rev 5's agent-runs-a-CLI-after-approval. |
| D4 | **One card for tasks and chats.** Task cards show on the board; chat cards render inline in the chat; both announce through the approvals attention provider and Discord. Approving a chat card starts a follow-up turn in that chat. `ask_user` stays for questions, never for authorizing writes. | §4.3. Replaces rev 5 D4. |
| D5 | **Three classes from a reviewed table, never server annotations.** `read` (no card), `private` (only the operator sees it — Gmail drafts, labels, read/unread, archive — no card by default; settings can tighten it), `external` (anything others can see or anything destructive — card). Multiplexed tools classify by argument; trash via label change is external; branch creation and draft PRs are external; a tool missing from the table is external. | §4.2 tables. |
| D6 | **Standing grants per task, per action class** (`gmail.send`, `github.comment`, …), never per group. Set by the card's "Approve all <class> for this task", the task editor, the CLI, or inherited from a task-target schedule job; refused for any detected agent context. Chats get one-shot approvals only. | §4.3 (rev 5 lifecycle kept). |
| D7 | **The gate lives in core, at the relay** (`src/core/integrations/`), with a new approval owner kind `integration-action` anchored to a task or a chat. | Approvals core type change (approved here). |
| D8 | **Data policy: accept as-is with skill restraint.** gog's `--wrap-untrusted` stays on; bodies shown on a card persist in the approval record. | No redaction machinery. |
| D9 | **Login verification is explicit** (PR1, unchanged). | §4.1. |
| D10 | **Pinned bins:** `gog` (tar.gz, member `gog`) and `github-mcp-server` (tar.gz, member `github-mcp-server`), sha256-pinned, all four platforms committed; `gh` stays a PATH prereq (floor ≥ 2.90) used for login and the token only. | §4.2. |
| D11 | **One Bakin skill per pack, written against the relayed tools.** gog's vendored CLI references are dropped — agents no longer drive the CLI. | §4.2. |
| D12 | **Accounts.** Google: a **Bakin-owned OAuth desktop client** registered into gog as client `bakin`, signed in through a Connect button with paste-back, full access by default, taken through Google verification including Gmail's restricted scopes. GitHub: the token comes from `gh auth token` at each server spawn, handed only to the child, never stored. | §4.5 (Google), §4.2 (GitHub). |
| D13 | **Digest = chat reply from a schedule job with a chat target** (PR3, §4.4). Writes inside a scheduled chat use the chat card. | — |
| D14 | **Delivery:** PR1 as built; a standalone paste-a-link fix; PR2 relay + gate (tasks and chats); PR3 schedule chat target; PR4 Google client + Connect; Bits #143 reworked and held until PR2 is live-tested. ≥2 Codex rounds per PR; Mark live-tests before any merge; nothing self-merged or released. | §6, plan. |
| D15 | **Relay, not runtime-native MCP** (interview Q1, Codex agreed). Bakin spawns each pack-declared MCP server, lists its tools, and registers one exec tool per tool; every runtime already reaches exec tools. Bakin never retries a write automatically (retries inside a provider server are a stated risk, §4.3). | §4.3. Pi's built-in MCP extension stays unused. |
| D16 | **gog MCP coverage gaps ship as gaps.** Calendar writes, Drive upload and Docs create are absent from `gog mcp` v0.48.0; they are contributed upstream, never filled with a shell path. | §10. |

## 3. Tech stack and constraints

Bun 1.4.3, TypeScript strict, zod at boundaries, React 19 + `@makinbakin/sdk`
kit. No new dependencies in bakin: the relay uses the existing `@modelcontextprotocol/sdk` Client over its stdio transport. Bits packs are `skill-pack` manifests
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
out; the GitHub pack still declares an `expect`, to capture the username
(`account (\S+) \([^)]*\)\s*\n\s*- Active account: true`) — the relay's
token command needs the account, and the first stdout line is the host.

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

### 4.2 Packs (Bits PR #143, reworked)

**Manifest addition — `mcpServers[]`** (core schema in
`packages/core/src/agent-packages/manifest.ts`; refused from hub-skill
synthesis and third-party remote refs with a typed error at install; accepted
from the official Bits refs and from a local path the operator names, which
is an operator action under D1):

```ts
mcpServers: [{
  id: 'google',                       // exec tools become bakin_exec_google_<tool>
  bin: 'gog',                         // must name one of this pack's requires.bins
  args: ['mcp', '--client', 'bakin', '--wrap-untrusted', '--allow-write', '--allow-gmail-send'],
  readonlyArgs: ['mcp', '--client', 'bakin', '--wrap-untrusted', '--readonly'],
  account: { login: 'Google account (gog)', flag: '--account' },  // account captured by that login leg
  token?: { command: ['gh', 'auth', 'token'], env: 'GITHUB_PERSONAL_ACCESS_TOKEN', prereq: 'gh' },
  tools: { /* the class table, below */ },
}]
```

`tools` maps every exposed tool to `{ class: 'read' | 'private' | 'external',
action?: '<provider>.<verb>', refuseUnless?: <argument predicate> }` or `{ byArg: '<arg>', cases: { <value>:
{class, action} }, default: {class:'external', action} }`. A tool the server
lists that the table lacks is exposed as `external` with action
`<id>.other`; a row `{ expose: false }` hides a tool entirely. Contract-tested in Bits: every tool the pinned server lists
(captured `tools/list` fixture) has a row; no `read` row on a tool whose
annotations say it writes.

**google-workspace 2.0.0** — `gog` 0.48.0 pins as rev 5 (table kept in the
pack README); login leg `gog auth list --check --json --no-input --client
bakin` with the `"valid": true` expect, `setup` = the Connect button (PR4;
until PR4 ships the terminal command). Class table:

| tool | class | action |
|---|---|---|
| gmail_search, gmail_get_message, gmail_get_thread, gmail_list_drafts, gmail_get_draft, gmail_list_labels, calendar_events, drive_search, drive_get, docs_get, sheets_read_range | read | — |
| gmail_create_draft, gmail_update_draft, gmail_create_label, gmail_mark_read, gmail_mark_unread, gmail_archive_messages | private | — |
| gmail_modify_messages, gmail_modify_thread | byArg on added labels: `TRASH`/`SPAM` → external `gmail.delete`; otherwise private | — |
| gmail_send_message | external, **exact-message rule**: refused `inexact_send` (no card) unless `to` is explicit and `reply_all`/`quote` are absent or false — gog resolves those from the live thread at send time, so the approved arguments would not fix the recipients or quoted text; `thread_id` only threads | `gmail.send` |
| gmail_send_draft | **not exposed** — a draft id does not bind its content (drafts update without a card), so sends always carry the full message | — |
| gmail_trash_messages, gmail_restore_messages | external | `gmail.delete` |
| docs_write | external | `docs.write` |
| sheets_update_range | external | `sheets.write` |

**github 2.0.0** — new bin `github-mcp-server` v2.1.0 (tar.gz, member
`github-mcp-server`, pins committed in the plan), args `['stdio',
'--toolsets=default']`, `readonlyArgs` add `--read-only`; `token` from `gh
auth token` (the existing login leg captures the active account; github.com only in this
release: the probe is `gh auth status --hostname github.com --active` and the
token command `gh auth token --hostname github.com --user <receipt account>`; stored login only — both run with `GH_TOKEN`/`GITHUB_TOKEN`/`GH_ENTERPRISE_TOKEN` unset, so an environment PAT is never used). Class table:
the 27 read-annotated default tools `read`; `create_branch`,
`create_pull_request` (draft or not), `update_pull_request`,
`update_pull_request_branch` → `github.pr`; `merge_pull_request` →
`github.merge`; `add_issue_comment`, `update_issue_comment`,
`add_reply_to_pull_request_comment`, `add_comment_to_pending_review` →
`github.comment`; `issue_write`, `sub_issue_write` → `github.issue`;
`pull_request_review_write` → `github.review`; `create_or_update_file`,
`push_files`, `delete_file` → `github.push`; `create_repository`,
`fork_repository` → `github.repo`; `assign_copilot_to_issue`,
`request_copilot_review` → `github.copilot`. All external.

**Skills** — ONE skill per pack, rewritten for the relayed tools: which tool
for which job; read discipline (opaque ids, all-day vs timed events, Sheets
overwrite semantics, Docs batch semantics); "a refused write returns
`needs_approval` — end your turn and say what you asked for"; "a write whose
result was lost is verified with a read before anything else"; never fall
back to the CLI. Context cost measured before/after (`bakin agents context`).

### 4.3 Provider relay + approval gate (bakin PR2)

**Lifecycle** (`src/core/integrations/relay.ts`): one supervisor per
installed, ready pack server. Started at boot (after capability readiness)
and on pack install/sync; stopped on remove. Spawn = the pinned bin with
`args` (or `readonlyArgs` when the pack's scope profile is read-only), the
account flag from the login receipt, the token env from `token.command` run
fresh per spawn (stdout never logged, never in receipts or errors). MCP over
stdio with a 30 s request deadline; crash → backoff restart (1 s → 60 s);
`tools/list` on every (re)connect re-registers the exec tools (removed tools
unregister). Failure states are distinct and surface in capability readiness:
`token-unavailable`, `auth-rejected` (401/403 from the server), `start-failed`.
A failed spawn never marks the login leg missing.

**Exec tools:** `bakin_exec_<serverId>_<tool>` with the class shown in the
description. PR2 extends the exec-tool contract in three ways:

- **Raw-schema tools.** Today every exec tool is a zod shape
  (`packages/core/src/plugin-types.ts`) re-rendered to JSON Schema and parsed
  through zod (`src/core/exec-tools/provider.ts`). A relayed tool instead
  registers the server's JSON Schema as-is; both transports (Pi's
  `tool-bridge.ts`, `src/core/mcp-server.ts`) declare it verbatim; Bakin only
  requires a JSON object and the provider server validates (its errors follow
  the outcome rule below: `unknown` for external calls, `failed` otherwise). Additional properties are preserved.
- **Live registry.** The registry emits add/remove events. `mcp-server.ts`
  stops snapshotting: live sessions get tools added/removed and
  `notifications/tools/list_changed`; Pi reads descriptors per turn already.
  A call to an unregistered relayed tool is refused `tool_removed` at the
  handler (covers clients that cached the old list).
- **Invocation context.** `ExecToolContext` gains `invocation: { kind:
  'task', taskId, runId } | { kind: 'chat', chatId, turnId }`, set by the
  ONE place each turn starts: dispatch (`threadId task:<id>:d<seq>` is the
  run id) and the conversation turn engine; Pi's bridge passes it per turn.
  Bakin's MCP server cannot learn it from OpenClaw today, so for MCP calls
  the relay resolves the calling agent's live turns (dispatch registry +
  conversation engine): exactly one → that invocation; none or several →
  refused `ambiguous_caller` (OpenClaw serializes same-agent dispatch, so
  this bites only when a chat and a task overlap). No caller → `no_caller`.

**Gate** (`src/core/integrations/gate.ts`), per call:
1. Classify from the table (with `byArg`). `read` → forward. `private` →
   forward unless `settings.integrations.privateNeedsApproval` is true.
2. `external`: `argsHash = sha256(canonicalJSON(args))`. Look for an
   **approved-unconsumed** approval with the same calling agent, scope (the
   task, or the chat — never a turn, since the follow-up is a new turn),
   server, account, tool and `argsHash`, not expired. A reassigned task's
   approvals do not transfer to the new agent. Found → compare-and-set
   it to `attempting` (durable, with the attempt time) BEFORE forwarding,
   then forward. Task standing
   grant for `action` → auto-approval record (audited
   `integration.approval.standing`), consumed the same way.
3. Otherwise create — or return the existing pending one for the same key —
   an approval with owner `{ kind: 'integration-action', agentId,
   taskId?: string, chatId?: string, originTurnId?: string, serverId,
   account, tool, action, argsHash }` (exactly one of `taskId`/`chatId`; `originTurnId` is
   provenance only); title `${agent} wants to ${action}`; body = the
   arguments rendered as escaped plain text (recipients, subject, body, repo,
   number); options `approve`, `approve-all` (tasks only), `reject`. Return
   `{ status: 'needs_approval', approvalId, instruction: 'End your turn.' }`.
   Tasks block with `AWAITING_APPROVAL_REASON` (schedule fire engine exempt,
   as rev 5).
4. Forward result: `attempting` → `done` on success; `unknown` on an
   external call's MCP `isError` (gog reports any subprocess failure that way,
   including a connection lost after Google accepted the send, so an error is
   not proof of no effect), on transport loss, or on deadline; `failed` only
   for read/private calls and for the relay's own refusals before forwarding. Boot reconciliation turns any `attempting` without an outcome into
   `unknown` (the crash may have landed before or after the provider acted).
   Never retried automatically by Bakin. **Below Bakin:** gog v0.48.0's
   Google transport retries replayable requests on 5xx, POST included, so a
   send that succeeded upstream but answered 5xx can repeat under one
   approval. PR2 contributes a gog fix (no retry for non-idempotent methods)
   and repins when it lands; until then this is a stated risk on `gmail.send`
   (rare, needs a Google 5xx after acceptance), recorded in the pack README.
   github-mcp-server's client retry behavior is checked the same way before
   PR2's live test. The next turn's resume section presents
   `unknown` as "verify with a read before anything else".

**Expiry:** an approved-unconsumed approval expires 24 h after the decision
or when its anchor ends (task done/archived/deleted; chat deleted). Expired
or superseded → a fresh card.

**Apply after commit** (rev 5 machinery, re-homed from the tasks plugin to
core): `onResolve` validates only (anchor live, still pending); ONE idempotent
`applyCommittedApproval(record)` runs from the `approval.resolved`
subscriber and boot reconciliation, with plugin-state replaced by a core
sidecar per approval (`pending → applying → approved-unconsumed | rejected`,
then `attempting → done | failed | unknown`, or `expired`). Task anchor: log entry, `approve-all` adds the class to
`approvedActions`, blocked → todo, `triggerDispatch`. Chat anchor: enqueue
ONE follow-up turn through a new chat hook `chat.enqueueFollowUp({ chatId,
admissionKey: approvalId, message })`. The conversation queue today mints
random ids and may drain twice after a crash (`packages/core/src/conversation/turns.ts`),
so PR2 adds a durable admission key: a second enqueue with the same key is a
no-op, and the transcript records the key on the user row so a crashed drain
cannot run it twice. Messages go as a system-authored message "Approved: <action> — <summary>. Make
that exact call now." (reject: "Rejected: <reason>. Do not make that call.").

**Standing grants** keep rev 5's field (`approvedActions` on tasks and
task-target schedule jobs), provenance policy (`assertOperatorDecision` on
every human entry path; exec tools never expose it), audit and lifecycle.

**Dispatch resume section** (tasks): standing grants; the actionable
approval (approved-unconsumed → "make exactly this call again"; pending →
stop; unknown outcome → verify first) with its tool and arguments; older
decisions as one-liners within a 1 KB budget. Pinned by dispatch-prompt
fixtures.

**Approval consumers that assume a task** (`packages/core/src/approvals/store.ts`
filters on `owner.taskId`, `plugins/tasks/hooks/use-task-approvals.ts` groups
by it, `approvals-attention-provider.tsx` drops events without it, Discord
cards link to the task): each resolves the anchor explicitly — task cards
keep today's paths; chat cards filter by `chatId`, link to `/chat/$chatId`,
and announce through the same provider.

**Channel cards:** Bakin's Discord bridge renders all three options.
OpenClaw's native delivery only round-trips exactly `approve`/`reject`
(`packages/adapter-openclaw/src/approval-helpers.ts`), so there the card
offers those two and says "Approve all is on the board".

**UI:** the ApprovalPanel renders `integration-action` with the argument
preview; `approve-all` keeps its distinct caption. Chat renders the same
card inline under the turn that asked (conversation kit, no hand-rolled
rendering). Standing grants: the token list from rev 5.

### 4.4 Schedule chat target (bakin PR3)

Unchanged from rev 5 except: an external call inside a scheduled chat turn uses the chat card (§4.3), and its follow-up turn rides the same chat.

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

### 4.5 Bakin-owned Google client + Connect (bakin PR4)

**Client.** One Google Cloud project owned by Mark ("Bakin"), consent screen
**External**, a **Desktop** OAuth client (loopback + PKCE). Its id and secret
ship in Bakin (`packages/core/src/integrations/google-client.ts`; a desktop
client secret is not confidential by Google's own definition). On pack
install/sync Bakin registers it into gog as client `bakin` (idempotent;
compared by client id). Until verification: the "unverified app" warning and a
100-user cap — stated in the Connect dialog.

**Verification** (Mark, outside the code): homepage + privacy policy on a
domain Mark controls, scope justification, demo video; Gmail scopes are
restricted, so verification includes the annual third-party security
assessment. Scopes requested = what the relayed tools need, no more (the plan
pins the exact gog `--services`/`--gmail-scope`/`--drive-scope` values).

**Connect flow** (Explore's installed card and the runtime hub's
Capabilities tab, one ConfirmDialog-hosted flow):
1. The dialog asks for the Google account email first (gog requires it and
   rejects a consent for a different identity), then explains, BEFORE
   opening Google: "Google's last page will fail
   to load — that is expected. Copy its full address and paste it here." Access
   choice: **Full** (default) or **Read-only** (sets the pack's scope profile →
   `readonlyArgs` + gog's read-only scopes).
2. `POST /api/integrations/google/connect { email, access }` (declared
   operator provenance; agent contexts refused, #898) runs `gog auth add
   <email> --client bakin --remote --step 1` with the scope flags frozen for
   the attempt, and returns the consent URL plus an unguessable `attemptId`.
   ONE attempt at a time: a new attempt cancels the previous (gog reuses its
   pending state per client + scopes, so concurrent attempts would share it).
   The attempt records gog's `state` value and inherits gog's own state
   expiry, shown in the dialog. Single-user Bakin has no browser sessions to
   bind to; the attempt id is a single-use secret held only by the dialog.
3. Browser opens the URL in a new tab; the user consents; the redirect to
   127.0.0.1 fails; the user pastes the address.
4. `POST /api/integrations/google/connect/:attemptId` checks the pasted
   URL's `state` equals the attempt's, then runs step 2 with the same email
   and flags and `--auth-url <pasted>` (never logged); the attempt is
   consumed; the connected email becomes the pack's **explicit account
   selection** (the login leg's `accountEnv` value, persisted in pack state and
   part of the receipt's invalidation key; PR4 extends `login-verify.ts`, which reads `accountEnv` only from `process.env` today, to prefer the persisted selection), so a second stored account can
   never be picked instead; then the login check for exactly that
   account; the leg turns ready and the relay (re)spawns on it.
The terminal command stays in the card as the fallback. Plan verifies gog's
step-1/step-2 state handling on the pinned build before relying on it.

### 4.6 Deliberately not built

Runtime-native MCP config or per-runtime hooks (D15), Pi's built-in MCP or
codemode extensions, a native-plugin install lane, connection inventory UI,
vault, token broker, provider wrappers, a shell-command classifier, per-agent
grants, chat standing grants, Linux validation (pins declared, untested stays
untested), redaction, shipped schedule jobs.

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
PR1   as built (#1087): login schema, login-verify engine + receipts, readiness leg, login-check API/CLI, consent + CLI screens
Fix   src/core/skill-hub/* (paste-a-link refuses Pi/OpenClaw plugin bundles presented as skills) + tests
PR2   packages/core/src/agent-packages/manifest.ts (mcpServers schema, official-source rule)
      packages/core/src/approvals/{types,schema}.ts (integration-action owner)
      src/core/integrations/{relay,gate,classify,apply,resume}.ts (NEW); src/core/exec-tools/registry.ts (dynamic register/unregister)
      src/core/agent-packages/capability-readiness.ts (server states)
      packages/sdk/src/types/services.ts + packages/core/src/tasks/{store,public-task}.ts (approvedActions)
      plugins/tasks/components/{task-detail-modes,approval-panel}.tsx; plugins/chat/{lib/stream-bridge.ts,components/*} (inline card, follow-up turn)
      plugins/schedule/{types.ts,lib/fire-engine.ts,lib/job-service.ts,lib/routes/*,components/job-form.tsx} (grants + exempt reason)
      src/core/dispatch-prompts.ts (+ fixtures); src/cli/commands/tasks.ts
      tests/core/integrations/* (fake MCP server fixture), tests/plugins/{tasks,chat,schedule}/*, tests/core/dispatch-prompts*
PR3   ledger + schedule chat target as rev 5 §4.4
PR4   packages/core/src/integrations/google-client.ts; packages/host/src/api/integrations/google/*; plugins/explore + runtime hub Connect dialog
Docs  .claude/knowledge/{capability-packs,approvals,tasks-plugin,bakin-owned-scheduler,chat-plugin,agent-packages}.md
      .claude/knowledge/provider-integrations.md (NEW: relay, classes, gate, Google client); CLAUDE.md pointer; README if it lists capabilities
      docs/src/content/docs/extending/agents/packages.md (mcpServers)
Bits  packs/{google-workspace,github}/** (mcpServers, class tables, new skills), packs/pack-contract.test.ts (+ tools/list fixtures)
```

## 7. Code style

```ts
// src/core/integrations/gate.ts — one gate, typed refusals, no message parsing
export type CallClass = 'read' | 'private' | 'external'
export const AWAITING_APPROVAL_REASON = 'Awaiting approval'

export function argsHash(args: Record<string, unknown>): string {
  return new Bun.CryptoHasher('sha256').update(canonicalJson(args)).digest('hex')
}
```

`createLogger('integrations-relay')`; zod at boundaries; typed errors;
identifiers never display names; `const` over `let`; kebab-case files.

## 8. Testing strategy

- **Unit** — classify: every table row, `byArg` cases, unknown tool →
  external. Gate: read/private forward, private tightened by settings,
  external refused with one card per key (retry returns the same approval),
  approve → one matching call passes and a second is refused, changed args
  refused, expiry, standing grant, consume-before-forward under a concurrent
  double call, outcome `unknown` on transport loss and on an external
  `isError` after a simulated committed effect, no automatic retry. Connect
  (PR4): with two stored accounts the persisted selection wins, survives a
  restart, and invalidates the receipt when it changes.
  Apply: task (log, grant, move, dispatch) and chat (one follow-up turn,
  deduped across replays and a crashed drain) anchors; boot reconciliation
  over `pending`, `applying` and outcome-less `attempting` (crash injected
  before and after the provider call). Exec-tool contract: raw-schema
  declaration on both transports, live add/remove reaching a connected MCP
  session, invocation context per transport, `ambiguous_caller`. Relay: spawn args by profile, token env present only in the
  child and absent from logs, crash restart, tool re-registration, distinct
  failure states.
- **Integration** — a fake stdio MCP server fixture (one read, one private,
  one external tool, every call logged) behind the real relay; `verify` boot
  (Pi pinned, dispatch paused) drives `bakin_exec_*` through the exec-tool
  path for both runtimes' surfaces (Pi bridge, Bakin MCP server).
- **Architecture/contract** — public-api schema; dispatch-prompt fixtures;
  Bits pack contract incl. `tools/list` fixtures for the pinned servers.
- **UI** — RTL for the integration card (task panel + inline chat), grants
  token list, Connect dialog; `ui:conformance --quick` per PR, full on PR4.
- **Runtime check** — OpenClaw receives relayed tools through Bakin's MCP
  server on the dockerized rig (`bun run instance up --runtime openclaw`).
- **Live acceptance (Mark, 3737)** — W1 after Bits+PR1 and again on PR2;
  W2–W4 after PR2; W5 after PR3; W6 after PR4.

## 9. Boundaries

- **Always:** mock both content-dir resolvers + OpenClaw home; lint +
  typecheck + touched tests before each commit; `ui:conformance --quick` for
  UI; knowledge docs in the same PR; Bits pack versions bumped in the same PR;
  provider semantics in pack tables and skills, never core; every grant
  mutation through `assertOperatorDecision`; tokens only in a child's env.
- **Ask first:** new dependency; ledger schema changes beyond §4.4; a
  different gog or github-mcp-server pin; any merge, release, or anything on
  margo.
- **Never:** self-merge or release; edit the live `~/.openclaw`/`~/.bakin` by
  hand; retry a write automatically from Bakin; trust server annotations for gating;
  accept `mcpServers` from a non-official source; put tokens, OAuth JSON or
  pasted redirect URLs in the repo, assets, logs or chat.

## 10. Follow-ups recorded, not built

- **gog send retries** — upstream no-retry for non-idempotent methods, then
  repin (§4.3 stated risk).
- **gog MCP gaps** — calendar create/update/respond, Drive upload, Docs
  create: contribute upstream (gog is MIT), then add table rows.
- **Google verification** — Mark's track (§4.5); the unverified cap holds
  until it lands.
- **Microsoft 365 pack** — Softeria's MCP server now fits the relay; needs a
  test tenant.
- **Jira Cloud pack** — Atlassian's MCP server or ACLI; terms review first.
- **Hermes runtime** — gets relayed tools through the exec-tool path with no
  integration work; nothing to build here.
- **GitHub Enterprise hosts** — host capture in the login receipt, then
  host-bound probe and token.
- **gh as a pinned bin** — needs zip support in the bin installer.
- **Per-agent grants, chat standing grants** — declined for now (D6).
- **Workflow-task approvals** — a workflow-anchored card later.
- **Chat queue for scheduled turns**, **scheduler bookkeeping after attach**,
  **orphan chat on create-then-crash** — as rev 5.

## 11. Open questions

None blocking. Plan-stage choices: exact gog scopes for verification; the
github-mcp-server pins; the SDK composition for the inline chat card and the
grants token list (conformance skill decides); whether `{fireAt}` joins or
replaces `{date}`.

