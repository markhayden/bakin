# Home

The page Bakin opens on. Spec: `.claude/specs/home-first-run.md`; plan:
`.claude/specs/home-first-run-plan.md`. This file describes what is built.

**Built so far (plan PR 1):** the `home` core plugin, its page at `/home`,
the state route, the ready screen (prompt and starters) and honest
placeholders for the other states. `/` still redirects to `/tasks`; it
switches to Home when every state has a screen (plan PR 3). Home has no
sidebar entry until then.

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
| `meet-agent` | the main agent is known to be unintroduced, and the introduction was neither skipped nor completed |
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

## Decisions

`~/.bakin/plugin-data/home/decisions.json` (`lib/decisions.ts`). Today:
whether the introduction was skipped or completed. Keys this version does
not know are kept across a write. A file that cannot be parsed means
"nothing decided" and is left as it is until the next real decision.

## UI

Patterns: `pages/page.stories.tsx` (standard width),
`feedback/system-state.stories.tsx` for every non-ready state,
`lists/list-rows.stories.tsx` (`InteractiveRows`) for starters, and the
conversation kit's `Composer`. Home's fixture
(`plugins/home/tests/ui.fixture.tsx`) is enrolled in the conformance suite.

## Tests

`tests/plugins/home/`: content, decisions, state machine, fact gathering,
the route, start-chat, and the page. End to end:
`tests/integration/onboarding/scenarios/home.test.ts` boots a real server
on a throwaway home.
