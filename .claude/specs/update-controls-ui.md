# Spec: Update Controls UI

## Objective

Add first-class update and removal controls to Bakin's browser UI.

Relevant issues:

- #384 - Agent package update needs a keep-vs-reseed choice for workspace templates.
- #395 - Agent package remove needs orphan-vs-delete semantics.
- #396 - Surface agent uninstall controls in the UI.
- #342 - Stale installed workflow skills. Related to repair/reseed semantics, but not the primary UI-control scope unless the implementation touches workflow-skill repair.

Success means:

1. The shell shows a top banner when a newer Bakin binary release is available, with a guarded update button.
2. Health's Active Plugins list shows current plugin version, upgrade availability, and an Upgrade button for user plugins.
3. Team agent detail package blocks show outdated state and offer an Upgrade flow.
4. Agent Upgrade uses a confirmation modal that explains the chosen mode.
5. Agent Remove uses a confirmation modal with two explicit modes:
   - Orphan: remove Bakin-managed projections and lockfile state, leave the runtime agent.
   - Delete: remove Bakin-managed projections and delete the runtime agent through the runtime adapter.
6. CLI supports explicit `agents orphan` and `agents delete` commands, keeps existing `agents remove` compatibility, and tests prove delete actually removes OpenClaw runtime-owned data, not just the package lockfile.

## Current Findings

### Bakin binary update

- `src/core/self-update.ts` already implements the binary replacement flow used by `bakin update`.
- `src/core/cli.ts` owns the binary-only `bakin update` command.
- The browser only has `GET /api/version`, served inline from `server.ts`.
- `selfUpdate()` replaces `process.execPath`; this is correct for compiled `bakin` binaries but unsafe when the dev server is running under `bun`.
- Needed: server-side status/apply routes that guard non-binary/dev mode before calling the self-update code.

### Plugins

- `GET /api/plugins/manifest?check=1` already performs user-plugin upgrade checks via `runChecks()`.
- Manifest rows include `version`, `source`, `installed`, `upgradeAvailable`, and `staleHintDays`.
- `POST /api/plugins/upgrade` already upgrades user plugins and supports widened-permission consent through `awaitingConsent`.
- Health's `/registry` route currently returns `pluginRegistry.getRegistrySnapshot()` only, which does not include `upgradeAvailable`.
- Health's Active Plugins UI currently fetches `/api/plugins/health/registry`, not `/api/plugins/manifest`.
- Needed: either enrich the Health registry route with check/status fields or have the Health page fetch `/api/plugins/manifest?check=1` for plugin inventory.

### Agent packages

- `GET /api/agent-packages` lists package state and now includes installed `version`.
- `POST /api/agent-packages/{agentId}/update` already accepts `{ refreshTemplate?: boolean }`.
- `updatePackageById({ refreshTemplate: true })` rewrites workspace template files from source, while still honoring `.userEdited` sentinels.
- The Team UI already has a forward-compatible `update-available` badge state, but the API never emits it.
- There is no preflight/check endpoint for "source has moved" before updating an agent package.
- Needed: add an agent package check path that can report current version, latest version, current commit, remote/current source commit, `upgradeAvailable`, and check errors without mutating installed state.

### Agent removal

- `bakin agents remove <id>` exists and maps to `DELETE /api/agent-packages/{agentId}`.
- Existing flags include `--keep-blocks`, `--delete-agent`, and `--force`.
- `removePackageById({ deleteAgent: true })` calls `runtime.agents.remove(agentId)` and then removes allowlist references.
- OpenClaw adapter `agents.remove()` currently calls `openclaw agents delete <id> --force --json`, resets config cache, and removes allowlist references. Issue #395 says this does not remove all runtime-owned artifacts in practice.
- Needed: verify adapter behavior locally, fix OpenClaw runtime delete if incomplete, and expose explicit UI modes.

## Assumptions

