# Team Plugin — Deep Reference

## Purpose

The team plugin is Bakin's adapter layer over OpenClaw's agent roster. It derives the entire team page — every agent card, every edge, the full pyramid — from whatever `openclaw.json` reports at runtime, decorated with Bakin-owned UI data (avatars, display overrides, heartbeats). Bakin **never** copies OpenClaw state; identity, rules, tools, soul, and workspace files all stay in `{OPENCLAW_HOME}/`.

## Canonical Main Agent Contract

The orchestrator id is always the literal string `"main"` on every OpenClaw install. Display names come from `identity.name` on that entry. No detection heuristic, no settings override, no rename logic.

- `packages/core/src/main-agent.ts` — `getMainAgentId()`, `tryGetMainAgentId()`, `getMainAgentName()`
- `packages/core/src/openclaw-config.ts` — single mtime-cached reader for `openclaw.json`. All three helpers above call through here. Live edits are picked up on the next call.
- `src/core/onboarding/openclaw.ts` — doctor check that flags missing `main`, duplicate ids, duplicate workspaces. Reports only, never auto-fixes. Run via `bakin check openclaw`.

`BakinSettings.agents` and `BakinSettings.mainAgentId` **do not exist**. If you find a reference to them in tests or production code, it's a bug — use `getAgentIds()` / `getMainAgentId()` instead.

## Read Path: openclaw-adapter → listAgents

`plugins/team/lib/openclaw-adapter.ts#listAgents()` is the single read entry point for "the full roster as Bakin wants to render it." It:

1. Reads `openclaw.json` via `readOpenClawConfig()` (mtime-cached).
2. **Validates:**
   - If no entry has `id: "main"` → returns `[]` and logs an error. The UI shows an empty team rather than a broken pyramid.
   - Duplicate ids → first-wins, logs an error with the discarded entry.
   - Duplicate **resolved workspaces** (explicit `workspace` field, falling back to `defaults.workspace`) → first-wins, logs an error.
3. Merges Bakin-owned display data (`~/.bakin/plugin-settings/team.json` → accent colors, display name overrides, teamId assignments).
4. Merges heartbeats from `~/.bakin/heartbeats/{id}.json`.
5. Returns `AgentWithStatus[]`.

The adapter is **read-only**. It never writes back to `openclaw.json`. User-initiated agent CRUD goes through the separate `addAgent`/`removeAgent` paths which write via the OpenClaw gateway, not the filesystem.

## Pyramid Builder: build-graph.ts

`plugins/team/lib/build-graph.ts#buildGraph()` is a pure function — identical inputs produce identical outputs, no React, no side effects. The team-grid component is a thin xyflow wrapper that calls it.

### Row layout

| Row | Contents |
|-----|----------|
| 0 | Founder card ("Mark") |
| 1 | Main agent card (row 1 derived from `mainAgentId`, not from `topAgentIds`) |
| 2 | Non-main team leaders (sub-orgs whose `reportsTo` points at a non-main agent) |
| 3+ | Team section headers + member cards, grouped per reporter |
| +1 | Unassigned bucket (agents never placed) |

### reportsTo resolution

`resolveReporter()` treats all of these as "reports to main":

- `reportsTo === null`
- `reportsTo === undefined`
- `reportsTo === ""` (empty string)
- `reportsTo === someUnknownAgentId` (graceful degradation — don't orphan, don't crash)

This runs at render time. Stored `team.json` values are never rewritten on read.

### Broken roster degraded state

If `listAgents()` returned `[]` (missing `main`), the builder renders founder only. No orphan subagents, no synthesized sections. This is the intentional signal that OpenClaw state is broken — the UI stays quiet and points the user at `bakin check openclaw`.

### Synthetic "All agents" section

When `teams.length === 0` and the main agent has subagents, the builder synthesizes a single "All agents" section under main. Fresh installs get a visible pyramid shape without requiring the user to define any teams.

## Write Path: POST/PUT /teams normalization

`plugins/team/index.ts` owns the `teams` route. Both create (POST) and update (PUT) call `normalizeReportsTo()` before persisting:

```
normalizeReportsTo(input):
  if input === undefined || null || ""       → null
  if input === getMainAgentId() (try/catch)  → null
  else                                       → input
```

`null` is the canonical on-disk representation for "reports to main". This keeps stored team.json tidy and avoids the "display name drift" bug where renaming the main agent orphans every team that stored the old name.

Read path degrades too: in the GET / handler, `degradeUnknownReportsTo()` rewrites any `reportsTo` string that isn't in the current roster to `null` with a warning log. Read-side degradation is non-mutating — the stored file is never rewritten on read.

`OrgTeam.reportsTo` in `plugins/team/types.ts` is typed `string | null` to match.

## Client Store

`plugins/team/hooks/use-agent-store.ts` — single Zustand store loaded on app init. Exposes:

- `useAgent(id)`, `useAgentList()`, `useAgentIds()`, `useAgentColor(id)`
- `useMainAgentId()` — reads the `mainAgentId` field the roster route returns (server-side `getMainAgentId()`). Used by `TeamGrid` to pass the canonical root into `buildGraph`.

Components never compute "who is the main agent" themselves — always read it from the store.

## Test Coverage Map

| Concern | Test file |
|---------|-----------|
| mtime-cached reader + helpers | `tests/core/openclaw-config.test.ts` |
| main-agent canonical resolver | `tests/core/main-agent.test.ts` |
| Adapter validation + dedupe | `tests/plugins/team/openclaw-adapter.test.ts` |
| Pyramid graph builder | `tests/plugins/team/build-graph.test.ts` |
| Write normalization + read degradation | `tests/plugins/team/routes.test.ts` |
| Doctor integrity check | `tests/core/onboarding/openclaw.test.ts` |

## Common Pitfalls

- **Don't add settings.agents back.** The field was deleted for a reason — having two sources of truth caused the original "duplicate main-operator + main" bug on production.
- **Don't cache openclaw.json in a new spot.** `openclaw-config.ts` is the single reader. Add helpers there; don't re-stat from another module.
- **Don't write to openclaw.json from validation code.** The adapter is read-only. Integrity problems are the user's job to fix — surface them via the doctor, don't auto-heal.
- **Don't hard-code the main agent's display name** (e.g. "Main Operator"). It varies per install. Always resolve via `getMainAgentName()` server-side or `useMainAgentId()` + `useAgent(id)` client-side.
- **Don't skip the test mocks.** `tests/plugins/team/*` must mock `@bakin/core/openclaw-config`, `@bakin/core/openclaw-home`, and `src/core/content-dir` — leaking into `~/.openclaw/` has caused real incidents.
