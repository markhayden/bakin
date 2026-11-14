# Spike: runtime-native integrations vs Bakin packs (2026-11-14)

**Question (Mark):** every runtime Bakin supports — OpenClaw, Pi, later Hermes —
has its own plugin and skill ecosystem. Should Bakin integrate providers such as
Google and GitHub by installing vetted runtime-native plugins through an adapter
layer ("capability X: on OpenClaw use A, on Pi use B, on Hermes use C", one
Integrate button in Bakin), and roll its own only where natives fall short?

**Why this spike exists:** the research handoff listed "use an audited existing
OpenClaw plugin/MCP server or Pi extension" as its first option and inventoried
candidates, but spec rev 5 started from the existing Bits `gog`/`gh` packs and
never put that choice to Mark. The spec also recorded Mark's sign-in answer
("it should support any user just logging in") as a bring-your-own internal
client (D12), which it is not.

Method: three read-only researchers (Pi SDK 1.0.2 + Bakin's Pi adapter;
OpenClaw 2026.9.5 install + Bakin's OpenClaw adapter; provider vetting with
registry/GitHub data pulled 2026-11-14), then a Codex review of the synthesis
(verdict: agree with changes, folded in below). Nothing was installed, run or
signed in to.

## Findings

### 1. The ecosystems' own Google and GitHub integrations are mostly `gog` and `gh`

- **OpenClaw** ships bundled `gog`, `github` and `gh-issues` skills — prose that
  tells the agent to run `gog …` / `gh …` through `exec`, guarded only by "confirm
  before sending". Its bundled GitHub plugin reads public repositories only.
  Community Google plugins exist (`@tensorfold/openclaw-google-workspace`, 24
  typed tools; others) with low adoption and no approval story; one has no
  licence or repository. ClawHub names `gog`/`github` are published by 6–8
  different owners — install by bare name is unsafe.
- **Pi** Google packages fail the bar. The most adopted, `pi-google-services`
  (174 downloads/week, 6 stars): shared unverified OAuth client (100-user cap),
  requests every scope including restricted Gmail/Drive read, its npm tarball
  omits the extension its manifest points to, its postinstall edits
  `~/.pi/agent/mcp.json` and `~/.local/bin` at a hard-coded home (ignoring
  `PI_HOME`), and its tokens sit where the agent's shell can read them. The
  others are stale, unreleased, one generic tool, or have no repository. Pi
  GitHub packages are CI/status helpers wrapping `gh`.
- **Runtime-neutral:** `gog` (OpenClaw org, MIT, ~weekly releases with
  checksums, signed macOS binaries; bring-your-own OAuth client), `gh`
  (official, artifact attestations), `github-mcp-server` (official; every tool
  carries `readOnlyHint`; server-enforced `--read-only`), `workspace-mcp`
  (most-adopted Google MCP, Python, tokens in plain JSON, `manage_*` tools hide
  the action in an argument). Google's own hosted MCP is a developer preview and
  hosted; `gws` has been dormant since 2026-03-31.

Full tables and sources: the researchers' notes (`provider-findings.md`,
`pi-findings.md`, `openclaw-findings.md`) were scratch files for this session;
the evidence that matters is reproduced here.

### 2. Every runtime can intercept tool calls — as defense in depth, not a boundary

| | Hook | See name + args | Block | Hold for a human |
|---|---|---|---|---|
| Pi 1.0.2 (in-process) | `tool_call` extension event; a Bakin inline extension loads after third-party ones | yes | yes | awaited with no timeout, but a held call pins a live turn, dies on restart and trips the 30-min watchdog |
| OpenClaw 2026.9.5 | `before_tool_call`; trusted tool policy (`registerTrustedToolPolicy`) runs first; errors fail closed | yes | yes | native `requireApproval` caps at 10 min and is likely refused for Bakin's channel-less turns; exec approvals are truly async but cover host shell only |
| Hermes (docs, unpinned) | `pre_tool_call`; `pre_approval_request`/`post_approval_response` | yes | yes (`block`) | `approve` escalates to Hermes's own approval gate; callback exceptions are logged and skipped (fail-open) |

What a hook can and cannot do (Codex):
- It catches the cooperative failure — the agent forgets to ask before
  `gog gmail send`. That is a real improvement over prose alone.
- It is **not** an authorization boundary. Bash can do anything; tokens `gog`
  and the plugins store are readable from the agent's shell; Pi extensions and
  OpenClaw plugins are unsandboxed code in the server/gateway process; and
  Bakin's approval API accepts `X-Bakin-Operator: declared` from any local
  caller without an agent marker, so an agent shell can impersonate the
  operator (`packages/core/src/approvals/provenance.ts:6,47`). The signed-off
  spec (D1–D3) deliberately accepted this trusted-operator posture.
- A blocked call returns an error to the model; it does not park the task or
  stop sibling calls in the same batch. Durable pending state needs dispatcher
  integration and restart recovery.
- Approval must bind the call that actually runs. On OpenClaw, ordinary hooks
  can still rewrite params after a trusted-policy decision.

A durable "approve then run once" needs an operation identity, not "same tool +
same args hash": file-backed bodies (`--body-file`), existing drafts
(`send draft-123`), executable/account/repo resolution and legitimate repeats
all break that. PR2's spec already has the right machinery
(`approved-unconsumed → attempting → done/failed/unknown`, verify-first
recovery); consume the grant atomically before the effect.

### 3. The strongest native path is runtime-native MCP, not per-runtime plugins