1. Bakin binary update checks use GitHub releases from `markhayden/bakin`, the same source used by `bakin update`.
2. The UI update button should not run in source/dev mode where `process.execPath` is `bun`.
3. Plugin update controls are for user plugins only; core plugin updates happen through Bakin binary updates.
4. Plugin upgrade button may need a second confirmation step if the API returns `awaitingConsent`.
5. Agent update controls are for managed/adopted agent packages only.
6. "Maintain changes" maps to `refreshTemplate: false`.
7. "Reseed templates" maps to `refreshTemplate: true` and still preserves `.userEdited` targets. `.userEdited` is an empty sentinel, not a patch; the actual edits remain in the runtime workspace file.
8. "Orphan" maps to package removal without runtime deletion. This mirrors Bakin's "adopt" concept: Bakin stops managing the agent but the agent remains in OpenClaw.
9. "Delete" maps to package removal plus runtime adapter deletion.

## Commands

Focused tests while implementing:

```sh
bun test --isolate tests/core/self-update.test.ts
bun test --isolate tests/api/bakin-update-routes.test.ts
bun test --isolate tests/api/plugin-manifest-embedded.test.ts tests/api/plugins-upgrade.test.ts
bun test --isolate tests/api/agent-packages-routes.test.ts
bun test --isolate tests/agent-packages/updater.test.ts tests/agent-packages/uninstaller.test.ts
bun test --isolate tests/adapter-openclaw/runtime-binary.test.ts
bun test --isolate tests/plugins/health/health-page.test.tsx tests/plugins/health/routes.test.ts
bun test --isolate tests/plugins/team/agent-detail-package-card.test.tsx tests/plugins/team/agent-detail-adopt.test.tsx tests/plugins/team/use-package-states.test.ts
```

Broader verification before completion:

```sh
bun run typecheck
bun test --isolate
```

Manual local smoke, using a temporary home:

```sh
BAKIN_HOME=/tmp/bakin-update-ui OPENCLAW_HOME=/tmp/openclaw-update-ui bun run server.ts --skip-onboarding-check
BAKIN_HOME=/tmp/bakin-update-ui OPENCLAW_HOME=/tmp/openclaw-update-ui bun run cli/bakin.ts plugins list --check
BAKIN_HOME=/tmp/bakin-update-ui OPENCLAW_HOME=/tmp/openclaw-update-ui bun run cli/bakin.ts agents list --packages
```

## Project Structure

Likely backend files:

- `src/core/self-update.ts` - release discovery and binary replacement logic.
- `server.ts` - current core route dispatch for `/api/version`; likely dispatches new update routes.
- `packages/host/src/core-routes/index.ts` - typed route contracts for new core update routes.
- `packages/host/src/api/plugins/manifest.ts` - existing plugin update-check source.
- `packages/host/src/api/plugins/upgrade.ts` - existing plugin upgrade source.
- `packages/host/src/api/agent-packages/list.ts` - add optional check query or route-adjacent status data.
- `packages/host/src/api/agent-packages/dynamic.ts` - update/remove endpoints already live here.
- `src/core/agent-packages/updater.ts` - update mode behavior.
- `src/core/agent-packages/uninstaller.ts` - orphan/delete behavior.
- `packages/adapter-openclaw/src/runtime.ts` - full runtime removal behavior.

Likely frontend files:

- `packages/host/src/components/layout/header.tsx` - top Bakin update banner.
- `plugins/health/components/health-page.tsx` - plugin outdated indicators and upgrade buttons.
- `plugins/team/components/package-card.tsx` - agent outdated indicator, update modal, remove modal entry points.
- `plugins/team/types.ts` - package state/update check fields.
- `plugins/team/hooks/use-agent-store.ts` - package state refresh after update/remove.
- `src/components/ui/dialog.tsx` - existing modal primitive to reuse.

Likely tests:

- `tests/core/self-update.test.ts`
- `tests/api/*update*.test.ts`
- `tests/api/agent-packages-routes.test.ts`
- `tests/agent-packages/{updater,uninstaller}.test.ts`
- `tests/adapter-openclaw/*`
- `tests/plugins/health/*`
- `tests/plugins/team/*`

Docs/knowledge:

