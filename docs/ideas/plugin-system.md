# Bakin Plugin System — Capabilities & Direction

## Problem Statement

How might we define a plugin contract — manifest + runtime API + distribution — that covers ~95% of plausible plugins for 6–12 months, stays legible to users at install time, and leaves room to tighten trust and support non-OpenClaw agent platforms later?

## Recommended Direction

Plugins are git-installed Node packages with a signed manifest and a typed `PluginContext` API. Contributions are organized into three tiers — **Surfaces** (user-visible UI), **Content** (installable data: workflows, skills, agents, task kinds, etc.), and **Behavior** (plumbing: exec tools, hooks, events, routes, cron, webhooks, migrations). Search is a cross-cutting opt-in with manifest-level controls for privacy (`enabled`), retention, and cross-plugin query permission. Core plugins expose registries for extension points; plugins add entries, never mutate schemas.

Contribution points can be marked `experimental` so new surfaces can land in minor Bakin versions without committing to stability. Plugins declare `bakinVersion` (semver range); incompatible plugins fail to load with a clear update message (WordPress-style).

Trust is Obsidian-style: manifest declares permissions, Bakin shows them at install, runtime honors them socially now and enforceably later. Distribution is git-based (`bakin install <url>`) with an official curated registry (`registry.bakin.dev/index.json`). Unofficial URLs install with a warning.

OpenClaw access goes exclusively through `ctx.agents.*` / `ctx.platform.*`. No plugin imports `openclaw-client` directly. This makes the future `AgentPlatformAdapter` a factoring of `PluginContext` rather than a rearchitecture.

Uninstall: plugins own their own uninstall behavior (optional `onUninstall` hook). Bakin does not attempt to reverse-index or clean up plugin data automatically — intentional to avoid magic-destroys-user-data scenarios. Tracked as a follow-up issue for future refinement.

## Registry Extension Points

Core plugins expose these registries from day one:

- `workflows.stepTypes` — custom workflow step kinds beyond agent/gate/parallel/output/workflow
- `models.providers` — AI model providers beyond the built-in Anthropic catalog
- `workflows.notificationChannels` — beyond hardcoded `discord` / `slack` (email, SMS, webhook, etc.)
- `assets.renderers` — previewers for new file types (3D, Figma, specialized formats)
- `health.checks` — plugin-contributed doctor/health probes

## Pre-requisite Work

**Messaging plugin refactor must land before the plugin system spec ships.** Current state (`plugins/messaging/types.ts:1-4`) hardcodes user-specific agents, channels, and content types as TypeScript string-literal unions:

```ts
export type ContentAgent = 'basil' | 'scout' | 'nemo' | 'zen'
export type ContentChannel = 'discord' | 'instagram' | 'email' | 'twitter' | 'youtube' | 'tiktok'
export type ContentType = 'recipe' | 'tip' | 'motivation' | 'workout' | 'outdoor' | 'video' | 'image-post'
```

Required changes:

- `ContentAgent` — resolve agents dynamically from OpenClaw (via `ctx.agents.*`) instead of type-level enumeration
- `ContentChannel` — source from the `workflows.notificationChannels` registry above
- `ContentType` — user-configurable taxonomy, stored in plugin settings, not a type union

This is a hard gate: until messaging is neutral, the plugin system can't claim "core plugins are reusable reference implementations."

## Key Assumptions to Validate

- [ ] Registry pattern covers all "extend core plugin" needs — verified by audit of workflows, models, assets, workflows.notify, health
- [ ] Three-tier grouping reads clearly in the install-time permissions prompt — mock the UI
- [ ] `bakinVersion` semver + startup check catches version-drift breakage
- [ ] `HookRegistry` is sufficient for plugin↔plugin functional calls — already in use today
- [ ] Static file bundling covers content contributions in v1 (no build-at-install step)
- [ ] Manifest-level search fields (`enabled` / `retention` / `crossPluginQuery`) are the right three
- [ ] Messaging refactor is achievable without breaking current calendar/brainstorm functionality

## MVP Scope

**In:**

- `bakin-plugin.json` schema: id, name, version, description, author, icon, `bakinVersion`, `permissions[]`, `dependencies`, `contributions` (Surfaces / Content / Behavior), `search` (enabled / retention / crossPluginQuery), `experimental` flag per-contribution-point
- Manifest validator at load time; startup refuses incompatible `bakinVersion`
- `PluginContext` unified to expose every contribution point as a typed API namespace
- Registry pattern + APIs for the five extension points above (step types, model providers, notification channels, asset renderers, health checks)
- Messaging plugin refactor (see pre-requisite work)
- All existing core plugins migrated to the new manifest + context contract (dogfood)
- Permission manifest logged at activation time (UI preview comes later)
- Audit: no direct `openclaw-client` imports in plugin code
- `onUninstall` hook (optional per-plugin)

**Out (deferred):**

- Install pipeline (`bakin install <url>`, registry index, update flow) — separate spec
- UI slots between plugins (plugin A injects into plugin B's view)
- Override/replace semantics for core plugin surfaces (additive only)
- Runtime permission enforcement (capability-gated `PluginContext`) — manifest-only for now
- Signing, marketplace curation workflow
- Runtime API versioning beyond `bakinVersion`
- Build-step / templated content at install time
- Sandboxing (workers, isolates)
- Automatic uninstall cleanup (tracked as follow-up issue)

## Not Doing (and Why)

- **Plugin-to-plugin UI slots** — adds a registry + collision model for little user value today
- **Plugin schema override of core plugins** — forks ecosystem; registry pattern solves 95%
- **Theme/language packs** — Bakin is single-user self-hosted; wrong shape
- **Sandbox isolation** — manifest permissions cover it socially; true isolation is a later opt-in
- **Per-plugin Node version constraints** — we ship one Node runtime; plugins adapt
- **Standalone plugin registry server** — curated JSON index in a git repo is enough until phase 3
- **Magic uninstall cleanup** — plugins own their own teardown; no data-loss-by-accident

## Open Questions

- Should `bakinVersion` semver ranges support `"experimental"` as a prefix so plugins that use experimental contribution points auto-fail on stable Bakin releases?
- Should the uninstall follow-up issue include a "safe mode uninstall" that exports plugin data before removing, or stay pure punt? (Lean: pure punt now, revisit.)

## Next Steps

1. Open GitHub issue for messaging plugin refactor (pre-requisite, gates plugin system spec)
2. Open GitHub issue for uninstall cleanup (follow-up, post-MVP)
3. Run `/agent-skills:spec` on the plugin contract itself (manifest schema + `PluginContext` API + registries)
4. Separate spec for install pipeline (git clone, registry index, update flow)
