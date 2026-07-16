# UI Patterns & Gotchas

Cross-cutting UI lessons distilled from the chat/conversation-kit overhaul (2026-07). Read before any UI work — most of these bit us live and each cost a round-trip to find.

## Bugs to never repeat (root cause → rule)

1. **`useQueryState` double-setter lost update.** Calling two `useQueryState` setters in the same tick each builds its URL from the *render-time* params snapshot, so the second clobbers the first. (Symptom: opening a chat instantly bounced back to the launcher.) **Rule:** for a transition that changes >1 query param, use ONE navigation that reads `window.location.search` at call time (see chat-page `setParams`), not two setters.

2. **Accent/pink hover hides content.** `hover:bg-accent` is the theme's pink; a destructive-tinted icon on it is invisible, and a selected row using `bg-accent`/`text-accent-foreground` reads as unreadable pink-on-gray. **Rule:** neutral chrome only — `hover:bg-foreground/10` (buttons), `hover:bg-foreground/5` (rows), selected `bg-foreground/10`. Reserve accent/attention color for signal ONLY (unread pills, working spinners), never for hover/selection.

3. **Patching from stale prop re-applies forever.** A pin toggle sent `{pinned: !chat.pinned}` from a stale `chat` prop, so the 2nd click re-pinned. **Rule:** after a PATCH, refresh the component's own source state (or update optimistically) — never toggle off a value the server already flipped.

4. **Optimistic row must carry EVERYTHING.** The optimistic user message omitted attachments, so thumbnails lagged to the post-turn refetch ("funky, then it showed up"). **Rule:** the optimistic row includes every field the durable row will (attachments, etc.).

5. **Below-content action rows reserve phantom height.** Hover actions placed in a row *under* a message bubble left an empty "copyable-looking" line under every message. **Rule:** float hover actions inline-left or in a dedicated gutter/absolute chip — never a reserved block that costs height when idle.

6. **Ad-hoc vertical offsets misalign avatars.** Stray `mt-0.5`/`pt-1` floated the avatar above the first content row. **Rule:** avatar and first content row share the same top edge; for a bare "thinking…" row give the shimmer `min-h-8` (= sm avatar) so it centers.

7. **Silent async = broken async.** Attachments uploaded with no thumbnail, no remove, no failure signal. **Rule:** immediate optimistic staging (uploading chip → thumbnail with remove-X), error toast on failure, hold send while uploads are in flight.

8. **Refresh on the event BEFORE your write races it.** The badge provider refreshed on `chat.done`, which fires before the `seen` POST lands → stale unread count. **Rule:** emit a client-side synthetic event AFTER a mutating write completes and refresh off THAT (see `chat.seen`), not off the event that precedes it.

9. **Stale-response guard must run after the body read.** The active-id guard ran before `await res.json()`, so a slow response for the previous selection rendered after switching. **Rule:** re-check the active-id guard AFTER the body parse too, not only before the fetch.

10. **First paint shouldn't wait on a server round-trip.** Roster/avatars took seconds because nothing rendered until `/api/plugins/team/` resolved (it round-trips the runtime adapter). **Rule:** hydrate the store synchronously from a shape-validated localStorage snapshot, render instantly, let the fetch refresh as source of truth. ALWAYS shape-validate the cache before hydrating — a malformed cache must never poison the shell.

## Patterns to reuse

- **The four settings-surface components (brands UX pass, 2026-07).**
  `SaveBar` (staged-draft dirty state + explicit "Saved ✓" flash +
  `useUnsavedGuard`; converges with PluginSettingsRenderer's
  disabled-until-dirty idiom — migrating the renderer onto it is an open
  follow-up), `SectionCard` (title + icon + one-line why-this-matters
  description — every user-facing section should explain itself),
  `AssetPicker` (thumbnail grid + search + upload-new; never a raw assetId
  `<select>`), `DangerZone` (typed-confirm destructive section, bottom of
  Settings; composes `ConfirmDialog`'s optional `confirmValue` — ONE confirm
  engine, never a parallel confirm implementation).
- **The sidebar tells a fixed three-region story.** Chat and Tasks stay in
  the fixed primary region; Plan & Automate, Create, Operations, and optional
  Mix-ins share the scrollable middle; Make Bakin Yours, Runtime, and
  Settings stay fixed at the bottom. The 52px rail hides heading text and
  exposes every group through one hover/focus/click flyout. Mobile always
  renders the full expanded drawer. Plugins choose only a defined section or
  omit it for Mix-ins—never invent headings or placement behavior.
- **Nav + search-hit icons resolve through maps.** A manifest `nav[].icon`
  should exist in app-sidebar's `ICONS`; unknown or omitted nav icons fall
  back to `Puzzle`. A hit renderer `icon` must exist in the ⌘K overlay's
  `HIT_ICONS` or it renders the generic search-result treatment.
- **The wait-for-the-agent story.** Any flow that dispatches an agent and
  returns must land the user somewhere that shows the work happening (banner
  with the task link + live activity), never a silent created-thing (brands
  drafting banner; `?draftTask=` handoff).
- **Tooltips are Base UI**: `TooltipTrigger render={<el/>}`, NOT Radix
  `asChild` — and wrap in `TooltipProvider delay={200}`.
- **TanStack search params are JSON-parsed.** `?create=1` arrives as the
  NUMBER 1, not `'1'` — String()-coerce before comparing. RTL mocks that
  return strings hide this; it only breaks in a real browser.
