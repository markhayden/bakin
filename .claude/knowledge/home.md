# Home

The page Bakin opens on. Spec: `.claude/specs/home-first-run.md`; plan:
`.claude/specs/home-first-run-plan.md`. This file describes what is built.

**Built so far (plan PRs 1 to 3, Phase 1):** the `home` core plugin, its
page at `/` (first in the sidebar), the state route, and a screen for
every state: the introduction, logging in, the ready prompt with starters
and the first hello, and "unavailable". `/home` redirects to `/` with its
query string. Phase 2 (suggestions, "Do more with Bakin") and Phase 3 (the
tour) are not built.

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
most. A starter whose machine need is missing becomes a suggestion in
plan PR 4. The list is expected to change once it has been used.

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

## Decisions

`~/.bakin/plugin-data/home/decisions.json` (`lib/decisions.ts`). Today:
`introduction` (`skipped`, `completed`, or `pending` with the answers) and
`saidHello`. Keys this version does not know are kept across a write. A
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
(also the hello offer). Home's fixture
(`plugins/home/tests/ui.fixture.tsx`) is enrolled in the conformance suite.

## Tests

`tests/plugins/home/`: content, decisions, state machine, fact gathering,
the routes, the introduction's writes (a failure injected at each step),
start-chat, and the page (ready, hello, the introduction, reopening,
logging in). `tests/hooks/use-terminal-handoff.test.tsx` and
`tests/plugins/health/handoff-return.test.tsx` cover the shared handoff.
`tests/core/team-context-operator.test.ts` covers the person's name in
global context. End to end:
`tests/integration/onboarding/scenarios/home.test.ts` boots a real server
on a throwaway home.
