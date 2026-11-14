# Home

The page Bakin opens on. Spec: `.claude/specs/home-first-run.md`; plan:
`.claude/specs/home-first-run-plan.md`. This file describes what is built.

**Built:** the `home` core plugin at `/` (first in the sidebar; `/home`
redirects there with its query string), the state route, a screen for every
state, suggestions with the sidebar count, the tour, and the first-visit
callouts on six areas. A design pass after the plan replaced the plan's
first versions of the welcome, the ready Home, the tour dialog and the page
introductions; this file describes the current ones.

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

The response also carries `firstDay` (below), `person` (what the person
asked to be called, from global context, when known), the starters this
home is offered, the suggestions, and `login` on `needs-login`.

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
  verdict or a failed read are `unknown` and never block.

## The welcome (meet your agent)

`components/introduction.tsx`. A moment of its own, not a settings form:
while it shows, Home holds the host's full-screen state (`useHostStore`
`setFullscreen`), so the sidebar, header and activity rail are hidden. Home
releases it when the welcome ends, when the page changes (the host's own
rule), and whenever the state cannot be loaded: an error is never shown
without the app around it.

Three steps, one question each, in the agent's own voice under Bakin's pig
(`components/agent-face.tsx`, `/bakin-agent.png`):

| Step | Headline | Question | Button |
|---|---|---|---|
| name | "Oh good, you're here." | "What would you like to call me?" | "Call me <name>" ("Give me a name" while empty) |
| personality | "<name>. I like it." | "How should I come across?" | "That's me" |
| you | "One last thing." | "What should I call you?" | "Let's get to work" |

- **Personality** is four cards in a radio group (one tab stop, arrow keys
  move the choice) plus an always-visible text box: typing in it is the
  choice, clearing it goes back to the card last picked, and picking a card
  clears the words.
- **No skip** on a first run. The only way past without finishing is
  "Skip for now" inside the error, shown when saving failed, so nobody is
  stuck on a screen with no app around it.
- **Focus:** each field takes focus itself; the personality step, which
  has none, moves focus to its headline so the new question is read out.
- **Copy is scripted by Bakin,** with no model involved, so it works before
  any provider login and behaves the same every time.

`POST /introduction` (`lib/introduction.ts`) makes several separate writes
that cannot be atomic, so they are **resumable**:

1. the answers are recorded as `introduction: pending` in the decisions file;
2. `identity`: Team's `team.updateIdentity` hook renames the agent and
   writes its vibe and personality file;
3. `person`: `setOperatorName` (`src/core/team-context.ts`) writes a
   "Who you work with" block into `team/context/global.md`, which reaches
   every agent;
4. `sync`: a local agent sync, run as an operation;
5. `introduction: completed`.

Every step is safe to repeat. A failure answers `502 { ok: false, step,
error }`, the answers stay pending, and Home reopens the welcome on its
last step with everything filled in. The screen stays busy after a
successful save so a second press cannot save twice. An unknown
personality or a blank name is refused (400) before anything is recorded.
The audit record is `home.introduction_completed`.

**Reopening:** `/?introduce=1` opens the welcome over any Home that has an
agent ("Back for a rethink?"), starting from the name the agent goes by.
Leaving is a plain Cancel that records nothing. The main agent's Team page
links there ("Redo the introduction"). A home whose introduction was
skipped keeps a quiet link back (`introductionSkipped`).

## The ready Home

`ReadyView` in `components/home-page.tsx`. It carries its own heading
instead of a `PageHeader` (an approved departure, see UI below).

- **First day** (`firstDay` on the response, `isFirstDay` in `lib/state.ts`):
  the introduction was completed here and nothing has been asked for yet.
  Bakin's pig, "Well, look at that. We're all set.", the prompt and the
  starters. It ends with the first request from Home (`POST /first-request`,
  recorded as `firstRequest`), or as soon as there is work anywhere: a chat
  opened from the sidebar or a task on the board ends it too, and Home then
  records it.
- **Everyday:** the main agent's own avatar (or the pig), "Hey <person>,
  welcome back." and the prompt. Once there is work (any chat, or a task of
  the person's), four **area cards** and **recent activity** appear:

| Card | Shows | Leads to |
|---|---|---|
| Tasks | total, with Planned (backlog + todo), In progress (in progress + review), Completed, Blocked | the board |
| Projects | active projects; "Add Projects" (Explore) when the plugin is not installed | `/projects` |
| Scheduled tasks | runs in the coming week, and how many jobs are on autopilot | the schedule |
| Team | how many agents, with their avatars | the team |

  Each card is tinted with its area's signal color. A page that could not
  answer says "Couldn't load this right now", never a zero Home does not
  know to be true; a 404 from Projects means "not installed". Bakin's own
  Health tasks (`createdBy: system`) never count as the person's work.
  **Recent activity** is the five newest chats and tasks together, each a
  link; a chat counts from the later of its last message and the last time
  it was opened (tasks have no "last opened", so their last change counts).
