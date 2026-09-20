# Spec: OpenClaw 2026.9.5 `agents.entries` Compatibility (#873)

**Issue:** https://github.com/markhayden/bakin/issues/873
**Status:** approved 2026-09-20 (interview complete)

## Objective

OpenClaw 2026.9.5 moved its agent registry from the legacy `agents.list` array to a
keyed map — `agents.entries` (id = key) with `agents.ownership: "explicit"` and richer
`agents.defaults`. Bakin's adapter only knows `agents.list`, so against a migrated
config the roster collapses to one synthesized Main: Team UI shows a single fake
agent, MCP provisioning prunes every real agent's `bakin-*` server, package
adopt/sync contradicts itself ("does not exist" vs "already exists"), and several
write paths inject a competing legacy `agents.list` into a 9.5 config.

Both of the user's boxes are on 2026.9.5 with migrated configs (`~/.openclaw/
openclaw.json` on this machine: 10 agents under `entries`, `ownership: explicit`,
no `list` key — the live repro).

Success: the adapter reads/writes the 9.5 format natively, never regresses a config
to the legacy shape, never fabricates agents from an authoritative registry, and the
whole change is **siloed to `packages/adapter-openclaw/` + its mock/rig/tests** —
zero contract, SDK, core, or Pi changes (hard constraint from the interview; the
adapter-boundary architecture test already enforces the silo).

## Ground truth (observed on OpenClaw 2026.9.5, this machine)

- Config: `agents: { defaults: {...}, entries: { <id>: {...} }, ownership: "explicit" }`.
- Entry fields (all optional): `name`, `workspace`, `agentDir`,
  `identity: { name, emoji }`, `subagents: { allowAgents: [...] }`, `models: {...}`,
  and **polymorphic `model`**: plain string (`"openai/gpt-5.5"` on main) OR object
  (`{ primary, fallbacks? }` on pixel). Reads must accept both; `agentModelPrimary`
  already does.
- `agents.defaults` carries `model.primary/fallbacks`, a `models` map, `workspace`.
- `openclaw agents list --json` still returns a flat array with `id` — CLI-shelling
  reads were never broken; only Bakin's direct config-file access is.
- No version/schema field exists in the config; no `--version` probe exists in the
  adapter. Detection is shape-sniffing (matches the auth-profiles dual-source
  precedent, `runtime.ts:1096`).

## Design Decisions (interview-locked)

### D1 — Entries-canonical: read-fallback, write-entries-always, one-way upgrade
- **Reads:** `agentListFrom()` becomes the SOLE decoder: `agents.entries` when
  present (`Object.entries(...)` with the key as `id`; an entry's own `id` field, if
  any, is ignored in favor of the key) → else legacy `agents.list` → else the D2
  synthesis rules. The legacy fallback is ~3 lines in exactly one function —
  tolerance for pre-9.5 homes (old backups, pinned rigs), not a shim sprawl.
- **Writes: entries only, always.** Any mutation against a list-shaped config
  upgrades the `agents` section to `entries` in that same write (delete `list`,
  preserve every other field verbatim). No file ever carries both shapes; Bakin
  never authors `agents.list` again.
- **We never author policy fields:** `ownership` and `defaults` are preserved
  verbatim, never invented, never modified (except `defaults` writes that
  model-routing already owns — unchanged semantics).

### D2 — Implicit-Main synthesis: only for genuinely pre-roster configs
- `agents.entries` present (even `{}`) → authoritative. Empty = empty roster. A real
  install always has main, so an empty registry means OpenClaw itself is broken —
  Bakin shows the honest empty roster (Team UI empty, onboarding/health flag it)
  instead of a fake-healthy Main.
- `agents.ownership === 'explicit'` → never synthesize.
- Legacy nonempty `agents.list` → used as-is.
- ONLY a virgin config (no `entries`, no `ownership`, no nonempty `list`) →
  synthesize implicit Main (OpenClaw's own fresh-install semantic; keeps onboarding
  working against a new home).
- `materializeImplicitMainAgent` materializes into **entries**, under the same
  conditions only — never as a side effect of editing an authoritative registry.

### D3 — Shared accessors kill the six inline bypasses
- New trio in `config.ts` — `findAgentIn(config, id)`, `upsertAgentIn(config, id,
  patch)`, `deleteAgentIn(config, id)` — the ONLY code that knows where agents live.
  Collapse the inline `config.agents?.list?.find(...)` sites: `agent-config.ts`
  (identity :89, allowlist :103, remove :112/:122, workspace :196),
  `memory.ts:695`, `model-routing.ts:127` (`setAgentModels`), `config.ts:142`.
- All mutations are read-modify-write of the full config touching only
  `agents.entries[id]` — unrelated fields (`gateway`, `channels`, `skills`, `mcp`,
  `ownership`, `defaults`) round-trip byte-faithfully (modulo JSON re-serialization).
- **Unify workspace SHAPE-LOOKUP, not trust rules** (double-check correction):
  `getWorkspacePath` (agent-config.ts:193) and `memory.ts:workspacePath` (:690)
  duplicate the config lookup but deliberately differ in trust predicates
  (memory: `existsSync` only; agent-config: exists OR non-foreign — each pinned
  by its own docker-rig tests). A shared entries-aware
  `configuredWorkspaceFor(config, agentId)` (per-entry `workspace` →
  `defaults.workspace` for main only) replaces both inline lookups; each caller
  keeps its existing trust predicate and `<home>/workspace(s)` fallback.
  Behavior unchanged except entries-awareness.
- **Fold-in fix (own commit): the corrupt-config wipe.** `upsertOpenClawAgentConfig`
  uses the lenient read (`readOpenClawConfig() ?? {}`) then whole-file writes — a
  corrupt `openclaw.json` is silently replaced, wiping gateway token + channels. It
  switches to `readOpenClawConfigForMutation()` (strict: corrupt ⇒ throw), matching
  every other mutator.
- `model-routing.ts` `applyRoutingPolicy` already spreads `...agents` (preserves
  `entries`/`ownership`) — verify with a test, no change expected. Its header
  mapping comment updates to the entries world.
- Stale header comment in `config.ts` referencing the deleted `runtime.config`
  surface gets corrected while we're in the file.

### D4 — Creation path + adoption regression
- `agents.create` (runtime.ts:298): the duplicate guard (`findAgentById`) now sees
  entries agents, so real duplicates throw typed 'Agent already exists'
  (runtime_failed) instead of double-creating. The CLI (`openclaw agents add`)
  remains the primary writer (it writes the format the installed OpenClaw owns);
  the plugin-allowlist-failure fallback writes **entries** via `upsertAgentIn`.
- The #873 installer contradiction (`--adopt` → "does not exist" while `add` →
  "already exists") was entirely downstream of the lying roster; installer logic is
  untouched. Regression coverage at the ADAPTER level: `findAgentById`/roster see
  entries agents; `create` on an existing entries id throws typed already-exists.

### D5 — Mock/rig/test migration (adapter-adjacent, still the silo)
- `dev/imitation-crab/fixtures/openclaw.json` → faithful 9.5 shape: `entries` keyed
  map + `ownership: "explicit"` + `defaults` (same 5 agents).
- `dev/imitation-crab/seed-enrich.ts` → writes `entries[id]`, not `list.push`.
- `scripts/instance/agent-paths.ts` `normalizeAgentPaths()` → rewrites workspaces
  across `entries ?? list` (rig may host either).
- Test updates: `tests/adapter-openclaw/{config-cache,model-routing,
  runtime-capabilities,runtime-binary,memory-workspace-path}.test.ts`,
  `tests/core/{openclaw-config,main-agent}.test.ts`, `tests/dev/{mock-seed,
  mock-runtime-contract}.test.ts`, `tests/scripts/instance/agent-paths.test.ts`.
  Legacy-shape pins flip to entries; ONE legacy case survives per D1 (list-shaped
  config reads correctly + first mutation upgrades it to entries).
- Runtime-conformance suite: untouched (its not_found + workspace-file assertions
  are shape-independent; the crab fixture change feeds it the new shape for free).

### D6 — No version probe
Shape-sniffing (`entries` present ⇒ 9.5+) is sufficient; `--version` detection would
be machinery with no consumer.

## Tech Stack / Commands / Structure

Existing only. `bun run lint`, `bun run test` (CI: `test:ci`), single file
`bun test <path> --isolate`. All production edits under `packages/adapter-openclaw/
src/{config,agent-config,model-routing,memory,runtime}.ts`; mock/rig/test files per
D5. NO changes to: `packages/core`, `packages/sdk`, `src/core`, `plugins/`, Pi.

## Code Style

Repo conventions. Style anchor — the decoder stays the single shape-aware point:

```ts
export function agentListFrom(config: OpenClawConfig | null): OpenClawAgent[] {
  if (!config) return []
  const agents = config.agents
  if (agents?.entries) {
    return Object.entries(agents.entries).map(([id, entry]) => ({ ...entry, id }))
  }
  if (Array.isArray(agents?.list) && agents.list.length > 0) return agents.list
  if (agents?.ownership === 'explicit') return []
  return [implicitMainAgent(config)]
}
```

## Testing Strategy

bun test, `--isolate`, standard content-dir/OpenClaw-home mocks. New/updated:
- **Decoder** (`config-cache` + `openclaw-config` tests): entries decode (key wins
  over any embedded id), polymorphic model, empty-entries ⇒ [], ownership-explicit
  ⇒ no synthesis, virgin config ⇒ implicit main, legacy list still reads.
- **Write round-trips** (`model-routing` + new agent-config tests): identity/
  allowlist/model edits against an entries config touch only `entries[id]` and
  preserve `ownership`/`defaults`/`gateway`/unknown fields; mutation against a
  list config upgrades to entries (list deleted) in one write; `setAgentModels` on
  non-main entries agent works (the #873 throw); main materialization lands in
  entries.
- **Corrupt-config**: `upsertOpenClawAgentConfig` now REFUSES (throws) instead of
  wiping — regression for the fold-in fix.
- **Workspace**: unified resolver honors per-entry workspace under entries; the
  memory.ts pins move to the unified function.
- **Creation/adoption** (runtime-binary): duplicate create on entries id → typed
  already-exists; allowlist-failure fallback writes entries on disk (the on-disk
  shape assertion flips).
- **Mock**: mock-seed pins entries shape; mock-runtime-contract roster unchanged
  behaviorally.

## Boundaries

- **Always:** every edit inside `packages/adapter-openclaw/`, `dev/imitation-crab/`,
  `scripts/instance/`, or tests; preserve unknown config fields on every write;
  strict-mutation read before any config write; lint + suite before push.
- **Ask first:** any change to the neutral runtime contract or SDK types; any new
  synthesis rule; touching installer/package-sync logic.
- **Never:** write `agents.list`; author `ownership`/policy fields; fabricate agents
  from an authoritative registry; read OpenClaw config outside the adapter; version
  probes.

## Success Criteria

1. Against this machine's real `~/.openclaw/openclaw.json` (10 entries), the
   adapter's `agents.list()` returns all 10 with correct identity/model/workspace.
2. Identity, allowlist, and model edits on an entries config modify only
   `entries[<id>]`, preserving `ownership`, `defaults`, and unrelated sections.
3. A legacy list-shaped config still reads correctly; its first mutation upgrades
   it to entries with no data loss and no dual-shape file.
4. Empty `entries` / `ownership: explicit` yields an honest empty roster — no
   synthesized Main; a virgin config still yields implicit Main.
5. `agents.create` on an existing entries id fails typed ("already exists");
   the config-write fallback produces entries on disk.
6. A corrupt config is never overwritten by any mutator.
7. Crab mock + dev rig operate on the 9.5 shape; full suite + lint green; zero
   diffs outside the silo.

## Open Questions

None blocking. Deferred by decision: positive create/roster conformance checks in
the shared runtime-conformance suite (shape-independent today; adding them touches
all adapters — separate initiative if wanted).
