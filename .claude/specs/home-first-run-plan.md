# Implementation plan: Home and the first-run experience

Spec: `.claude/specs/home-first-run.md` (approved for planning 2026-11-13).
Status: **draft 1, awaiting review.**

## Overview

Eight stacked pull requests in three phases, after a spike. Each PR is
shippable alone and leaves `main` working. One commit per task; every
commit passes typecheck, lint, the cycle check and the tests it touches.

| Phase | PR | Title | Size |
|---|---|---|---|
| 0 | 1 | `bakin login`: Pi's own login screen from inside Bakin | M |
| 1 | 2 | Home exists: the page at `/`, its state, the prompt and starters | L |
| 1 | 3 | Meet your agent: the three-question introduction | M |
| 1 | 4 | Login from the browser, and the agent's first message | M |
| 2 | 5 | Suggestions engine, checklist route, dismissals | M |
| 2 | 6 | "Do more with Bakin" on Home and the sidebar count | S |
| 3 | 7 | The tour modal | M |
| 3 | 8 | Pages introduce themselves; real empty states | M |

## Architecture decisions

- **`home` is a core plugin** (the 15th), with a host route at `/`
  rendering its page slot. Same shape as Explore. Home's server side reads
  other plugins through the hook registry.
- **One state answer.** `GET /api/plugins/home/state` returns everything
  the page needs to choose what to show: the state name, the main agent's
  identity, the login verdict and guidance, the starters this home can
  run, and (Phase 2) suggestions. The state machine is a pure function;
  the route only gathers its inputs.
- **Decisions people made are the only stored state:**
  `~/.bakin/plugin-data/home/decisions.json` holds "introduction skipped",
  dismissed suggestions with timestamps, and closed page introductions.
- **Curated content is data** in a new `home-content.json` beside the
  curated catalog, with a zod schema: starters, personality presets,
  suggestions, tour slides, page introductions. Not in the catalog file
  itself: the catalog describes installable things; this describes copy.
- **The terminal handoff moves to the SDK.** `useTerminalHandoff` and its
  return-verification live inside the Health plugin today. Home needs the
  same thing and plugins cannot import each other, so the hook moves to
  `@makinbakin/sdk/hooks` and Health consumes it from there. **This grows
  the public SDK surface and needs the maintainer's approval (see Ask
  first).**
- **The user's name** is written as a marked section of
  `~/.bakin/team/context/global.md` by a core function, followed by the
  existing agent sync, so every agent's instructions pick it up.

## UI patterns (to confirm against Storybook at each PR)

| Surface | Closest public pattern |
|---|---|
| Home page | `storybook/public/pages/page.stories.tsx` (page archetype) |
| Introduction, greeting | `storybook/public/conversation/` (turn rendering, composer) |
| Prompt | conversation kit `Composer` |
| Starters, suggestions | `storybook/public/lists/` or card patterns in `recipes/collection-patterns` |
| Login card | `storybook/public/feedback/` (Alert) plus the handoff action |
| Tour | `storybook/public/overlays/dialog.stories.tsx` |
| Page introductions | `storybook/public/feedback/` (dismissible Alert) |
| Empty states | the kit's empty-state pattern in `feedback/` |

**Likely gaps, raised for approval before they are built, not worked
around:** a multi-slide dialog (the tour), and the low-fidelity
illustration miniatures. If either is refused, the fallbacks are a plain
dialog with Back / Next and text-and-icon slides.

---

## Phase 0

### PR 1: `bakin login`

**Task 1.1: spike.** Run Pi's interactive login from the bundled SDK
inside a Bakin process, honouring `PI_HOME`, in a throwaway home.
- Acceptance: a provider can be logged in from source; the same from the
  compiled Linux binary in a container (compiled binaries are killed on
  this Mac); the terminal is restored on exit and on Ctrl-C.
- Verify: `auth.json` appears in the throwaway Pi home; `bakin check llm`
  reports ok there.
- **Checkpoint: if this fails, stop and report.** Nothing else in the PR
  is written; PR 4 falls back to the steps-only screen.
- Commit: none (spike notes go in the PR description).

**Task 1.2: the command.** `bakin login` runs the active runtime's login.
Pi: the screen from 1.1. OpenClaw: prints its guidance and exits 0, since
OpenClaw owns its own login.
- Acceptance: refuses in a non-interactive shell with a clear message;
  never reads or prints a credential; works with no server running and
  with one.
