# Spec: Home and the first-run experience

Status: **built (2026-11-14)**; see the plan's status and
`.claude/knowledge/home.md` for what shipped, which departs from this spec
where the design pass changed it (for example: no skip on a first run, the
tour is illustrated, page introductions are floating callouts). Approved for
planning 2026-11-13. Supersedes the seed
`onboarding-ui-wizard.md` (deleted): the interview moved away from a second
setup wizard. Mockup of the direction (not the design):
https://claude.ai/artifact/TjNWn1kMdySSHaFdMPZGqt

## 1. Objective

Opening Bakin for the first time drops a new user onto an empty task board
with no explanation. Less technical users who get past that find a lot of
value; many do not get past it.

Bakin gets a **Home** page. On a new home it is a welcome: meet your main
agent, get it able to answer, do one real thing. As the home fills in, the
same page becomes the hub: ask for something, see what needs you, find what
to add next.

The CLI stays the way a machine is set up (`bakin onboard`). Nothing here
replaces it, asks "terminal or browser", or changes which runtime a home
uses. Home starts where the CLI ends, on a running, onboarded server.

**Who it is for:** a less technical person who installed Bakin and ran
`bakin onboard` on defaults (or had an installer do it). Also every existing
user, who lands on Home from now on.

**Three parts, three phases:**

| Part | What it is | Phase |
|---|---|---|
| Engage | Meet your agent, log in, "What do you want to do?", starters | 1 |
| Grow | "Do more with Bakin": suggestions from what is and isn't set up | 2 |
| Tour | A click-through modal of the key areas, plus each page introducing itself | 3 |

One spec, so the page is designed once. Each phase ships on its own.

### Success criteria

1. On a fresh Pi home, a person who has never used Bakin names their
   agent, is shown exactly how to log in to a provider, and gets a reply
   from that agent once they have.
2. `/` renders Home on every install. Nothing redirects to `/tasks`.
3. A home whose main agent is already named never sees the introduction.
4. Home never offers an action that cannot work: with no provider logged
   in, the prompt and starters are visibly unavailable and say why.
5. Everything Home shows is derived from the machine's real state, never
   from a record of what was clicked during CLI onboarding.
6. Every new browser surface passes `bun run ui:conformance --full` with no
   unapproved deviation.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | No browser setup wizard. The CLI sets the machine up; Home is the first-run experience. | The jarring moment is the empty interface, not the terminal. Removes the pre-onboarding server, the runtime question in a browser and a mid-wizard restart. Survives per-agent runtimes. |
| D2 | Home is a real page at `/`, for everyone, with no "start on Tasks" setting. | One behaviour for `/`. If landing there grates, that is the signal the hub is needed sooner; a setting would hide it. |
| D3 | Order: Engage, then Grow, then Tour. | A first success teaches more than a tour; Grow's engine mostly exists; the tour is best written once the rest has settled. |
| D4 | The first thing on a fresh home is naming the main agent, its personality, and what it should call you. | A fresh Pi main agent is called "Main" with no personality. OpenClaw walks you through this; Pi does not. |
| D5 | The introduction is scripted by Bakin and laid out as a conversation; then the person says hello and the agent answers for real. | Works before any provider login and is predictable on a first impression. Built so a real agent turn can replace the script (D5a). |
| D5a | The questions are one data script rendered through the conversation layout. | Swapping the driver for a real turn later must not change the screen. "Does it feel organic?" is judged after use. |
| D6 | The prompt starts a chat with the main agent. | A reply in seconds, in the voice just chosen. The main agent creates tasks itself when the request is real work. |
| D7 | Starters are a curated list (about ten), filtered to what this home can run. The first list is expected to change. | Curate, ship, then harden the ten against where the agent actually sends people. |
| D8 | Login is instructions, shown with the kit's existing handoff card. With the Terminal plugin active the card opens a browser terminal with the command typed in. No new login command. | Enough for the MVP. A Bakin-run login screen was considered and dropped: Pi's login is not exposed for it, and OAuth sign-in from a remote browser is unproven. Revisit after Phase 1. |
| D9 | Suggestions: at most three, each with a payoff sentence and a one-step action; never spend limits or brands. "Not now" hides one for 30 days. | Suggestions, not a chore list. Thirty days catches changed needs without nagging. |
| D10 | The sidebar's "Make Bakin Yours" card stays, shows a count when there are suggestions, and links to Home. | One card, no new sidebar element. |
| D11 | Tour = a modal slide deck (Chat, Tasks, Team, Assets, Schedule, Health), offered on Home, never auto-opened. No spotlight over the live interface. | A modal over "What do you want to do?" interrupts the most valuable moment. Spotlights are brittle. |
| D12 | Tour slides use small illustrations built from kit components, deliberately low fidelity. | They paint the picture and cannot be wrong when a page changes. Fallback: text and icon. |
| D13 | Each of those six pages introduces itself once, and empty pages get useful empty states. | Teaches on the real thing, at the moment it is needed; fixes the empty board even for someone who skips Home. |

### Settled from the code, not asked

