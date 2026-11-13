# Implementation plan: Home and the first-run experience

Spec: `.claude/specs/home-first-run.md`.
Status: **revision 2.** Revision 1 was reviewed by Codex (one round,
2026-11-13: REVISE, 3 must-fix, 9 high). This revision takes every finding
except the login spike, which the maintainer dropped: login is
instructions for the MVP.

## What changed from revision 1

| Finding | Change |
|---|---|
| Login spike was under-scoped (private SDK methods, remote OAuth) | **Dropped.** No `bakin login`. Home shows instructions in the existing handoff card. |
| Automatic greeting bypassed the spend gate; no once-only design | The greeting is a message the person sends ("Say hello to …"). No unprompted turn. |
| PRs were not shippable alone | Home is built at `/home`; `/` switches only when all four states have screens (PR 3). |
| "All or none" had no mechanism | Ordered, repeatable writes; "introduced" is a record written last. |
| Home cannot import Team's rename function | A Team-owned identity hook, shared with its HTTP route (Task 2.1). |
| A login is not the same as "the agent can answer" | Structured readiness: runtime reachable, credentials, main-agent model eligibility. |
| The kit already has a handoff card | Use `feedback/handoff-card.stories.tsx` (`CanonicalUsage`, `WithTerminal`, `Failed`). |
| Decisions store arrived after its first user | Moved to PR 1. |
| Registration, sidebar order, fixtures, isolation were implicit | Named below. |

## Overview

Seven pull requests in three phases. One commit per task. Every commit
passes typecheck, lint, the cycle check, `tests/architecture` and the
tests it touches.

| Phase | PR | Title | Size |
|---|---|---|---|
| 1 | 1 | Home at `/home`: state, the prompt, starters | L |
| 1 | 2 | Meet your agent | M |
| 1 | 3 | Login instructions; Home becomes `/` | M |
| 2 | 4 | Suggestions engine, checklist route | M |
| 2 | 5 | "Do more with Bakin" and the sidebar count | S |
| 3 | 6 | The tour | M |
| 3 | 7 | Pages introduce themselves; real empty states | M |

## Architecture decisions

- **`home` is a core plugin** with a host route rendering its page slot
  (the Explore precedent). Registering one means: `CORE_PLUGIN_IDS`
  (`src/lib/core-plugin-ids.ts`), `CORE_PLUGIN_IMPORTS`
  (`src/lib/plugin-static-imports.ts`), the manifest and `client.tsx`
  contributions in step, the embedded-assets manifest, the host route and
  `router.ts`, and the plugin-count tests.
- **One state answer, one pure function.** `GET /api/plugins/home/state`
  gathers inputs; `homeState(inputs)` decides. GETs never start a turn or
  write anything.
- **Readiness is three structured facts**, never message text: runtime
  reachable; credentials (`present | absent | unknown`); the main agent's
  model eligible under them (the eligibility engine). Unknown is never
  treated as absent.
- **"Unnamed" is a defined predicate** over neutral runtime reads: the
  main agent has no personality file AND its display name is the
  runtime's seeded default. Unavailable evidence is not "unnamed".
- **Decisions people made are the only stored state**, in
  `~/.bakin/plugin-data/home/decisions.json` (schema-validated, serialized
  writes): introduction skipped or completed (with its progress), dismissed
  suggestions with timestamps, closed page introductions. Decisions
  survive a downgrade and re-upgrade; unknown keys are kept.
- **Curated content is data**: `packages/host/src/data/home-content.json`
  with a zod schema (starters, presets, suggestions, tour slides, page
  introductions).
- **Plugins talk through hooks.** Home reaches Team through a new
  `team.updateIdentity` hook and Chat through its HTTP routes from the
  browser (create, then send).
- **The terminal handoff is shared through the SDK** (ask first): the
  hook moves to `@makinbakin/sdk/hooks`; return verification is scoped per
  consumer so Home and Health cannot consume each other's pending recheck;
  Terminal availability is re-read after an install.

## UI patterns

