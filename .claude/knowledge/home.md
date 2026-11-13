# Home

The page Bakin opens on. Spec: `.claude/specs/home-first-run.md`; plan:
`.claude/specs/home-first-run-plan.md`. This file describes what is built.

**Built so far (plan PRs 1 to 3, Phase 1):** the `home` core plugin, its
page at `/` (first in the sidebar), the state route, and a screen for
every state: the introduction, logging in, the ready prompt with starters
and the first hello, and "unavailable". `/home` redirects to `/` with its
query string.

**Phase 2 (plan PRs 4 and 5):** the suggestions engine, its "Not now"
route, the setup checklist's HTTP route, the "Do more with Bakin" section
on a ready Home, and the count on the sidebar's "Make Bakin Yours" card.


**Phase 3 (plan PRs 6 and 7):** the tour, and six pages that introduce
themselves on a first visit. Every phase of the plan is built.

## The rule

**What Home shows is derived from the machine's real state on every read.
The only things stored are decisions a person made.** Home never records
what was clicked during CLI onboarding, and a GET never writes or starts a
turn.

## One state, one pure function

`GET /api/plugins/home/state` gathers facts (`lib/readiness.ts`) and
`homeState(facts)` (`lib/state.ts`) decides. Precedence, first match wins:

| State | When |
|---|---|
| `unavailable` (`runtime_unreachable`) | the runtime roster cannot be read, or there is no main agent |
| `meet-agent` | an introduction is half written (answers recorded, not all saved: it carries them as `resume`), or the main agent is known to be unintroduced and the introduction was neither skipped nor completed |
| `needs-login` | credentials are known to be absent |
| `unavailable` (`model_cannot_run`) | a provider is logged in, but the main agent's own model cannot run with it |
| `ready` | otherwise |

### The facts, and why they are structured

Nothing reads a message. **Unknown is its own value and never means
missing**: an unreadable credential file must not send a logged-in person
to the login screen.

- **Reachable:** `runtime.agents.list()` succeeds. Not `ping()`: Pi's
  `ping()` is false with no credential on disk, which is a login problem,
  not a reachability one.