- **Reading activity:** `lib/client/activity.ts` reads Tasks, Chat,
  Schedule and Projects through their own HTTP routes from the browser and
  reduces them with the pure `summarizeActivity`. It reads on every visit,
  and again when a chat turn finishes (`chat.done`) or anything on the board changes (the
  shell's `taskboard` event); changes that arrive together are read once, 750ms after the
  last (`REFRESH_SETTLE_MS`). Nothing below the prompt is drawn
  until the first read lands, so a returning person never sees the
  starters flash.

### Starters

Curated in `home-content.json` (validated by `lib/content.ts`): "Create an
avatar" (or "Create an image" once the main agent has an avatar, through
the starter's `when`), "Schedule a reminder", "Research a topic", "Break a
goal into tasks". Four at most are shown. Every shipped starter needs
nothing installed: a prompt that cannot be done yet asks the agent to say
what needs setting up. The `needs` rules (`capability`, `imageProvider`,
`agent`, `attachment`) still decide for any starter that declares one.

A starter that really went (`POST /starters/:id/used`, recorded only after
its conversation opened) is not offered again; the rest are shown as "A
few things we haven't tried yet." once there is work.

### Starting a conversation

The prompt and starters talk to the main agent through Chat's own HTTP
routes (`lib/client/start-chat.ts`): create the chat, then send. Nothing
typed is lost:

- chat not created → Home says so and the composer keeps the text;
- chat created, message not sent → the text is left as that chat's
  composer draft and the chat is opened anyway;
- a starter that needs a file → its words are left in Chat's draft composer
  for that agent (`/chat/new?agent=<id>`).

Home writes Chat's composer draft keys (`chat:<id>`, `chat-draft:<agentId>`)
through the kit's `writeComposerDraft`. A second submit while the first is
still creating its chat is ignored.

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
(`useTerminalHandoff` from `@makinbakin/sdk/hooks`). Coming back after
taking the command reads the state again, once
(`handoffReturnChannel('home')`); "I've logged in. Check again" does the
same by hand.

## Suggestions

Curated data plus a pure engine (`lib/suggestions.ts`); no component
decides what applies. Each entry in `home-content.json` has a title, a
payoff sentence, ONE action (a label and a path to a page that already
exists; Explore and Settings do the installing and the consent) and a
condition:

| Condition | Holds when | Asked of |
|---|---|---|
| `capability-missing` | no installed pack provides the capability | capability readiness |
| `capability-needs-key` | a pack provides it, none is ready, and a required key is not set | capability readiness |
| `no-image-provider` | no provider can make images | `images.canGenerate` |
| `agent-missing` | a named agent is not on the roster | the roster |
| `only-main-agent` | the roster is the main agent alone | the roster |
| `plugin-missing` | a plugin is not loaded | the plugin registry |
| `checklist-todo` | a setup checklist item is `todo` | the setup checklist |

- **Unknown never suggests.**
- **Only a ready Home** gets suggestions; other states do not ask the checklist.
- **Three shown** (`MAX_SHOWN`); `suggestionCount` is how many apply in all.
- **Never spend limits or brands:** the schema refuses an action that
  points at `/spend` or `/brands`.
- **"Not now" is thirty days** (`POST /suggestions/:id/dismiss`), and emits
  `home.suggestions_changed` so every open browser follows.

**On the page:** "Want more out of your team? Here are N upgrades." over
one panel with the accent rail (`id="do-more"`), one compact row each.
**In the sidebar:** the shell's `SidebarPromo` shows how many suggestions
Home lists and links to `/#do-more`; with none it is the plain Explore
card. The count is read by `useSuggestionCount`
(`packages/host/src/hooks/`) from Home's state route, again on every page
change and on `home.suggestions_changed`; it never counts anything itself.

Capability readiness is read ONCE per state read (`evidence()` in
`lib/readiness.ts`) and feeds both starters and suggestions.

## The tour

Six slides, one per area (Chat, Tasks, Team, Assets, Schedule, Health),
curated in `home-content.json` (`tour`): the area's name and sidebar icon,
two or three sentences, one thing to try first, its page, and an
illustration (`/tour-<area>.jpg`, served by the host). A test holds each
slide to the label, icon and address the area's own manifest gives its nav
item. `GET /api/plugins/home/tour` serves them.

- **Offered, never opened:** "New to Bakin? Take a two-minute tour of what
  is where." on a ready Home and while logging in, with a pink shimmer
  (`ShimmerText`; stills under reduced motion).
- **The slide is in the URL** (`/?tour=<slide id>`).
- **A wide kit Dialog** (`components/tour.tsx`, about 46rem) led by the
  slide's picture at 16:9, then "N of 6", the area, its text, Back,
  "Next: <area>", and Done on the last slide.
- **Illustrations** are Bakin's pig in each area, generated once with the
  Codex CLI from `/bakin-agent.png` as the style reference and committed as
  1280px JPEGs. To redo one, regenerate that file only.

## First-visit callouts (pages introduce themselves)

Chat, Tasks, Team, Assets, Schedule and Health each greet a new person
once, in Bakin's narrator voice ("Meet your new coworkers.", "This is where
the work lives.", …), curated in `home-content.json` (`pageIntroductions`,
keyed by the page's plugin id, with the area's tour illustration).