- **Wholesale PUTs need server-owned fields.** A "replace the manifest" route
  that trusts the whole body lets a stale staged snapshot flip state it
  shouldn't own (a saved draft flag silently un-published a brand). Lifecycle
  state (draft/publication, stamped task ids) is carried over from disk
  server-side AND omitted from the route's body schema; clients strip it too.
- **Confirm dialogs must compute their action from confirm-TIME state.** An
  `apply` closure captured at open time stages data from a render that may
  have refreshed underneath (agent writes) — store a `(current) => patch`
  function and feed it the live entity on confirm.
- **Per-request SSE turn routes: wire the abort chain end-to-end.** The node
  adapter now builds Requests with a real `req.signal` (aborts when the client
  socket closes un-ended); the route combines it with a `ReadableStream
  cancel()` into ONE AbortController passed to `messaging.stream` — otherwise
  Stop/tab-close leaves the agent turn running and billing. And when the
  prompt carries full context each turn, use a PER-TURN threadId: a stable
  session re-accumulates those prompts (quadratic token cost) and a zombie
  aborted turn can interleave the next turn's session.
- **Staged-draft surfaces need four guard rails** (brands review, 2026-07):
  key the component by the route param (same-route param nav reuses the
  mounted component — state bleeds across records); freshness-gate whole-
  record PUTs when something else may write concurrently; clear the draft by
  snapshot-compare so mid-flight edits survive; and wire
  `useUnsavedChangesGuard` (SDK) — beforeunload alone does not cover in-app
  navigation.
- **`useUnsavedChangesGuard` is in the SDK** (promoted from workflows):
  beforeunload + TanStack history block + anchor interception + exit dialog.
  Never hand-roll a navigation guard.
- **`useHistoryBack(fallback)` is THE back-button pattern** for detail surfaces
  reachable from more than one place: real `history.back()` when the app has
  history, the canonical parent route on a cold deep-link. Hard-coded
  `navigate({to: parent})` strands cross-surface arrivals (asset viewer bit
  this).
- **`StatusBadge` is THE status chip** — one tone scale
  (neutral/success/warning/destructive/accent). Ad-hoc Badge classNames
  drifted into three different Draft chips in one plugin.
- **Embedded agent brainstorm = conversation kit, per-request SSE.** A plugin
  route streams `messaging.stream()` as `event: chunk/done/error` frames
  (`readConversationSseStream` contract) + client `ConversationPanel` +
  `useConversationStream` with session-only messages. Reference:
  brands doc-editor brainstorm. `ephemeral: true`, agent told to reply in
  chat and never write files.

- **One engine per domain; components are thin.** `foldConversation` is THE folding engine — every surface composes the kit, none hand-rolls. Killing the three duplicate folders + the parallel `IntegratedBrainstorm` renderer was the whole win. Look for the existing engine before writing rendering logic.
- **Design tokens only — no hardcoded palettes.** `IntegratedBrainstorm`'s hardcoded zinc/purple was the anti-pattern. Kit files are token-only (a test greps for `zinc-`/hex leaks).
- **Human-first, depth on demand.** JSON replies render humanized (`formatStructured`) with raw JSON behind `<details>`; tool calls show a humanized activity summary → expand to rows → `BakinDrawer` for full input/output. "Right amount of detail, deeper one click away."
- **Reserved control gutters.** Agent turns reserve a right-edge column for time/copy/(future menu) so content never collides and new actions have a home without relayout.
- **Capability-gated affordances explain themselves.** The attach button enables only per `capabilities().input.imageInput`; disabled state carries an honest tooltip. Never a silently-dead control.
- **Empty + loading states everywhere.** Launcher (agent cards + recents) instead of "select a chat"; skeletons in rail + launcher; designed empty states with suggestion chips. A blank pane is a bug.
- **Attention layering.** Nav badge (global `nav-badge-providers` slot → works cross-page) + `(N)` tab-title prefix + toast + sound + OS notification, with suppression (viewing the surface = no fanfare). Read state is SERVER-side (`lastSeenAt`), survives reloads/devices.
- **URL-back all view/filter state.** `useQueryState`/`useQueryArrayState`, `<Suspense>`-wrapped (mind gotcha #1).
- **Assemble from the SDK first.** nav badges, `toast()`, `browser-notify`, `useVerticalResize`/`useAutoGrow`, `FacetFilter`/`AgentFilter`, `BakinDrawer`, `EmptyState`, `AgentAvatar`, `MarkdownContent` all already exist. The SSE bus + `usePluginEvent` are global (fire on any page). Check before inventing.
- **ChatGPT-class input.** One rounded container, `+`/attachments in the left slot, borderless auto-grow textarea, circular send/stop on the right, dedicated attachment strip, drag-to-resize handle, and typing NEVER blocked while streaming (only send waits).

## Testing / process

- Every RTL test imports `rtl-settle`; race-prone assertions end with `await settleReact()` (CI's 2-vCPU runners hit these deterministically).
- Use `data-*` hooks (`data-conv-*`, `data-chat-*`) so tests assert behavior, not styling classes.
- Pin behavioral contracts as pure-function tests (folding, keyboard matrix, attention suppression rules) — cheap and they bite.
- **Build-stamp trap:** never `git add -A` after a local `bun run build`; if `_embedded-assets-static.ts` or generated docs churned, `git checkout` them before switching branches/committing.
- Verify against an isolated boot (`/verify` skill) with the guest-URL settings guard — a default-settings isolated home re-provisions the machine-global antfly LaunchAgent.