| Surface | Public story |
|---|---|
| Page | `storybook/public/pages/page.stories.tsx` |
| Introduction, hello | `storybook/public/conversation/` (turns, composer) |
| Prompt | conversation kit `Composer` |
| Starters, suggestions | `recipes/collection-patterns.stories.tsx` |
| Login | `feedback/handoff-card.stories.tsx` — `CanonicalUsage`, `WithTerminal`, `Failed` |
| Unavailable, empty | `feedback/` system and empty states |
| Tour | `overlays/dialog.stories.tsx` |
| Page introductions | `feedback/` dismissible alert |

The exact export is named in each PR before any markup. Every PR that
changes Home's UI runs Home's own fixture (`plugins/home/bakin.ui-test.ts`,
`bun run test:ui`) and inspects its report, covering loading, error,
disabled, narrow, long-content and keyboard states; pages changed in PR 7
run theirs. `ui:conformance --quick` per commit, `--full` per PR.

**Likely gaps, raised for approval before building:** a multi-slide
dialog and the illustration miniatures (PR 6). Fallbacks: a plain dialog
with Back / Next; text-and-icon slides.

## Testing rules that apply to every task

From CLAUDE.md, restated because the reviewer found them missing: both
content-dir resolvers mocked; OpenClaw home mocked; `PI_HOME` and
`BAKIN_HOME` set before imports, caches reset after; `getBakinPaths` mocks
include `db`; RTL files import `rtl-settle` and stay act-clean; plugin
tests use `tests/plugins/test-helpers.ts`. End-to-end scenarios go through
the onboarding harness (`tests/integration/onboarding/harness.ts`), never
a hand-spawned CLI.

---

## Phase 1

### PR 1: Home at `/home`

`/` keeps redirecting to Tasks. Home is reachable and complete for a home
that is already set up; the other states render an honest placeholder
that says what is missing and links to where it is fixed today.

- **1.1 Plugin registration and the route.** The files listed above; a
  page at `/home`. Verify from source and from a packaged build.
  `feat(home): a home plugin and its page`
- **1.2 Content data and schema.** The ten starters and four presets,
  each starter declaring `needs` (agent, capability-ready,
  image-provider-ready, attachment).
  `feat(home): curated starters and presets as data`
- **1.3 Decisions store.**
  `feat(home): remember what people decided`
- **1.4 Readiness inputs.** The three facts, and the unnamed predicate,
  with fixtures: implicit OpenClaw main, renamed agents, a seeded name
  with a personality, absent versus empty personality files, unreadable
  credentials, credentials for another provider.
  `feat(home): can the main agent answer, as structured facts`
- **1.5 The state machine.** Precedence: unavailable, meet-agent,
  needs-login, ready. Starter filtering separates machine readiness (the
  server's answer) from attachment readiness (the composer's).
  `feat(home): what Home shows is one pure function of state`
- **1.6 The state route.** `feat(home): the state route`
- **1.7 Starting a chat.** Create, then send, from the browser. The chat
  id is kept if the send fails so nothing typed is lost; a double submit
  creates one chat; navigation lands in a streaming reply. An attachment
  starter opens the picker first; a missing attachment is never an
  "install something" suggestion.
  `feat(home): start a conversation from Home`
- **1.8 Ready and Unavailable views.**
  `feat(home): ask for something, or pick a starter`
- **1.9 Harness scenario and docs.** A real server on a throwaway home
  serves `/home` and the state route; `.claude/knowledge/home.md`,
  CLAUDE.md, README.
  `test(home): Home on a real server` · `docs(home): the Home page`

Acceptance for the PR: on a fresh home `/home` says the agent has not
been introduced; on a named home without a login it says what is missing;
on a ready home the prompt starts a chat.

### PR 2: Meet your agent

- **2.1 `team.updateIdentity` hook.** Team's existing identity service
  behind a hook and its HTTP route, keeping the audit record and
  settings-cache reset.
  `feat(team): identity updates are available as a hook`
- **2.2 Resumable writes.** A fixed order: agent record, identity and
  personality files, the person's name in global context, a local
  operation-backed agent sync (`fetch: false`, every result inspected),
  then the "introduced" record. Each step is safe to repeat; concurrent
  submits serialize; a managed agent keeps its package name and gets only
  what the package does not own. Fault-injection test after every write:
  the introduction resumes and never disappears half done.
  `feat(home): the introduction writes are resumable`