- `.claude/knowledge/agent-packages.md`
- `.claude/knowledge/plugin-system.md`
- `.claude/knowledge/team-plugin.md`
- `.claude/knowledge/design-system.md`
- `.claude/knowledge/release-pipeline.md`

## Code Style

Keep state contracts explicit and source-of-truth based:

```ts
interface ManagedUpdateStatus {
  currentVersion: string
  latestVersion: string | null
  currentCommitSha: string
  latestCommitSha: string | null
  upgradeAvailable: boolean
  checkedAt: string | null
  error?: string
}
```

Do not parse versions out of package ids. Do not add a second update implementation in the UI; UI buttons call the same HTTP endpoints used by CLI behavior.

## UI Contract

### Bakin binary banner

- Location: top shell, above or integrated with the fixed header.
- Trigger: status endpoint reports `updateAvailable: true`.
- Content: current version, latest release tag/version, concise message, Update button.
- Modal: describes that the Bakin binary will be replaced and restart is required.
- Dev/non-binary mode: no update button; optional muted note only if a newer release is known.

### Health plugin list

- Keep dense table/list style.
- Columns: plugin, version, source, routes, status/actions.
- Core plugins: show version, no Upgrade button.
- User plugins: show version; if update available, show badge and Upgrade button.
- Upgrade modal: source, current version, target version/commit when known, permission changes if the first API call returns `awaitingConsent`.
- After success: refresh plugin inventory and make restart/reload implications clear when needed.

### Agent detail package block

- Show current installed version.
- Show outdated indicator when check says source moved.
- Upgrade button opens modal with two update modes.
- Delete button opens modal with orphan-vs-delete choices.
- After update/remove: refresh package states and agent roster as needed.

## Testing Strategy

Use prove-it tests first:

1. Binary update status route reports no update, update available, network error, and non-binary/dev refusal.
2. Health plugin UI renders update-available status and Upgrade button only for user plugins.
3. Plugin upgrade modal handles normal success and permission-consent response.
4. Agent package check route emits `update-available` when source commit/version differs.
5. Agent update modal sends `{ refreshTemplate: false }` for maintain-changes mode and `{ refreshTemplate: true }` for reseed mode.
6. Agent remove modal sends orphan and delete payloads correctly.
7. OpenClaw adapter full delete removes runtime roster/config/workspace artifacts required by #395.

## Boundaries

Always:

- Reuse existing update/remove APIs where possible.
- Keep destructive actions behind modals with explicit copy.
- Guard self-update from source/dev mode.
- Keep lockfiles as installed-version source of truth.
- Refresh UI state after any update/remove action.
- Test with temp `BAKIN_HOME` and `OPENCLAW_HOME`.

Never:

- Let browser UI overwrite `process.execPath` when the process is Bun/dev.
- Delete OpenClaw files directly from agent-package code; go through the runtime adapter.
- Add a hosted registry or bare-name package resolution.
- Parse installed versions from ids or source strings.

## Implementation Plan

### Phase 1: Contracts and Status APIs

- Add a Bakin update status endpoint and guarded update endpoint.
- Add route contracts in `core-routes`.
- Add agent package update-check support without mutating installed state.
- Decide whether Health should consume `/api/plugins/manifest?check=1` directly or the health registry route should proxy/enrich it.

### Phase 2: Agent Delete Semantics

- Reproduce #395 locally in adapter tests.
- Fix OpenClaw runtime delete behavior through adapter APIs.
- Add explicit `bakin agents orphan <id>` and `bakin agents delete <id>` aliases while preserving `bakin agents remove <id> [--delete-agent]`.
- Align CLI help text with Orphan/Delete wording.
- Update CLI registry/help/docs.

### Phase 3: Shell Bakin Update UI

- Add header-level update status fetch.
- Render banner and confirmation modal.
- Call update endpoint and show success/error state.

### Phase 4: Health Plugin Update UI

- Add plugin inventory status fields.
- Render outdated badges and Upgrade buttons.
- Add modal flow for normal upgrade and widened permission consent.

### Phase 5: Agent Detail Update/Delete UI