Each runtime already has (or can enable) an MCP client:
- **Pi:** the SDK exports `createMcpExtension` (built-in; MCP tools become
  `mcp__<server>__<tool>` and pass the `tool_call` hook). Bakin's adapter does
  not load it today, so `mcp.json` adds nothing in Bakin. No third-party bridge
  is needed (this corrects the provider notes, which assumed `pi-mcp-adapter`).
- **OpenClaw:** native `mcp.servers.<name>`, hot-reloaded; Bakin already
  provisions its own MCP server this way.
- **Hermes:** native MCP client.

So "one vetted local server, each runtime connects natively" serves all three
with typed tools — which makes approval classification and payload binding far
simpler than parsing shell strings. Candidates: `gog mcp` (same binary and
auth as the pack, read-only by default, but narrower — e.g. Calendar is
read-only) and `github-mcp-server` (official; read-only mode; its OAuth token is
in-memory only, so unattended use needs a PAT). Typed tools do not by themselves
keep credentials away from a same-user shell.

### 4. Installing native plugins from Bakin is possible but not free

- **OpenClaw** has a strong install path Bakin could drive: npm/ClawHub/git
  sources, dependencies installed with `--ignore-scripts`, exact pins, ClawHub
  digest + npm integrity, `expectedIntegrity` on the install RPC, an operator
  `security.installPolicy` hook, hot reload. Gap: the RPCs need
  `operator.admin`, which Bakin's gateway client requests only optionally.
- **Pi** exports `DefaultPackageManager` (exact versions are honoured), but runs
  npm lifecycle scripts by default and adds no integrity or dependency
  admission; Bakin sets `PI_OFFLINE=1`, so Pi-driven installs are off inside
  Bakin. Bakin's extension trust lane hashes only the entry file, not the
  imported dependency tree. A curated Pi install lane would need dependency
  closure, script-free install, protected install state and upgrade/revocation
  rules — evaluate reusing Bakin's script-free npm payload installer first.
- **Paste-a-link today** wraps any repository with a root `SKILL.md` as a skill.
  `pi-google-services` would install as a 61-file "skill" whose instructions
  name 36 tools the agent does not have. The lane should refuse executable
  runtime-plugin bundles presented as skills (a Pi package manifest, an
  OpenClaw plugin manifest) — not blanket-refuse skill-only Pi content.

### 5. Google sign-in for other users needs a Bakin-owned client

Every Pi model-provider login reuses a vendor's first-party CLI client; no
first-party Google Workspace CLI client exists to reuse. `pi-google-services`
ships its author's unverified client (warning screen, 100-user cap, shared
quota, single suspension point). For Bakin users who will not create a Cloud
project, Bakin must own a desktop OAuth client (loopback + PKCE, tokens local,
no Bakin server) handed to `gog`, with bring-your-own as the override.
Caveats: Workspace admins can still block consent; restricted Gmail scopes
need verification plus an annual security assessment for external users, and
the assessment must account for mail content reaching model providers. A
service list is not a scope design: `gog`'s Gmail and Drive defaults stay
`full`; scope profiles must be defined against real operations and tested
(`drive.file` still permits writes; Gmail read/send do not cover every draft or
label flow). Unverified claim to check: a README says Google locks an
"AI-powered agent" OAuth-client setting on clients created after 2026-11-12.

## Recommendation

1. **Keep the adapter shape** — a capability maps to one curated provider per
   runtime, with one Bakin readiness/login/Health view — and keep the `gog`/`gh`
   packs as the provisional default. They are what the ecosystems themselves
   use for Google and GitHub; no runtime-native plugin beats them today.
2. **Evaluate local MCP before building a shell classifier.** Fixture-test Pi's
   built-in MCP extension and OpenClaw's native MCP against `gog mcp` and
   `github-mcp-server`: coverage gaps, connection lifecycle in the compiled
   binary, and how typed tools flow through each runtime's hook.
3. **Decide the approval promise** (below) and redesign PR2 around it, keeping
   its durable operation/recovery machinery.
4. **Fix paste-a-link** to refuse runtime-plugin bundles presented as skills.
5. **Replace D12** with a Bakin-owned Google client, scope profiles and a
   verification plan.
6. **PR1 stands** as a login fact. It must not imply authorization readiness
   (scopes, resource access, guard active) — add those checks where the new
   contract promises them.
7. **Re-check PR3:** PR2 requires a live task and rejects workflow tasks;
   scheduled chat turns that hit a write need a defined behavior under any
   guard.
8. **Defer a native-plugin install lane** until a capability needs one.
   OpenClaw's path is ready to drive; Pi's needs real admission work.

## Decisions for Mark

- **A. The approval promise.** (a) *Cooperative:* agents ask first, runtime
  hooks catch forgotten asks, a determined agent can still bypass (matches
  today's trusted-operator D1–D3). (b) *Enforced:* writes run only through a
  Bakin executor that holds the credentials; agents never see tokens; approval
  API authenticated against agents; shell isolated. (b) reverses D3 ("the agent
  executes after approval") and is substantially more work.
- **B. Integration surface.** CLI packs through the shell (today), or local MCP
  servers each runtime connects to natively (typed tools, narrower coverage),
  pending the fixture evaluation in Recommendation 2.
- **C. Google for other users.** Bakin-owned client now, unverified (warning +
  100-user cap) until verification; and whether Gmail *reading* (restricted,
  annual assessment) ships at launch or after.