- **2.3 The introduction view.** The three steps as a data script through
  the conversation layout; Back; "Skip for now" (stored).
  `feat(home): meet your main agent`
- **2.4 Saying hello.** The last step, and a ready Home that has not yet
  said hello, offer "Say hello to <name>": an ordinary first message with
  a fixed chat title. `feat(home): say hello`
- **2.5 Reopening** from Home and the agent's Team page.
  `feat(home): the introduction can be reopened`

### PR 3: Login instructions; Home becomes `/`

- **3.1 The handoff hook moves to the SDK** (approval required), with
  per-consumer return verification and availability refresh; Health
  migrates. Test: returning to one consumer does not consume the other's
  recheck. `refactor(sdk): the terminal handoff is a shared hook`
- **3.2 The needs-login view.** The handoff card with the runtime's
  steps; with Terminal active, "Open in Terminal" types the command and
  the copy says to press Enter; "Check again"; locked starters.
  `feat(home): how to log in, on the page that needs it`
- **3.3 `/` is Home.** The redirect goes; Home is first in the sidebar
  (`nav-placement.ts` primary ids and its tests).
  `feat(home): Bakin opens on Home`
- **3.4 Docs.** `docs(home): first run`

### Checkpoint A

`bun run test:ci`, `ui:conformance --full`, docs validate. The maintainer
walks a fresh home in a browser to a first reply, and again from a second
device. Decide whether the scripted introduction is organic enough, and
whether login instructions are enough or the Bakin-run login is next.
Release candidate.

---

## Phase 2

### PR 4: Suggestions engine and the checklist route

- **4.1** Suggestions in the content data; the pure engine: conditions,
  ordering, 30-day expiry, never spend limits or brands, a starter with a
  missing machine need becomes a suggestion.
  `feat(home): suggestions from real state`
- **4.2** `GET /api/runtime/onboarding/checklist`; suggestions on the
  state route; `POST /api/plugins/home/suggestions/:id/dismiss`.
  `feat(home): the checklist and suggestion routes`
- Verify: engine tests for every rule; a time-travel test for 30 days.

### PR 5: "Do more with Bakin" and the sidebar count

- **5.1** The Home section, three at most. `feat(home): do more with Bakin`
- **5.2** The promo card's count. `feat(shell): the promo card counts what is left`
- **5.3** Docs.

### Checkpoint B

Full gates. The maintainer checks the suggestions read as suggestions.

---

## Phase 3

### PR 6: The tour

- **6.1** Slides as data. **6.2** The slide dialog (approval if a new
  pattern). **6.3** Six low-fidelity illustrations (approval; fallback
  text and icon). **6.4** The offer on Home.

### PR 7: Pages introduce themselves

- **7.1** A shared remembered first-visit introduction.
- **7.2 to 7.7** One commit per page: Chat, Tasks, Team, Assets,
  Schedule, Health.
- **7.8** Docs.

### Checkpoint C

Full gates, `ui:conformance --full`, release.

---

## Commit and rollback strategy

- One task, one commit; a branch per PR, stacked. No amends, no
  force-pushes.
- **Revert in reverse order.** PR 3's `/` switch reverts alone and
  restores the redirect. The SDK hook (3.1) cannot be reverted while Home
  uses it: revert 3.2 first. PR 2 cannot be reverted while Team links to
  the introduction (2.5): revert that commit first.
- **Data outlives a revert.** A named agent, its personality, the
  person's name in global context and the decisions file are the user's;
  no revert deletes them, and re-applying the PRs reads them back without
  repeating the introduction.

## Ask first (collected)

1. Moving the terminal handoff hook into the public SDK (3.1).
2. A multi-slide dialog pattern (6.2).
3. The illustration miniatures (6.3).

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Login instructions stop a novice | The first reply never happens | Handoff card with a browser terminal where installed; watched at Checkpoint A; Bakin-run login is the follow-on |
| The published Terminal (0.3.5) lacks what the handoff needs | Handoff works only on the dev version | Verify against 0.3.5 in 3.1 |
| Agent sync after the introduction is slow | The introduction feels stuck | It is an operation with progress; "Say hello" waits for it so the agent knows the name |
| Six pages of empty states sprawl | PR 7 grows | One commit per page; any can be dropped |

## Open questions

None blocking.