- Add package update/delete modals.
- Wire update modes to `refreshTemplate`.
- Wire remove modes to orphan/delete payloads.
- Refresh Team store and route state after actions.

### Phase 6: Docs and Review

- Update knowledge files and any user-facing command docs.
- Run focused tests, typecheck, and full isolated test suite.
- Review for destructive-action clarity and UI density.

## Commit Strategy

1. `test(update-controls): cover status and removal contracts`
   - Failing tests for binary status, agent package check, and OpenClaw delete.
   - Verify focused backend tests.

2. `feat(update-controls): add update status APIs`
   - Bakin update status/apply routes and agent package check status.
   - Verify API and core tests.

3. `fix(agent-packages): make agent delete remove runtime state`
   - Adapter/uninstaller/CLI delete behavior.
   - Verify adapter and uninstaller tests.

4. `feat(shell): add Bakin update banner`
   - Header banner, modal, update action.
   - Verify component tests.

5. `feat(health): add plugin upgrade controls`
   - Health inventory update status and plugin upgrade modal.
   - Verify health tests.

6. `feat(team): add agent update and delete controls`
   - Agent detail update/delete modals and store refresh.
   - Verify Team tests.

7. `docs(update-controls): document update and removal flows`
   - Knowledge/docs updates.
   - Verify docs-related checks if affected.

## Decisions

### D1: Agent reseed semantics

Issue #384 and the existing code are conservative: `refreshTemplate: true` rewrites workspace template files but still honors `.userEdited` sentinels. Your wording says "full update that rewrites all agent source files with the latest version (e.g. full rewrite?)".

Decision: make the UI option "Reseed package templates" and keep `.userEdited` as a hard stop. This fixes stale package templates while avoiding silent data loss. If a true destructive overwrite is needed later, add it as a separate third option named "Force overwrite user-edited files" with stronger confirmation.

`.userEdited` is an empty sentinel, not a patch file. It does not contain the user edits; it tells Bakin to leave the live runtime workspace target alone.

### D2: Plugin update check timing

Health can either run plugin update checks automatically when the Health page loads, or it can show a "Check updates" button that the user presses.

Decision: run checks automatically whenever the Health page loads/refreshes. This keeps the list immediately useful and matches the desired alerting behavior in the plugin list. The automatic check remains scoped to Health rather than every Bakin page.

### D3: Bakin update banner in dev/source mode

The update implementation replaces `process.execPath`, which is correct for a compiled `bakin` binary but unsafe when running the app from source with `bun run server.ts` or `bun run dev`.

Decision: in dev/source mode, hide the top update banner entirely and have the update status endpoint report `{ supported: false }`. The update banner is a production/runtime-binary feature only. Local development is inherently custom/current and should not offer binary replacement.

### D4: Plugin update check cadence

Health currently refreshes its page data every 10 seconds. Plugin update detection for GitHub sources runs `git ls-remote`; doing that every 10 seconds for every user plugin would be noisy and unnecessary.

Decision: check automatically on Health page load, then throttle automatic checks to once per hour while the page remains open. Continue rendering cached `upgradeAvailable` status on every normal 10-second Health refresh. Add a manual "Check now" button that bypasses the throttle/cache and refreshes plugin update status immediately.

### D5: Agent remove mode naming

The behavior choices are:

- Remove Bakin-managed package/projections/lockfile state, leaving the runtime agent intact.
- Remove Bakin-managed state and delete the runtime agent through OpenClaw.

Decision: use "Orphan" and "Delete" in the UI. "Orphan" is the non-runtime-delete path and mirrors the existing "Adopt" concept: Bakin stops managing an agent, but OpenClaw keeps it. "Delete" removes Bakin-managed state and deletes the runtime agent through OpenClaw.

CLI decision: add explicit `bakin agents orphan <id>` and `bakin agents delete <id>` commands. Keep `bakin agents remove <id>` as the compatibility spelling for orphan, and keep `--delete-agent` on `remove` for existing scripts. Help text should steer new usage toward `orphan` and `delete`.