- Verify: harness test in a pseudo-terminal that the screen starts and
  exits cleanly on Ctrl-C; unit test for the non-interactive refusal and
  the OpenClaw branch.
- Files: `src/cli/commands/runtime.ts` (or a new `login.ts`), `cli/bakin.ts`,
  `src/core/cli/registry.ts`, `packages/adapter-pi/src/`.
- Commit: `feat(cli): bakin login runs the runtime's own login screen`

**Task 1.3: point everything at it.** Pi's `loginSteps`, the Health
handoff command, onboarding's credentials screen and the setup doc say
`bakin login`. The "install `pi`, needs Node 22.19" guidance and
`cli-requirements.ts` are deleted.
- Verify: the copy test; `grep` finds no remaining `npm install -g
  @earendil-works`.
- Commit: `fix(onboarding): logging in no longer needs the pi CLI installed`

**Task 1.4: docs.** `onboarding.md`, `pi-adapter.md`, first-time-setup,
generated CLI reference.
- Commit: `docs: bakin login`

---

## Phase 1

### PR 2: Home exists

**Task 2.1: the plugin skeleton and the route.** `plugins/home/` with a
manifest, an empty page, the host route at `/` and the sidebar entry
first. The `/tasks` redirect is removed.
- Acceptance: `/` renders Home; the route-ranking and no-hard-navigation
  tests pass; core plugin count tests updated.
- Verify: `bun run build:plugins`, host route tests.
- Commit: `feat(home): a home page at /`

**Task 2.2: content data and schema.** `home-content.json` with the ten
starters (spec §10) and the four presets, validated at load.
- Verify: schema tests, including a rejected malformed entry.
- Commit: `feat(home): curated starters and personality presets as data`

**Task 2.3: the state machine.** A pure function from inputs (main
agent identity, login verdict, runtime reachable, decisions) to one of
`meet-agent | needs-login | ready | unavailable`, plus which starters this
home can run.
- Verify: unit tests for every precedence case and starter filter.
- Commit: `feat(home): what Home shows is one pure function of state`

**Task 2.4: the state route.** `GET /api/plugins/home/state` gathers the
inputs (Team hook for the main agent, the `llm` check for login, runtime
capabilities and capability readiness for starter needs).
- Verify: plugin route tests with a mocked runtime.
- Commit: `feat(home): the state route`

**Task 2.5: the Ready and Unavailable views.** The prompt (kit Composer),
up to six starters, the unavailable state. Submitting creates a chat with
the main agent and navigates to it.
- Verify: component tests; a story if a new public pattern is used;
  `ui:conformance --quick`.
- Commit: `feat(home): ask for something, or pick a starter`

**Task 2.6: docs and the end-to-end check.** `.claude/knowledge/home.md`,
CLAUDE.md's plugin count and Key Patterns entry, README. Harness scenario:
a booted server on a throwaway home serves Home and its state route.
- Commit: `docs(home): the Home page` and `test(home): Home on a real server`

### PR 3: Meet your agent

**Task 3.1: detecting an unnamed main agent**, on Pi and OpenClaw, as an
input to the state route.
- Commit: `feat(home): know when the main agent has not been introduced`

**Task 3.2: writing the answers.** One Home route takes name, preset or
own words, and the user's name. It calls the Team identity route's
underlying function for the agent and writes the user's name into global
context, then runs the agent sync.
- Acceptance: all three land or none do; a second submit is idempotent.
- Verify: route tests; harness check that the Pi home's agent record and
  personality file changed.
- Commit: `feat(home): the introduction writes the agent and the person`

**Task 3.3: the introduction view.** The three steps as a data script
rendered through the conversation layout (spec D5a), with Back and "Skip
for now"; skip is stored.
- Verify: component tests driving the keyboard path; skip persists across
  a reload.
- Commit: `feat(home): meet your main agent`

**Task 3.4: reachable again** from Home and the agent's Team page.
- Commit: `feat(home): the introduction can be reopened`

### PR 4: Login from the browser, and the first message

**Task 4.1: the handoff hook moves to the SDK** (approval required).
Health consumes it from `@makinbakin/sdk/hooks`; behaviour unchanged.
- Verify: Health's existing handoff tests pass unmodified in substance;
  SDK public-API inventory updated.
- Commit: `refactor(sdk): the terminal handoff is a shared hook`