- **Rename and personality need no new backend.** `PUT
  /api/plugins/team/:agentId/identity` already takes `name`, `vibe` and
  `soul`.
- **Your name goes in the global context layer**
  (`~/.bakin/team/context/global.md`), so every agent knows it, not only
  the main one.
- **No avatar step.** Agents without a picture show their initial; Team
  handles pictures.
- **"Unnamed" is detectable on either runtime:** the main agent has its
  seeded name and no personality file.
- **The first real message is one the person sends.** The introduction
  ends on "Say hello to <name>", which sends a first message through
  Chat like any other. Bakin starts no turn nobody asked for, so spend
  limits and titling behave as they do for every chat.

## 3. What gets built

### Phase 1: Home and Engage

**The page.** `/` is a host route rendering a `home` core plugin's page
slot (the 15th core plugin), following the Explore precedent. Home appears
first in the sidebar.

**States, in order of precedence:**

| State | Condition | Shows |
|---|---|---|
| Meet your agent | Main agent unnamed and introduction not skipped | The three-question introduction |
| Needs a login | No provider logged in | Who your agent is, the login handoff, starters visible but locked |
| Ready | Otherwise | The agent's greeting (first time only), the prompt, starters |
| Unavailable | Runtime unreachable | An honest state pointing at Health; never a broken prompt |

**The introduction.** Three steps: name (with a few suggestions), how it
should come across (four presets, each with a sample line in that voice,
plus "describe it yourself"), what it should call you. Back, and "Skip for
now" on every step. Finishing writes the name, vibe and personality through
the Team identity route and the user's name into global context. Skipping
is remembered per home; the introduction stays reachable from Home and the
agent's Team page.

**Personality presets** are data: an id, a label, a sample line and the
personality text written to the agent. "Describe it yourself" writes the
person's own words into the same template.

**Login.** One server answer says whether the main agent can answer:
runtime reachable, a provider logged in, and the agent's model runnable
with it (the model-eligibility engine's verdict, not only the login
check). Home shows the active runtime's login steps in the kit's handoff
card; with the Terminal plugin active, the card opens a terminal with the
command typed in and the person presses Enter. "Check again" is always
available, and returning to Home rechecks.

**The prompt.** A composer from the conversation kit. Submitting creates a
chat with the main agent carrying that message and navigates to it.

**Starters.** A curated list in the catalog data, each with a title, a
one-line description, the prompt it sends and what it requires (an agent, a
capability, an attachment). Home shows up to six that this home can run.

**Saying hello.** The introduction's last step, or the first visit to a
ready Home after it, offers "Say hello to <name>": a first message the
person sends, answered in the agent's new voice, in a chat that is kept.