- **One renderer, in the shell:** `PageIntroduction`
  (`packages/host/src/components/layout/page-introduction.tsx`) renders the
  kit's `FirstVisitCallout` for whatever page is showing. No page renders
  its own.
- **Where:** floating at the bottom middle of the content area, about
  76px off its edge, clear of the controls pages keep in their corners,
  over a scrim that blurs and darkens the lower part of the page so the
  card reads on any background. It slides up and settles with one small
  bounce (none under reduced motion).
- **When:** only on an area's front page (`/chat`, never `/chat/<id>`),
  never on Home, never while a page holds full screen.
- **Who:** only a home where someone finished or skipped Home's
  introduction (`startedOnHome`, `lib/page-introductions.ts`). A home set
  up before Home existed gets none.
- **Closed is closed:** `POST /page-introductions/:id/close` records it and
  emits `home.page_introduction_closed`; it never returns.
- **One mechanism:** `usePageIntroduction(pageId)` in
  `@makinbakin/sdk/hooks` asks `GET /page-introductions` once per page load
  for every page, hands back `{ title, body, image }` or null, and closes
  optimistically.

## Decisions

`~/.bakin/plugin-data/home/decisions.json` (`lib/decisions.ts`):
`introduction` (`skipped`, `completed`, or `pending` with the answers),
`firstRequest`, `usedStarters` (starter id → when), `dismissedSuggestions`
(suggestion id → when) and `closedPageIntroductions` (page → when). Keys
this version does not know are kept across a write. A file that cannot be
parsed means "nothing decided" and is left as it is until the next real
decision.

## Avatars change live

Team's `bakin_exec_team_set_avatar` lets an agent set its own avatar from
a saved image asset (the "Create an avatar" starter ends with it). It and
the Team page's upload share one writer (`plugins/team/lib/avatar.ts`:
validated id, sniffed format, 12 MB cap checked before reading, atomic
write). Every avatar or identity change emits `team.agent_changed`; the
host's `AgentThemeProvider` reloads the roster on it, and the roster's
avatar address carries the file's time (`&v=<mtime>`), so every open
browser shows the new face without a refresh.

## UI

Patterns: `pages/page.stories.tsx`, `feedback/system-state.stories.tsx`
(loading, errors, unavailable), `feedback/handoff-card.stories.tsx`
(logging in), the conversation kit's `Composer`,
`primitives/card.stories.tsx` (`InteractiveCard`, `SelectedAndTone`) for
the starters, area cards and personality choices, `primitives/input.stories.tsx`
(large input), `lists/list-rows.stories.tsx` (`DenseRows`,
`InteractiveRows`) for recent activity and the upgrades,
`primitives/shimmer-text.stories.tsx` for the tour offer,
`overlays/dialog.stories.tsx` for the tour, and the new
`feedback/first-visit-callout.stories.tsx` (`FirstVisitCallout`) for the
page callouts. All of Home's copy balances its line breaks (`text-balance`
on the page body): no widows.

Approved departures, recorded in `design-system/exceptions.json`: the
welcome and the ready Home carry their own `h1` instead of a `PageHeader`;
the area cards and the callout use per-area / accent tints beyond the
kit's card tones.

Home's fixture (`plugins/home/tests/ui.fixture.tsx`) is enrolled in the
conformance suite.

## Tests

`tests/plugins/home/`: content, decisions, state machine (incl. the first
day), fact gathering, the suggestions engine, the activity summary
(`activity.test.ts`), the routes (first day, starter swap and tracking,
page introductions), the introduction's writes (a failure injected at each
step), start-chat, and the page (welcome, first day, everyday areas and
recent activity, reopening, logging in, suggestions, tour).
`tour.test.ts` holds the slides to the sidebar.
`tests/hooks/use-page-introduction.test.tsx`,
`tests/hooks/use-suggestion-count.test.tsx`,
`tests/components/sidebar-promo.test.tsx` and
`tests/plugins/team/exec-tools.test.ts` (the avatar tool) cover the shared
pieces. End to end: `tests/integration/onboarding/scenarios/home.test.ts`
boots a real server on a throwaway home.