- **Main agent:** `selectRuntimeMainAgent`.
- **Introduced:** `false` only when the name is one the runtime gave
  (`isSeededName`: the agent's own id, "Main", or blank) AND the
  personality file (`SOUL.md`) is absent or empty. A real name is enough
  and the file is not read. A file that cannot be read is `unknown`.
- **Credentials:** `runtime.credentialStatus({ agentId })` → `present`,
  `absent`, or `unknown` when it throws.
- **Model:** the agent's own pin, else the runtime default, judged by the
  eligibility engine under that agent's credentials. No model, an unknown
  verdict or a failed read are `unknown` and never block. A login is not
  the same as "this agent can answer".

## Starters

Ten curated asks in `plugins/home/content/home-content.json` (validated by
`lib/content.ts`; a malformed file is a load error, and an unknown `needs`
key is refused so a typo cannot mean "needs nothing"). Each declares what a
home must have:

| Need | Decided by |
|---|---|
| `capability` | the capability readiness engine: installed AND ready |
| `imageProvider` | the Images plugin's `images.canGenerate` hook |
| `agent` | the roster |
| `attachment` | the person, in the composer. Never the server, and never a reason to install something |

The route returns the starters this home can run; the page shows six at
most. A starter whose machine need is missing is not gone for good: a
suggestion supplies what it lacks (a test fails when a starter has a need
no suggestion covers). The list is expected to change once it has been
used.

## Starting a conversation

The prompt and starters talk to the main agent through Chat's own HTTP
routes (`lib/client/start-chat.ts`): create the chat, then send. Nothing
typed is lost:

- chat not created → Home says so and the composer keeps the text;
- chat created, message not sent → the text is left as that chat's
  composer draft and the chat is opened anyway;
- a starter that needs a file → its words are left in Chat's draft composer
  for that agent (`/chat/new?agent=<id>`), where the person attaches and
  sends.

Home writes Chat's composer draft keys (`chat:<id>`, `chat-draft:<agentId>`)
through the kit's `writeComposerDraft`. Those keys are Chat's; if Chat
renames them, `tests/plugins/home/start-chat.test.ts` is where it shows.

A second submit while the first is still creating its chat is ignored.

## The introduction

Three questions, scripted by Bakin with no model involved, so it works
before any provider login: the agent's name, how it comes across (four
presets from `home-content.json`, or the person's own words), and what to
call the person. The screen (`components/introduction.tsx`) draws the
script with the conversation kit's own `AgentTurn` / `UserMessage`, so a
real agent turn can replace it later without changing the layout.

`POST /introduction` (`lib/introduction.ts`) makes several separate writes
that cannot be atomic, so they are **resumable**:

1. the answers are recorded as `introduction: pending` in the decisions file;
2. `identity`: Team's `team.updateIdentity` hook renames the agent and
   writes its vibe and personality file;
3. `person`: `setOperatorName` (`src/core/team-context.ts`) writes a
   "Who you work with" block into `team/context/global.md`, which reaches
   every agent;
4. `sync`: a local agent sync, run as an operation, so the agent knows
   the name before anyone says hello;
5. `introduction: completed`.

Every step is safe to repeat. A failure answers `502 { ok: false, step,
error }`, the answers stay pending, and Home keeps showing the
introduction on its last step with everything filled in. An unknown
personality or a blank name is refused (400) before anything is recorded.
The audit record is `home.introduction_completed` (the host prefixes the
plugin id; the plugin declares `events.emit`).

"Skip for now" (`POST /introduction/skip`) records the skip; Home moves on
and keeps a quiet link back (`introductionSkipped` on the state response).

**Reopening:** `/?introduce=1` opens the introduction over any Home
that has an agent, starting from the name the agent goes by. Leaving is a
plain Cancel that records nothing, so a finished introduction is never
overwritten by a skip. The main agent's Team page links there ("Redo the
introduction" in the agent actions menu). It is a link by URL: Team
imports nothing from Home.

## Logging in

`needs-login` carries `login` on the state response: the ACTIVE runtime's
own label, steps, docs link and, when it has one, the shell command that
starts the sign-in (`getRuntimeAdapterSupport(...)`: `loginSteps` and
`loginCommand`; Pi's is `pi`, OpenClaw has none). Home names no runtime
itself.

The screen shows the steps, then the kit's `HandoffCard` with the command.
**Bakin never handles the secret and never runs the command.** Copy works
everywhere; "Open in Terminal" appears only when the Terminal plugin is
active, and types the command into a new session for the person to run
(`useTerminalHandoff` from `@makinbakin/sdk/hooks`).

Taking the command either way arms Home's handoff return channel
(`handoffReturnChannel('home')`); when the person is back on Home (the
page mounts again, the window regains focus, the tab becomes visible) the
state is read again, once. "I've logged in. Check again" does the same by
hand. The starters are listed but cannot be pressed: nothing that would
fail is offered.

## Saying hello

The state response carries `hello: true` when the introduction was
completed on this home and no hello is recorded (`offersHello`). A ready
Home then offers "Say hello to <name>": an ordinary first message
("Hello, <name>!") the person sends, in a chat titled "Meeting <name>".
Sending it, or "Not now", calls `POST /hello` and the offer is over. A
skipped introduction offers nothing, and neither does an agent that was
named somewhere else.

## Suggestions

"Do more with Bakin" is curated data plus a pure engine
(`lib/suggestions.ts`); no component decides what applies. Each entry in
`home-content.json` has a title, a payoff sentence, ONE action (a label
and a path to a page that already exists; Explore and Settings do the
installing and the consent) and a condition:

| Condition | Holds when | Asked of |
|---|---|---|
| `capability-missing` | no installed pack provides the capability | capability readiness |
| `capability-needs-key` | a pack provides it, none is ready, and a required key is not set | capability readiness |
| `no-image-provider` | no provider can make images | `images.canGenerate` |
| `agent-missing` | a named agent is not on the roster | the roster |
| `only-main-agent` | the roster is the main agent alone | the roster |
| `plugin-missing` | a plugin is not loaded | the plugin registry |
| `checklist-todo` | a setup checklist item is `todo` | the setup checklist |

Rules:

- **Unknown never suggests.** Capabilities that could not be read, an
  Images plugin that is not loaded, a checklist that threw or an item it
  could not tell: none of them makes a suggestion appear. (Starters lean
  the other way on the same evidence: what could not be read is not
  offered.)
- **Only a ready Home.** The state route returns no suggestions in any
  other state and does not ask the checklist.
- **Curated order, three shown.** `suggestions` is the first three that
  apply (`MAX_SHOWN`); `suggestionCount` is how many apply in all.
- **Never spend limits or brands.** The schema refuses an action that
  points at `/spend` or `/brands`; both are choices, never to-dos.
- **"Not now" is thirty days**, not forever
  (`POST /suggestions/:id/dismiss`, `DISMISSAL_MS`). The time is stored;
  the suggestion returns afterwards if it still applies. An id that is
  not a suggestion is a 404 and writes nothing.

**On the page.** A ready Home lists the suggestions under "Do more with
Bakin" (`id="do-more"`), below the starters: title, payoff, "Not now" and
one link. The link is a `PluginLink` to the suggestion's page; Home
installs nothing itself.

**In the sidebar.** The shell's `SidebarPromo` takes a `count`. With any
suggestions it reads "N suggestions for getting more out of Bakin" and
links to `/#do-more`; with none it is the plain Explore card it always
was. The count is `suggestionCount` from Home's state route, read by
`useSuggestionCount` (`packages/host/src/hooks/`), which never counts
anything itself and is zero when Home cannot answer. It reads again when
the page changes (something may have been installed on the last one) and
on the `home.suggestions_changed` plugin event, which the dismiss route
emits so every open browser follows.

Capability readiness is read ONCE per state read (`evidence()` in
`lib/readiness.ts`) and feeds both starters and suggestions.

## The tour

Six slides, one per area (Chat, Tasks, Team, Assets, Schedule, Health),
as curated data in `home-content.json` (`tour`): the area's name and
sidebar icon, two or three sentences on what it is for, one thing to try
first, and its page. A test holds each slide to the label, icon and
address the area's own manifest gives its nav item, so a renamed page
fails here instead of leaving a stale slide. `GET /api/plugins/home/tour`
serves them; the page fetches them only when the tour is open.

- **Offered, never opened.** A ready Home and one waiting on a login
  show "Take a two-minute tour". Nothing opens it automatically and
  nothing is stored about it: the offer stays.
- **The slide is in the URL** (`/?tour=<slide id>`; any other value is
  the first slide), so a slide can be linked to and a reload keeps the
  place. Moving between slides replaces the history entry, as all URL
  state does: the browser's Back leaves the tour.
- **Plain kit Dialog** (`components/tour.tsx`): "N of 6", Back, "Next:
  <area>", and Done on the last slide, which hands back to Home. Each
  slide links to its page.
- **Text and an icon.** The spec's low-fidelity illustrations (D12) and
  a dedicated multi-slide pattern were both ask-first; this is the
  fallback for each. Slides that cannot be loaded toast and close, never
  an empty dialog.

## Pages introduce themselves

Chat, Tasks, Team, Assets, Schedule and Health each show a short panel
the first time someone opens them: a title and two sentences, curated in
`home-content.json` (`pageIntroductions`, keyed by the page's plugin id),
with "Got it".

- **Who sees them.** Only a home where someone finished or skipped Home's
  introduction (`startedOnHome`, `lib/page-introductions.ts`, pure). That
  is the one recorded sign a person started here. A home set up before
  Home existed, or whose agent was named elsewhere, gets none: its people
  know their way around and are never handed six panels to close.
- **Closed is closed.** `POST /page-introductions/:id/close` records it in
  the decisions file and emits `home.page_introduction_closed`, so every
  open browser drops it. Unlike a suggestion, it never returns.
- **One mechanism.** `usePageIntroduction(pageId)` in
  `@makinbakin/sdk/hooks` asks `GET /page-introductions` once per page
  load for every page, hands a page its introduction or null, and closes
  optimistically. A page never fetches or stores this itself. A page
  without an entry always gets null, so the hook is safe anywhere.
- **Where it renders.** Each page puts a kit `Alert` (accent, with an
  `AlertAction`) in its `PageBody` `feedback` slot, the slot the kit
  keeps for feedback that stays with usable content. The four pages whose
  body runs edge to edge (Chat, Tasks, Team, Schedule) wrap it in the
  inset the row above it uses. Chat shows it on the list only.
- **Empty states.** The plan also called for real empty states on these
  pages. Each already had one (for example "No chats yet", "No assets
  yet" with its upload action, "No scheduled jobs yet"), so none was
  changed.

## Decisions

`~/.bakin/plugin-data/home/decisions.json` (`lib/decisions.ts`). Today:
`introduction` (`skipped`, `completed`, or `pending` with the answers),
`saidHello`, `dismissedSuggestions` (suggestion id → when it was put
away) and `closedPageIntroductions` (page → when it was closed). Keys this version does not know are kept across a write. A
file that cannot be parsed means "nothing decided" and is left as it is
until the next real decision.

## UI

Patterns: `pages/page.stories.tsx` (standard width),
`feedback/system-state.stories.tsx` for loading, errors and "unavailable",
`feedback/handoff-card.stories.tsx` for logging in,
`lists/list-rows.stories.tsx` (`InteractiveRows`) for starters, the
conversation kit's `Composer`, and for the introduction
`conversation/turns.stories.tsx`, `forms/form-composition.stories.tsx`,
`primitives/radio-group.stories.tsx` and `feedback/alert.stories.tsx`
(also the hello offer). Suggestions are `lists/list-rows.stories.tsx`
rows with a trailing `ListRowActions` (the `DenseRows` anatomy, always
visible). The tour is `overlays/dialog.stories.tsx`
(`ControlledFocusReturn`). Home's fixture
(`plugins/home/tests/ui.fixture.tsx`) is enrolled in the conformance suite.

## Tests

`tests/plugins/home/`: content, decisions, state machine, fact gathering,
the suggestions engine (every condition, unknown evidence, the thirty
days), the routes, the introduction's writes (a failure injected at each step),
start-chat, and the page (ready, hello, the introduction, reopening,
logging in, suggestions, the tour). `tour.test.ts` holds the slides to
the sidebar. `page-introductions.test.ts` covers who is offered
them; `tests/hooks/use-page-introduction.test.tsx` covers the shared hook;
the Health page test covers a page showing and closing one. `tests/hooks/use-suggestion-count.test.tsx` and
`tests/components/sidebar-promo.test.tsx` cover the sidebar's count. `tests/hooks/use-terminal-handoff.test.tsx` and
`tests/plugins/health/handoff-return.test.tsx` cover the shared handoff.
`tests/core/team-context-operator.test.ts` covers the person's name in
global context. End to end:
`tests/integration/onboarding/scenarios/home.test.ts` boots a real server
on a throwaway home.