**Writes are resumable, not atomic.** The introduction's answers are
several writes (agent record, identity and personality files, the
person's name in global context). They run in a fixed order, each safe to
repeat, and "introduced" is a record written last. A failure midway
resumes; it never leaves the introduction hidden with half an agent.

### Phase 2: Grow

- **Suggestions engine** (pure): inputs are the setup checklist, installed
  agents, plugins and capability readiness, and dismissals; output is an
  ordered list. Curated entries live in the catalog with a condition, a
  title, a payoff sentence and an action.
- **Dismissals** stored per home with a timestamp; a dismissed suggestion
  is hidden for 30 days.
- **Home section** "Do more with Bakin": at most three.
- **Sidebar card** shows a count and links to Home's section; plain Explore
  link when there are none.
- The setup checklist gets its HTTP route here (deferred from the
  onboarding hardening spec).

### Phase 3: Tour

- **Modal tour:** six slides, one per area, each with a low-fidelity
  kit-built illustration, two or three sentences and one "do this first"
  line. Offered on Home. The last slide hands back to
  "What do you want to do?".
- **Page introductions:** a dismissible, remembered panel on first visit to
  Chat, Tasks, Team, Assets, Schedule and Health; real empty states on
  those pages.

### Later, not in this spec's phases

The hub (needs you, happening now, finished since last visit). Drawn in the
mockup to check Home earns its place. It gets its own spec once Phase 1 has
been lived with.

## 4. Commands

```
bun run typecheck
bun run lint
bun run check:cycles
bun run test:ci
bun run ui:conformance --quick      # while iterating
bun run ui:conformance --full       # before each phase's PR is ready
bun run ui:test:stories             # before pushing play-function changes
bun run docs:generate && bun run docs:validate
bun run onboard:rig --runtime pi --keep   # a fresh home to open in a browser
```

## 5. Project structure

| Where | What |
|---|---|
| `plugins/home/` | The new core plugin: manifest, server routes, client page, components |
| `packages/host/src/routes/index.tsx` | `/` renders the Home slot instead of redirecting |
| `packages/host/src/components/layout/` | Sidebar entry; the promo card's count |
| `packages/host/src/data/curated-catalog.json` (+ schema) | Starters, personality presets, suggestions |
| `src/core/onboarding/setup-checklist.ts` | Reused as an input; gains an HTTP route in Phase 2 |
| `storybook/public/` | Stories for anything new that is public |
| `tests/plugins/home/`, `tests/host/`, `tests/integration/onboarding/` | Tests |
| `.claude/knowledge/home.md` (new), `onboarding.md`, `docs/…/start/` | Docs |

## 6. Code style

Follows the repo's conventions (CLAUDE.md). Specific to this work:

- **Browser UI is Storybook-first.** Before any markup, name the public
  story each surface composes (`bakin-ui-conformance`). A missing pattern
  is raised with the maintainer before it is built, never worked around.
- **State is derived.** Home asks the server what is true now. The only
  stored facts are things a person decided: introduction skipped, a
  suggestion dismissed, a page introduction closed.
- **Curated content is data.** Starters, presets, suggestions and tour
  copy live in data files with a schema, not in components.
- **Plugins talk through hooks.** Home reads Team, Chat and Tasks through
  the hook registry or their HTTP routes, never by import.

```ts
// A suggestion is data plus a pure predicate over state. No component decides.
export interface Suggestion {
  id: string
  title: string
  payoff: string
  action: { kind: 'install-agent' | 'install-plugin' | 'navigate'; target: string }
  when: SuggestionCondition
}
export function suggestionsFor(state: HomeState, dismissed: Dismissals, now: number): Suggestion[]
```

## 7. Testing strategy

| Level | What it covers |
|---|---|
| Unit | The Home state machine (which state wins), the suggestions engine, dismissal expiry, starter filtering, preset → personality text |
| Component (RTL, act-clean) | Each Home state; the introduction's keyboard path; locked starters; the tour modal |
| Stories | Every new public pattern, with play coverage |
| Plugin routes | `tests/plugins/test-helpers.ts`: state, dismissals, start-chat, with a mocked runtime |
| End to end | The onboarding harness boots a real server on a throwaway Pi home: `/` serves Home, the state route reports "meet your agent", the identity write lands in the Pi home, and a named home reports "needs a login" |
| Manual | A fresh home walked in a browser at each phase boundary, including over Tailscale from a second device |

Not automated: whether the scripted introduction feels organic, and
whether the starters send people somewhere sensible. Both are judged in
use.

## 8. Boundaries

**Always**
- Derive what Home shows from current state.
- Run the UI conformance gate; name the story used.
- Keep the CLI onboarding flow working unchanged.

**Ask first**
- Any UI pattern the kit does not have (the tour modal's slide layout and
  the illustration miniatures are the likely ones).
- Anything that would make Bakin read, hold or transmit a provider secret.
- Changing what the CLI onboarding asks or installs.
- Starting an agent turn the person did not ask for.

**Never**
- A browser setup wizard, a pre-onboarding server mode or a runtime choice
  in the browser.
- Spend limits or brands as suggestions.
- A spotlight or coach-mark overlay on the live interface.
- Write to `~/.pi` or `~/.openclaw` on the maintainer's machine.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Terminal login steps stop a novice | Criterion 1 is met on paper only | The handoff card with a browser terminal where Terminal is installed; watch real first runs; a Bakin-run login is the follow-on |
| The main agent does not create tasks when it should | People chat forever and never find the board | Starters worded toward tracked work; the tour and page introductions explain the board; judged in use |
| Home is thinner than the task board it replaces, until the hub | Daily users find the landing page a step back | Accepted (D2); the hub spec follows Phase 1 |
| The tour modal or miniatures need a pattern the kit lacks | A conformance deviation | Raised for approval at plan time; text-and-icon fallback |

## 10. The first starters

Simple asks with little overhead, each doable with tools agents already
have. "Needs" is what the home must have for the starter to be shown.

| # | Starter | What the agent uses | Needs |
|---|---|---|---|
| 1 | Create an image | image generation | a provider that can make images |
| 2 | Research a topic | web search, then a written brief | the web search capability, with its key |
| 3 | Schedule a recurring task | the schedule tools | nothing extra |
| 4 | Summarize a document | PDF and file reading | an attachment |
| 5 | Break a goal into tasks | the task tools | nothing extra |
| 6 | Draft something for me | writing only | nothing extra |
| 7 | Brainstorm ideas | writing only | nothing extra |
| 8 | Edit an image | image editing | an attachment; an image-capable provider |
| 9 | Set up a daily briefing | the schedule briefing tool | nothing extra |
| 10 | Show me what you can do | a short guided example | nothing extra |

**A starter whose need is missing is not hidden for good: it becomes a
reason.** "Research a topic" on a home with no search key appears under
"Do more with Bakin" as "Let agents search the web: add the key". This is
the same rule that will later carry starters that need connections Bakin
does not have yet. "Clear my inbox each morning" would lead with "to do
that, let's connect Gmail". **No such connectivity is built here**: every
starter above runs on existing tools. The rule and the data shape
(`needs`) are what this spec provides for that future.

## 11. Resolved after draft 1

1. **Starters:** the ten in section 10, as data.
2. **Personality presets:** the implementer's choice; four, proposed in the
   plan, as data.
3. **Login:** instructions only for the MVP (D8); no new command.
4. **Help menu:** Bakin has none. The tour is offered on Home only. Whether
   Bakin needs a help menu is a separate question, noted for later and not
   built here.
