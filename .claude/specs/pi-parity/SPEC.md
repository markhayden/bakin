# Pi Runtime Parity — Spec

Status: SHIPPED (P1 #662, P2 #664, P3 #666, P4 #667, P5 below; battery §14)
Date: 2026-07-12
Owner: Mark (single-user dev box today; spec assumes net-new customer machines)
Inputs: capability audit `48bd30af`, gap ranking `2535726f` (assets
`20260709-pi-openclaw-capability-audit-da2fa210`,
`20260709-pi-adapter-gap-ranking-triage-e9c6b8af`), fresh codebase exploration
2026-07-12 (post-#630/#657 state), **P0 web-search spike results (§11)**.

Revision history:
- v1: full-parity mega-spec incl. Discord bridge.
- v2: Discord/channel bridge deferred to its own initiative (architecture
  reserved, §10); task-completion parity adopted as the north star.
- v3: post-spike — "runtime packages contract member" replaced by
  **capability packs** riding the existing agent-packages system; Pi
  extension trust lane deferred to reserved architecture; ecosystem taxonomy
  rules added (§4.1).

## 1. Objective

Close the real capability gaps between the Pi runtime and the OpenClaw-backed
runtime so Pi is a first-class daily driver, and rebuild the `/runtime` page
into a polished runtime hub. "Real gap" is measured against what OpenClaw
actually provided — not against imagined governance upgrades (see Non-goals).

**North star: task-completion parity.** The measure of done is that a task
dispatched to a Pi agent completes wherever the equivalent task completed on
OpenClaw (research needing web search, media tasks, scheduled work, gated
workflows, subagent fan-out). Every phase is prioritized by how directly it
makes tasks complete.

**Net-new machine principle.** The spike (§11) worked because this box had
leftover OpenClaw-era state (`bx` binary + key). A fresh Bakin install has
none of that. Bakin — UI and CLI — owns the entire path from "agents can't
search the web" to "doctor green": discover → consent → install content →
install pinned binaries → guided key entry → honest readiness. Users never
clone repos, edit shell profiles, or "figure it out."

After this initiative, on Pi (and equally on OpenClaw, since the vehicle is
runtime-neutral):

- **Capability packs** (web search first; browser automation, transcription
  as fast-follow curation) are installable from Explore/onboarding/CLI with
  consent, pinned trusted upstreams, Bakin-installed binaries, guided key
  entry, and per-capability doctor readiness.
- Integration secrets live in the existing masked secret store, env-first,
  injected so skills just work.
- Pending approvals surface **in-app** (nav badge + toast/OS notification) —
  approvals are never silent even with no channel layer.
- Per-agent **subagent model routing** works on Pi and carries across runtime
  switches.
- `/runtime` is a tabbed hub (Overview / Capabilities / Switch) built on the
  SDK component kit at the explore/health/chat polish bar.
- Channel delivery stays honestly `unavailable`; the Discord bridge and the
  Pi-extension trust lane are reserved architecture (§10).

### Verdict on the ranked gap list (decision log)

| Rank | Gap | Decision |
|---:|---|---|
| 1 | Discord/channel bridge | **Deferred to its own initiative** — architecture reserved (§10, D2) |
| 2 | Approval delivery | **Partial build** — in-app attention now (D8); Discord buttons ride the deferred bridge |
| 3 | Integration secrets/status | **Build** — extend existing secret store, not a new system (D10) |
| 4 | Integration observability | **Build (scoped)** — per-capability readiness/doctor checks now; delivery audit rides the deferred bridge (D11) |
| 5 | Web search/browse | **Capability packs** — curated skill-packs on the existing agent-packages system (D3/D4, proven by spike §11) |
| 6 | GitHub | **Close as at-parity** — `gh` readiness doctor check + managed-context guidance only (D7) |
| 7 | Email/Gmail | **Deferred entirely** to a future initiative (D6; note: upstream `gmcli` skill exists — likely a capability pack + governance plugin composition later) |
| 8 | Other social channels | **Out** — Discord-only when the bridge lands; abstraction stays provider-neutral (D1) |
| 9 | Native cron | **Bakin schedules are the answer** + switch-time adoption helper (D5) |
| 10 | `tools.invoke` parity | **Moot** — surface was deleted from the contract (T29/T30) |
| 11 | Subagent model routing | **Build** — small, Pi registry is Bakin-owned (D9) |

## 2. Decisions (interview record, 2026-07-12)

- **D1 — Channels: Discord only, deferred.** When the bridge initiative runs,
  Discord is the only implemented provider; the channel abstraction (existing
  `runtime.channels` contract) stays provider-neutral.
- **D2 — Channels architecture: shared Bakin bridge (reserved).** Runtime-
  neutral Discord bridge in `src/core/delivery/`; `adapter-pi` delegates the
  existing `channels` contract member to it, reports `delivery: 'shimmed'`.
  Consumers untouched. Full reserved design in §10.
- **D3 — Per-turn capabilities: ecosystem-first.** Web search, browser
  automation, transcription etc. come from the skills ecosystem — Bakin
  builds **zero** redundant `bakin_exec_*` wrappers. Validated by spike §11:
  a single SKILL.md delivered full web-search task parity. Hard boundary:
  Pi extensions are session-scoped (SDK bans background resources; the
  adapter disposes sessions per turn) — daemons are structurally impossible
  as Pi content, so bridges stay Bakin-side.
- **D4 — Delivery vehicle: capability packs on agent-packages (v3,
  supersedes the v1 `packages?` contract member).** A capability pack is an
  agent package `kind: "skill-pack"` curated in `bakin-bits-official`, with
  manifest extensions:
  - `capability`: slug for catalog/facets/readiness (`web-search`, …)
  - `upstream`: trusted source repo + pinned ref/sha + path; content-hash
    verified at install; `bakin packages upgrade` re-pins deliberately —
    upstream drift never lands silently
  - `requires.bins[]`: binaries with pinned per-OS/arch download URLs +
    sha256 — **Bakin installs them** (the `bakin install search` pattern) to
    a Bakin-owned bin dir
  - `requires.env[]`: env var → secret-store slot + help URL — drives the
    guided key prompt and readiness
  - `runtimes`: `["*"]` normally (skills are a cross-runtime convention,
    projected via the existing `runtime.skills` surface); runtime-specific
    packs tag explicitly; Explore filters/badges against the ACTIVE runtime
  No new contract member, no new install machinery: install/lockfile/
  sidecars/sync/receipts/Explore all already exist for agent packages.
  Packs are à-la-carte: one capability per pack.
- **D5 — Cron: Bakin schedules are THE answer.** No fake `runtime.cron` on
  Pi. Agents already self-schedule via `bakin_exec_schedule_*` (verified:
  `plugins/schedule/lib/exec-tools.ts`). Scope adds: (a) verify dispatch/
  AGENTS.md context actually teaches the schedule tools, (b) a one-time
  "adopt OpenClaw cron jobs into Bakin schedules" helper offered during
  runtime switch.
- **D6 — Email: deferred entirely.** Future initiative; likely a capability
  pack (upstream `gmcli`) composed with a governance plugin per the
  composition rule in §4.1.
- **D7 — GitHub: readiness + guidance only.** OpenClaw never had a governed
  GitHub surface either (agents shell `gh` on both runtimes); the git plugin
  covers worktree isolation. Add a doctor check (`gh` installed +
  authenticated) and managed-context guidance.
- **D8 — Approvals: in-app attention now; Discord buttons later.** Pending
  approvals ride the existing `nav-badge-providers` slot (badge + toast/
  chime/OS notification, deep link to the gate). The durable Bakin approval
  record remains the sole authority.
- **D9 — Subagent model routing on Pi: include.** Store `subagentModel` in
  the Pi registry, honor it in session assembly, flip
  `routingSupport().perAgentSubagentModel` to true; switch carry maps both
  directions.
- **D10 — Secrets: extend the existing store.** `~/.bakin/secrets.json`
  (0600, atomic, env-first, masked `/api/secrets`, provider-keys UI)
  generalizes from `{ apiKey }` to named secrets per integration
  (`brave.apiKey`, later `discord.botToken`). Boot-time env injection
  (unset-only) makes stored keys visible to skills expecting env vars.
  Single-user tradeoff documented: injected env is readable by agent shell
  commands.
- **D11 — Observability rides existing engines.** Per-capability readiness
  via plugin-registered doctor checks; typed error kinds; usage/audit through
  the existing single engines. Delivery audit + ledger send-dedupe are built
  with the bridge (§10). No parallel systems, ever.
- **D12 — Pi extension trust lane: deferred (v3; was allowlist-flip).**
  Nothing in task-completion parity needs an in-process Pi extension —
  search/browser/transcribe are all skills. The allowlist/trust design
  (default `allowlist`, Bakin-consented installs auto-append, terminal
  installs pending with approve UI) is banked in §10 and activates when a
  real extension need appears. Until then the `piExtensions` policy knob
  stays as-is with nothing installed.
- **D13 — Runtime IA: tabbed hub; config in Settings.** `/runtime` =
  Overview / Capabilities / Switch (§4.5). Integration secrets live in the
  Settings surface (provider-keys tab generalized to Integrations & Keys);
  the runtime page links with status chips.
- **D14 — Delivery: one PR per phase.** Branch → PR → merge, conventional
  commits, main stays shippable, rollback = revert one PR.
- **D15 — Taxonomy: plugins vs capability packs vs agents (v3).** See §4.1.
  The rule is consumer-based and documented in the extending docs; Explore
  presents three shelves with plain-language subtitles.

## 3. Non-goals

- The Discord/channel bridge, channel approval buttons, and the Pi-extension
  trust surface (deferred — §10). Email/Gmail (D6). Slack/Telegram/social.
- Governed GitHub exec tools / repo allowlists (D7).
- `runtime.cron` on Pi (D5); `tools.invoke` (deleted surface).
- Bakin-owned web-search/fetch exec tools (D3).
- A new `packages?` runtime contract member or any parallel package-manager
  surface (superseded by D4; reserved in §10 if extensions ever need it).
- Cross-provider model fallback chains on Pi (P0-adjudicated non-goal, §11 —
  revisit on the first real sustained-outage incident).
- Backwards compatibility or migration shims — delete and replace cleanly
  (standing priority: reduce tech debt).

## 4. Architecture

### 4.1 Ecosystem taxonomy (D15)

One rule: **who consumes it.**

| Primitive | Consumer | Ships | Example |
|---|---|---|---|
| Plugin | Bakin (server + browser) | Code: UI, routes, exec tools, health checks | chat, images |
| Capability pack (skill-pack) | Agents (runtime reads it) | Content: SKILL.md + `requires` declarations | web-search-brave |
| Agent package (kind: agent) | Team roster | Identity + persona content | nemo, zen |

Boundary rules:
- **Coupling rule:** a skill that teaches agents to use a plugin's own exec
  tools ships WITH that plugin (e.g. images' `create-image` skills). A
  standalone skill wrapping external tools ships as a capability pack
  (e.g. bx-search). The original plugin intent ("plugins may install a
  simple skill") stays true, scoped to plugin-coupled skills.
- **No in-process code in packs:** capability-pack scripts execute as agent
  shell commands in agent workspaces, never inside Bakin's process.
  In-process code is a plugin (Bakin-side) or a Pi extension (§10 lane).
- **Composition rule:** a capability needing both UI/governance AND agent
  content ships as a plugin that declares a companion capability pack — two
  artifacts, each in its lane (future email = gmcli pack + governance
  plugin).
- **Explore IA:** three shelves — Agents ("add a team member"), Plugins
  ("add features to your dashboard"), Capabilities ("teach your agents new
  tricks"). Catalog v2 `kind` + new `capability` tag + `runtimes` facet.

### 4.2 Capability packs (D4)

Manifest sketch (`bakin-bits-official/packs/web-search-brave/bakin-package.json`):

```jsonc
{
  "kind": "skill-pack",
  "capability": "web-search",
  "upstream": { "repo": "github.com/badlogic/pi-skills", "ref": "<sha>", "path": "brave-search" },
  "requires": {
    "bins": [{ "name": "bx", "install": { "darwin-arm64": { "url": "…", "sha256": "…" } } }],
    "env": [{ "name": "BRAVE_SEARCH_API_KEY", "secret": "brave.apiKey", "help": "https://api-dashboard.search.brave.com" }]
  },
  "runtimes": ["*"]
}
```

Install flow (Explore card / onboarding recommendation / `bakin packages
install`): consent (source, what runs where) → project skill content via the
existing agent-packages projection (`runtime.skills` — lands where the ACTIVE
runtime reads skills; both runtimes supported by construction) → install
declared bins (pinned, sha256-verified, Bakin-owned bin dir; PATH handling at
dispatch) → guided key entry (UI dialog / CLI prompt → secret store → env
injection) → readiness green. Skippable key ⇒ honest "installed, needs key"
state. Doctor: per-capability readiness check (content projected ✓ / bin ✓ /
key ✓) with one-click remediation links.

First curated pack: **web-search-brave** (spike-validated content). Fast
follows (curation only, no new machinery): browser-tools, transcribe,
youtube-transcript.

### 4.3 Secrets & readiness

- Secret store: `providers.<id>` → named secrets (`Record<string,string>`);
  `/api/secrets` gains the secret-name dimension; provider-keys tab
  generalizes to **Integrations & Keys** (status per integration: env /
  store / missing; values never leave the server).
- Boot env injection: for env vars declared by installed packs (+ static
  map), `process.env[VAR] ??= stored`.
- Doctor: `capability.<slug>` readiness checks; `github.readiness`.

### 4.4 In-app approval attention

Pending-approvals provider on the global `nav-badge-providers` slot: badge
count, toast/chime/OS notification on new pending approval, deep link to the
gate. Runtime-neutral; becomes the always-on companion to channel delivery
when the bridge lands.

### 4.5 `/runtime` hub rebuild

- Rebuild `packages/host/src/routes/runtime.tsx` (417 hand-rolled lines) on
  the SDK kit: `PluginHeader`, `Card`, `UnderlineTabs`, `Badge`,
  `ConfirmDialog`, `Skeleton`, `EmptyState`, `ErrorBanner`.
- Tabs: **Overview** (adapter + version, capability cards with a
  native/shimmed/unavailable legend, credential tiles, tool-access status),
  **Capabilities** (installed capability packs with readiness chips +
  remediation links; browse/install hands off to Explore's Capabilities
  shelf), **Switch** (adapter pickers, ConfirmDialog, live SSE progress,
  result as grouped carried/warnings/failures cards — no glyph prose).
- Independent per-section fetch/fault (health-page pattern), URL-backed tab
  state via `useQueryState`, Suspense-wrapped, `data-testid` hooks kept.

### 4.6 Long tail

- Pi subagent model routing (D9).
- Switch-time OpenClaw cron adoption (D5): preview in dry-run report; never
  automatic.
- Dispatch-context check: schedule exec tools taught in composed context
  (byte-fixture test).

## 5. Phases & commit strategy (D14)

One branch + PR per phase; conventional commits; every phase leaves main
shippable and independently revertable; checkpoint-sized commits, each green
on `bun run test`.

| Phase | Branch | Contents | Natural rollback point |
|---|---|---|---|
| P0 Spike & adjudication (DONE/in progress) | n/a (no production code) | Web-search spike (§11, DONE); remaining: long-task compaction behavior check, model-fallback adjudication | n/a |
| P1 Foundation | `feat/integration-secrets` | Secret store → named secrets, Integrations & Keys UI, boot env injection, pack-manifest `requires`/`upstream`/`capability`/`runtimes` schema in packages core | Revert = back to `{apiKey}` store; no consumers yet |
| P2 Capability packs | `feat/capability-packs` | Install-flow extensions in agent-packages engine (upstream pin+verify, bin installer, key prompt), doctor readiness checks, Explore Capabilities shelf + runtime facet, onboarding recommendation, curated `web-search-brave` pack in bits (+ fast-follow packs) | Revert = agent-packages back to content-only installs |
| P3 Task-completion tail | `feat/pi-task-parity` | In-app approval attention, subagent model routing, gh readiness check + context guidance, OpenClaw cron adoption helper, schedule-context fixture test, compaction-default pin test | Independent small reverts |
| P4 Runtime hub UX | `feat/runtime-hub` | Tabbed `/runtime` rebuild (Overview/Capabilities/Switch) on the SDK kit | Revert = old page (P2 APIs remain) |
| P5 Docs & validation | `chore/pi-parity-docs` | Knowledge docs (incl. taxonomy in extending docs), CLAUDE.md deltas, README/Astro docs, task-parity battery record | Docs-only |

Bits-repo work (the curated packs) lands in `bakin-bits-official` with its
own version bumps per the bits conventions, referenced from P2.

Commit message examples:
`feat(secrets): generalize provider store to named integration secrets`,
`feat(packages): capability-pack manifest (upstream pin, requires, runtimes)`,
`feat(packages): pinned binary installer for pack-declared bins`,
`feat(explore): capabilities shelf with runtime facet`,
`feat(host): rebuild /runtime as tabbed hub on the SDK kit`,
`feat(workflows): pending-approval attention via nav-badge provider`.

Phase order rationale (task-completion first): P1 is invisible and unblocks
P2; P2 is the heart — fresh-machine capability installs; P3 closes the
remaining ways a task fails or stalls on Pi; P4 consumes P2's readiness API;
P5 closes.

## 6. Testing strategy

- **Unit/module**: secret store schema rewrite (no migration shim); pack
  manifest zod schema; bin installer (checksum verify, temp-dir download,
  atomic move) against temp dirs; env injection precedence. All tests mock
  both content-dir resolvers per CLAUDE.md testing rules; adapter-pi tests
  set `PI_HOME` env before imports.
- **Integration**: capability-pack install end-to-end against a temp
  `BAKIN_HOME`/`PI_HOME` (local fixture upstream, fake bin with checksum);
  projection lands where the active runtime reads skills on BOTH adapters;
  readiness check transitions (no content → no bin → no key → green);
  runtime-switch dry-run byte-identity holds; subagent-model carry
  round-trip.
- **Conformance**: unchanged surfaces stay pinned (delivery `unavailable` ⇔
  channels omitted); `runtime.skills` projection semantics covered by the
  existing suite; no new contract member to conform.
- **UI**: RTL for the runtime hub tabs (rtl-settle rules), Explore
  Capabilities shelf, install dialog + key entry flow, approval attention
  badge.
- **Live validation on this box**: install `web-search-brave` through the
  REAL flow on a throwaway `BAKIN_HOME`/`PI_HOME` (dev rig) simulating a
  net-new machine — no pre-existing bx/key — then the task-parity battery
  (§9.8). Recorded in PR bodies.
- Full suite via `bun run test`; architecture tests: `@earendil-works` stays
  adapter-private; secret values never in settings/SSE payload types.

## 7. Docs impact (checked at every phase, finalized in P5)

- `.claude/knowledge/`: new `capability-packs.md`; update
  `agent-packages.md` (manifest extensions, taxonomy), `pi-adapter.md`
  (skills lane, subagent routing), `runtime-capabilities.md`,
  `adapter-architecture.md` (ecosystem-first stance),
  `bakin-owned-scheduler.md` (cron stance + adoption helper),
  `doctor-and-health-checks.md`, `explore-plugin.md` (Capabilities shelf).
- Extending docs (`docs/src/content/docs/extending/`): the plugin vs
  capability-pack vs agent decision table (D15) with the coupling and
  composition rules.
- `CLAUDE.md`: agent-packages/capability-pack lines, Pi degradation matrix
  updates.
- `README.md` if user-facing framing changes.
- Memory: update `box-flipped-to-pi-runtime` + spike learnings as phases
  land.

## 8. Boundaries

**Always:** honest capability modes and readiness states; typed error kinds;
one engine per concern; adapter boundary (`@earendil-works` only under
`packages/adapter-pi/`); secrets masked, env-first, never in
settings.json/SSE; consent before installing anything; pinned + checksum-
verified upstreams and binaries; tests isolated from `~/.bakin` and `~/.pi`.

**Ask first:** any scope addition beyond the decision log; any new runtime
dependency; curating a pack whose upstream license/trust is unclear.

**Never:** in-process code in capability packs; background daemons inside Pi
extensions; silent fallbacks; compat shims; hand-editing
`settings.runtime.adapter`; committing `generated-version.ts`.

## 9. Acceptance criteria (initiative-level)

1. **Net-new machine flow:** on a clean rig home (no bx, no key, no skills),
   installing `web-search-brave` from Explore or
   `bakin packages install …` walks consent → content → pinned bin →
   guided key → doctor green, with zero manual steps outside Bakin.
2. A dispatched Pi task then completes real web research with cited sources
   (the spike task, §11, reproduced through the productized path).
3. The same pack on OpenClaw projects to OpenClaw's skill location and works
   (runtime-neutral by construction).
4. Missing key / missing bin / terminal-deleted content each surface as an
   honest per-capability readiness warn with a working remediation link —
   never a silent failure.
5. A pending workflow gate badges the nav, fires a toast/OS notification, and
   deep-links to the gate — on Pi with no channel layer.
6. `/runtime` hub matches the component-kit polish bar; switch flow uses
   ConfirmDialog + grouped result cards; capability legend explains
   native/shimmed/unavailable; delivery shows honestly `unavailable` on Pi.
7. Subagent model routing round-trips a Pi⇄OpenClaw switch dry-run report.
8. **Task-parity battery:** research (web search), image generate+edit,
   agent-self-scheduled recurring task, gated workflow approved via in-app
   attention, subagent fan-out honoring per-agent subagent models — all
   complete on Pi on this box. Recorded in the P5 PR.
9. Full suite + conformance green; knowledge docs updated per §7; Explore
   shelves carry the plain-language taxonomy labels.

## 10. Reserved architecture (deferred initiatives)

Recorded so nothing built now contradicts them; do not build in this
initiative.

### 10.1 Discord delivery bridge

> **SUPERSEDED (2026-07-26):** shipped via `.claude/specs/discord-bridge/`
> (issue #669), which expands this design with inbound chat. Deep dive:
> `.claude/knowledge/delivery-bridge.md`. The text below is the original
> banked design, kept for provenance.

- Runtime-neutral bridge in `src/core/delivery/` — `bridge.ts` (neutral
  `ChannelBridge` interface), `discord/client.ts` (discord.js lifecycle),
  `discord/send.ts` (messages, notifications, content, asset attachments via
  existing `{ kind: 'asset' }` refs, threads, edits), `discord/approvals.ts`
  (buttoned cards, interaction subscription → `ApprovalResolveEvent`),
  `audit.ts` (`delivery.*` audit + execution-ledger dedupe keys), `config.ts`
  (`settings.integrations.discord`; token = secret-store `discord.botToken` —
  the P1 store shape already fits).
- `adapter-pi` implements `runtime.channels` by delegation, present only when
  configured; `delivery: 'shimmed'` when configured, `unavailable` otherwise.
  Consumers unchanged. OpenClaw native channels untouched.
- Discord buttons are transport; the durable Bakin approval record is the
  authority; in-app attention (built in P3) remains the always-on companion.
- Bridge boots with the server only when configured; never inside
  `createAppServices()`; clean shutdown teardown. discord.js confined to
  `src/core/delivery/` (architecture test).

### 10.2 Pi extension (in-process code) trust lane

- Activates when a real extension need appears (none required for task
  parity — per-turn capabilities are skills).
- Design banked: `piExtensions` default flips `all` → `allowlist`;
  Bakin-consented installs auto-append; terminal `pi install` extensions are
  discovered but inert until approved in UI (runtime hub) with a doctor
  check pointing there. If broader lifecycle management is needed, the
  optional `packages?` contract member design from spec v1 (list/install/
  remove/update/check/setTrust over Pi's `DefaultPackageManager`) is the
  shape — but only extensions justify it; skills ride agent-packages (D4).

## 11. P0 spike record (2026-07-12, this box)

**Setup:** Pi active (`runtime.adapter: 'pi'`), live server. Installed a
Pi-adapted `bx-search` SKILL.md into `~/.pi/agent/skills/bx-search/`
(content adapted from OpenClaw's bx-search skill). Pre-existing on box:
`bx` 1.4.0 (`~/.local/bin/bx`), working Brave key
(`~/Library/Application Support/brave-search`). No server restart (skills
discovered per session; adapter opens a session per turn).

**Test:** task `890d957f` assigned to `main`: find latest stable Bun version
+ release date + one feature via web search; cite sources; save asset;
honest-failure instructions.

**Result: PASS.** Dispatch picked up in ~3 min (normal tick); agent work
~40 s: loaded skill → `bx` searches → found Bun v1.3.14 (2026-05-13 — well
past training cutoff, proving real search) → noted a cross-source date
discrepancy honestly → saved asset `20260713-web-search-spike-result-a97c893e`
with cited URLs → completed.

**Findings that drove spec v3:**
1. Full web-search task parity = one SKILL.md + a CLI + a key. No contract
   member, no package manager, no restart.
2. Skill collections install by cloning into skills dirs, NOT `pi install`
   (pi-skills has no package manifest) — the v1 `packages?` design targeted
   the wrong lane; agent-packages skill projection is the existing right
   vehicle.
3. `badlogic/pi-skills` also ships `gmcli`/`gccli`/`gdcli` (Google APIs) —
   the deferred email initiative is likely a pack + governance-plugin
   composition.
4. What a net-new machine lacks is exactly the three `requires` dimensions:
   content, binary, key — hence the capability-pack manifest (D4).

**P0 adjudications (resolved 2026-07-12, code-verified):**
- **Long-task compaction: no gap.** Pi SDK auto-compaction defaults ON
  (`settings-manager.js`: `compaction.enabled ?? true`, reserveTokens 16384,
  keepRecentTokens 20000) and the adapter's
  `SettingsManager.create(workspace, agentDir, …)` inherits it — long tasks
  compact, not die. P3 adds one pin test so an SDK default flip can't
  silently regress this.
- **Model fallback: explicit non-goal (revisitable).** Pi inner auto-retry +
  Bakin's dispatch recovery ladder cover transient provider failures; what's
  missing vs OpenClaw is only cross-provider failover during a sustained
  outage — rare on a box that runs one subscription provider. Not worth
  adapter fallback-chain complexity until a real outage bites; revisit on
  first incident (`provider_cooldown` exhaustion in the wild).

## 12. User stories (walked 2026-07-12, approved)

The plan's tasks trace to these. Stories 1–3 are ONE engine with three thin
clients — build the engine once, validate via the CLI client first (cheapest),
then Explore, then onboarding. Story 5 (degradation/remediation) gets test
coverage parity with the happy path — it is where trust is won or lost.

1. **Fresh install** — onboarding recommendations offer Web Search; consent →
   content → pinned binary (progress) → guided key with a skip + "finish
   later in Settings → Integrations & Keys" escape hatch (onboarding never
   stalls on a key). Summary shows Ready / "Installed — needs API key".
2. **Explore install (UI)** — Capabilities shelf ("teach your agents new
   tricks"), runtime-compat badge per card, detail drawer (upstream + pin +
   what installs where + what it needs), install → consent → progress →
   inline key → Ready + "try it" hint. Install lives in Explore ONLY; the
   /runtime Capabilities tab shows status and links here (one install path).
3. **CLI install** — `bakin packages install web-search-brave` resolves the
   curated catalog BY NAME (not just github: sources); consent prompt, per-
   step ✓/⚠ output, inline key prompt with skip; `bakin check capabilities`
   shows per-capability readiness.
4. **The payoff** — user asks for research in chat or a board task; the agent
   searches, cites sources, saves assets. The user never learns the word
   "skill-pack". (Spike §11, productized.)
5. **Honest degradation** — missing key: agent fails honestly (pack skill
   content carries honest-failure instructions), doctor warns
   `capability.web-search` with a remediation link to Integrations & Keys;
   deleted bin → reinstall offer; content drift → `bakin packages sync`.
   DECIDED: no dispatch pre-flight "research task but search not ready"
   magic in v1.
6. **Approval attention** — gate pending ⇒ workflows nav badge + toast +
   optional OS notification/chime, deep link to the gate; approve/reject on
   the durable record; badge clears on resolve. DECIDED: badge rides the
   workflows nav item; no new "attention" nav aggregate.
7. **Runtime hub** — Overview (adapter card, capability chips + plain-
   language legend: native = runtime provides / shimmed = Bakin provides /
   unavailable = honestly not available; delivery on Pi reads "unavailable —
   approvals surface in-app"), Capabilities tab (readiness chips +
   remediation links + browse→Explore), Switch tab (dry-run preview BY
   DEFAULT, incl. "N OpenClaw cron jobs — adopt into Bakin schedules?",
   confirm, live progress, grouped result cards). Every state answers "so
   what do I do about it?"
8. **Subagent routing** — Team agent settings' subagent-model select is
   honored on Pi; fan-out runs show the configured model in usage/health;
   switch dry-run reports mappings both directions.

Pack removal/upgrade rides the existing `bakin packages remove|upgrade`
verbs (upgrade = deliberate upstream re-pin, consent shown on source change);
covered as engine acceptance criteria rather than a separate story.

## 13. Noted follow-up: 1Password integration (2026-07-12)

Secret REFERENCES, not value sync: store `op://vault/item/field` URIs in the
secret store; resolve at the single read chokepoint
(`resolveProviderApiKeySource` cascade gains env → op-reference → stored
value) during boot env injection via `op read`. Headless server ⇒ 1Password
service account (`OP_SERVICE_ACCOUNT_TOKEN`) — one scoped/revocable token
instead of N raw keys at rest; rotation happens in 1Password. Doctor: `op`
readiness check; unresolvable reference = the standard "needs key" state.
Agent-readable-env caveat unchanged (resolved values still enter process
env). P1 keeps resolution centralized so this lands without schema or UI
changes.

## 14. Task-parity battery — LIVE RESULTS (2026-07-13, this box, Pi active)

All spec-§9.8 items ran against the live server post P1–P4 merge:

1. **Research w/ web search** — PASS. Task 2b67707a via the productized
   web-search-brave pack: real bx searches, honest no-releases finding,
   cited sources, asset 20260713-web-search-capability-validation-619da4ac.
2. **Image generate + edit** — PASS. Pixel: asset
   20260713-instagram-square-image-68dc67bc, v1 generated (openai-codex
   native) + v2 edited (stars), currentVersion=2 verified.
3. **Agent self-scheduling** — PASS. Main created schedule `battery-test`
   (sch_f7b5bd47…), verified via schedule_list, deleted, verified gone.
4. **Gated workflow + in-app attention** — PASS. battery-gate-test workflow:
   agent step ran on Pi → gate pending → Workflows nav badge (count 1)
   captured live in-browser → approved through the durable record (approver
   captured) → workflow completed, badge cleared, task done.
5. **Subagent fan-out** — PASS. Main created scout subtask d95f80e8; scout
   dispatched independently, logged "pong", completed.
6. **Subagent-model round-trip** — verified by the real-adapter switch +
   dry-run e2e suites (preservation stash/restore pinned in
   tests/core/roster-reconcile.test.ts); not re-run live to avoid a
   disruptive runtime flip on the daily driver.

Status: initiative acceptance criteria met. Spec status → SHIPPED on P5
merge; reserved lanes (§10) and fast-follow packs move to follow-up issues.