**Task 4.2: the needs-login view.** Who the agent is, the handoff running
`bakin login`, "Check again", locked starters; without Terminal, the steps
and an offer to add it.
- Verify: component tests for both branches and the return recheck.
- Commit: `feat(home): log in without leaving the browser`

**Task 4.3: the first message.** When the introduction is complete and a
login exists, one greeting turn in a kept chat; Home shows it once.
- Acceptance: exactly once per home; subject to the budget gate; a failed
  turn leaves Home usable and says nothing false.
- Verify: route tests with a mocked runtime, including "already greeted".
- Commit: `feat(home): the agent says hello in its own voice`

### Checkpoint A (end of Phase 1)

- `bun run test:ci`, `ui:conformance --full`, docs validate.
- A fresh home walked in a browser, start to first reply, by the
  maintainer; once more from a second device over Tailscale.
- Decide: is the scripted introduction organic enough, or does D5's
  real-turn replacement come next?
- Cut a release candidate.

---

## Phase 2

### PR 5: Suggestions engine, checklist route, dismissals

- **5.1** Decisions store (`decisions.json`), serialized writes, schema.
  `feat(home): remember what people decided`
- **5.2** Suggestions in the content data; the pure engine (conditions,
  ordering, 30-day expiry, never spend limits or brands; a starter with a
  missing need becomes a suggestion). `feat(home): suggestions from real state`
- **5.3** `GET /api/runtime/onboarding/checklist`, and suggestions on the
  state route; `POST …/home/suggestions/:id/dismiss`.
  `feat(home): the checklist and suggestion routes`
- Verify: engine unit tests for every rule; route tests; a time-travel
  test for the 30 days.

### PR 6: "Do more with Bakin" and the sidebar count

- **6.1** The Home section: up to three, each with its action and "Not
  now". `feat(home): do more with Bakin`
- **6.2** The sidebar card shows a count and links to the section.
  `feat(shell): the promo card counts what is left`
- **6.3** Docs. `docs(home): suggestions`

### Checkpoint B

Full gates; the maintainer checks the suggestions on a real home read as
suggestions, not chores.

---

## Phase 3

### PR 7: The tour modal

- **7.1** Tour slides in the content data.
- **7.2** The slide dialog (approval required if the kit has no pattern).
- **7.3** The six illustrations, low fidelity, kit-built; fallback text
  and icon.
- **7.4** The offer on Home. `feat(home): a two-minute tour`

### PR 8: Pages introduce themselves

- **8.1** A shared, remembered "first visit" introduction, driven by the
  content data and the decisions store.
- **8.2 to 8.7** One commit per page (Chat, Tasks, Team, Assets, Schedule,
  Health): the introduction and a real empty state. Messaging-style Bits
  pages are out of scope.
- **8.8** Docs.

### Checkpoint C

Full gates; `ui:conformance --full`; release.

---

## Commit and rollback strategy

- One task, one commit, on a branch per PR, stacked in order. No amends
  and no force-pushes; fixes are new commits.
- Every commit passes the gates on its own, so any PR can be reverted as a
  unit and any commit bisected.
- PR 1 is independent of the rest and worth having even if Home were
  dropped. PR 2 changes where `/` goes; reverting it restores the
  redirect. PRs 3 and 4 add states to a page that already works without
  them. Phases 2 and 3 only add.
- Architecture tests run before every commit; no commit is chained after
  an unread gate.

## Ask first (collected)

1. Moving the terminal handoff hook into the public SDK (PR 4).
2. A multi-slide dialog pattern, if the kit lacks one (PR 7).
3. The illustration miniatures as a pattern (PR 7).
4. Anything the spike shows `bakin login` needs that touches a credential.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The spike fails | No in-browser login | Stop at 1.1; steps-only screen; PRs 2 and 3 are unaffected |
| Terminal 0.3.5 (published) lacks something the handoff needs | Login handoff works only on the dev version | Verify against 0.3.5 in PR 4 before building on it |
| Chat cannot be created with a first message in one call | Two requests and a visible gap | Read the chat routes first in 2.5; add a hook if needed |
| Agent sync after writing the user's name is slow | The introduction feels stuck | Run it as an operation with progress; never block the next screen on it |
| Six pages of empty states sprawl | PR 8 grows | One commit per page; any page can be dropped without affecting the others |

## Open questions

None blocking. The three "ask first" items are decided when their PR
starts, with the Storybook evidence in hand.
