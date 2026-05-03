# Platform Integrity Audit

Issue: #221
Date started: 2026-04-30
Status: Phase 0 kickoff artifact

## Purpose

Audit Bakin's substrate layers before starting another large product-specific
plugin refactor. The output should be a prioritized map of meaningful platform
gaps, plus small implementation slices that can close them without creating one
large mixed branch.

## Scope

The audit covers:

- runtime adapter contract and OpenClaw adapter boundary
- search adapter contract and Antfly degraded-mode behavior
- plugin extraction, install, upgrade, remove, permissions, and drift lifecycle
- agent package install, update, remove, projection, context, and package policy
- MCP exec-tool listing/invocation policy
- git isolation for concurrent agent work
- imitation-crab as a possible dev/test runtime adapter
- CLI and onboarding output/selection experience

Product-specific redesigns stay out of this audit unless they reveal a platform
boundary that must be resolved first.

## Campaign Rules

- Keep follow-up PRs small and independently reviewable.
- Prefer fail-loud behavior for platform invariants. Silent permissive fallback
  is acceptable only when the system deliberately identifies an unmanaged legacy
  object and documents that state.
- Treat prompts as UX guidance, not enforcement. If the system says something
  is restricted, the restriction must exist in code at the relevant boundary.
- Do not change REST/API shapes casually while the OpenAPI conversion branch is
  active. Correctness and safety gaps can still justify route changes.

## Classification

Each finding should land in one bucket:

- **must-fix now**: correctness, safety, enforcement, or architecture gap that
  can compromise future platform work.
- **should-fix before next product push**: meaningful leverage or operability
  gap, but not immediately unsafe.
- **later / product-dependent**: useful but depends on Messaging, Workflow,
  Memory, or distribution product direction.
- **non-issue / already covered**: covered by current code, tests, or docs.

## Initial Evidence

### Existing Guardrails

- `tests/architecture/adapter-boundary.test.ts` scans `src`, `plugins`,
  `packages/core/src`, `packages/host/src`, `cli`, `scripts`, and `server.ts`
  for direct provider imports, raw OpenClaw paths, raw Antfly SDK usage,
  raw runtime config access outside `src/core/runtime-config-raw.ts`, raw
  SQLite access outside adapters, and hard-coded runtime agent ids in shipped
  workflow defaults.
- `.claude/knowledge/adapter-architecture.md` documents runtime/search/task
  ownership and boundary verification commands.
- `src/lib/plugin-registry.ts` enforces declared API routes and declared exec
  tools for user plugins before registration.
- `scripts/lib/registry.ts` centralizes exec-tool registration and plugin tool
  context creation.

### Confirmed Gap: MCP Tool Policy Is Not Enforced

Current code in `src/core/mcp-server.ts` registers every tool returned by
`getAllExecTools()` for every MCP session. The registered handler resolves
`agent = getAgent()` for attribution, but there is no allowlist/policy check
before listing or invoking a tool.

Implications:

- #218 is a real substrate enforcement gap, not just a design enhancement.
- Package manifest `agent.allowedTools` is currently documentation-only as
  stated in `.claude/knowledge/agent-packages.md`.
- Workflow `deny_tools`, runtime cron `toolsAllow`, and Bakin MCP hard scoping
  remain separate mechanisms and need a single policy explanation.

Preliminary classification: **must-fix now**.

### Confirmed Gap: Dispatch Points Agents At Missing Assets Tool

Current code in `src/core/dispatch.ts` instructs agents with attached assets to
call `bakin_exec_assets_open` for sidecar-plus-content reads. The assets plugin
registers `bakin_exec_assets_get`, `save`, `delete`, `link`, `retype`,
`update_content`, trash tools, and audit tools, but does not register
`bakin_exec_assets_open`.

Implications:

- Agents following dispatch instructions will hit a "tool not found" path.
- The existing `tests/core/dispatch-assets.test.ts` pins the prompt text, so the
  current tests preserve the broken contract instead of catching it.
- `.claude/knowledge/assets-plugin.md` already documents the intended fix.
- Follow-up issue opened as #222.

Preliminary classification: **must-fix now**. This is a concrete dispatch
correctness issue, separate from #218.

## Track Findings

### A. Runtime Adapter

Status: focused verification passed.

Findings:

- **non-issue / already covered:** Runtime adapter boundary checks exist and the
  focused OpenClaw cron/channel tests pass.
- **no new immediate gap found in the focused pass.** Phase 1 should still review
  failure behavior method-by-method before declaring the runtime track closed.

Evidence to inspect:

- `packages/core/src/adapters/runtime/*`
- `packages/adapter-openclaw/src/*`
- `src/core/runtime-adapter-factory.ts`
- `tests/adapter-openclaw/*`
- architecture boundary checks

### B. Search Adapter

Status: focused verification passed.

Findings:

- **non-issue / already covered:** Search adapter and registry/reconcile/cleanup
  tests pass across Antfly and Bakin core search surfaces.
- **no new immediate gap found in the focused pass.** Third-party plugin search
  contract polish should wait until OpenAPI/docs work catches up.

Evidence to inspect:

- `packages/core/src/adapters/search/*`
- `packages/adapter-antfly/src/search.ts`
- `src/core/search-registry.ts`
- `src/core/search-reconcile.ts`
- `src/core/search-cleanup.ts`
- `tests/adapter-antfly/search.test.ts`
- `tests/core/search-*.test.ts`
- `tests/integration/search-watcher-sync.test.ts`

### C. Plugin Lifecycle

Status: focused verification passed.

Findings:

- **non-issue / already covered:** install, source-swap, subpath, upgrade,
  remove, registry teardown, and plugin install API tests pass.
- **later / product-dependent:** #164 signature verification, #165 uninstalled
  restore/retention, and #178 SDK publish matter for distribution polish, but
  they do not block the higher-risk MCP/context work.
- **should-fix before broader third-party plugin push:** plugin docs should
  eventually describe how plugin exec tools participate in agent policy once
  #218 lands.

Evidence to inspect:

- `.claude/knowledge/plugin-system.md`
- `src/core/plugins/*`
- `packages/core/src/plugins/*`
- `src/lib/plugin-registry.ts`
- `tests/plugins/lifecycle/*`
- plugin install/link/build API tests

### D. Agent Packages and Workshop

Status: focused verification passed.

Findings:

- **must-fix now:** package `allowedTools` / `allowedSkills` remain
  documentation-only until #218 provides MCP enforcement.
- **should-fix before next product push:** #208 and #157 are one context system
  problem from two directions: compact the static managed context, then retrieve
  package knowledge at dispatch time.
- **should-fix after policy/context semantics are stable:** #163 Workshop UI
  should expose package lifecycle, drift, `.userEdited`, and policy state after
  the underlying semantics are real.
- **documentation drift:** `.claude/knowledge/agent-packages.md` still references
  closed #42 for per-agent scoping. #218 is now the active contract.

Evidence to inspect:

- `.claude/knowledge/agent-packages.md`
- `packages/core/src/agent-packages/*`
- `src/core/agent-packages/*`
- `packages/host/src/api/agent-packages/*`
- `tests/agent-packages/*`
- #157, #163, #208, #218

### E. MCP and Agent Safety

Status: focused verification passed; implementation gaps confirmed.

Findings:

- **must-fix now:** MCP sessions expose and invoke all registered tools for every
  agent. There is no routing-layer allowlist. See #218.
- **must-fix now:** dispatch tells agents with attached assets to call
  `bakin_exec_assets_open`, but no registered exec tool has that name.
- **must-fix now or fold into #218:** workflow `deny_tools` is currently prompt
  guidance only. The dispatch prompt says violations are rejected server-side,
  but the MCP boundary has no policy check that can enforce it.
- **should-fix in same policy docs pass:** runtime cron `toolsAllow`, workflow
  `deny_tools`, package `allowedTools`, and Bakin MCP scoping need a single
  explanation so future work does not conflate separate mechanisms.

Evidence to inspect:

- `src/core/mcp-server.ts`
- `scripts/lib/registry.ts`
- `tests/core/mcp-server*.test.ts`
- `tests/integration/usage-wiring-mcp.test.ts`
- package manifest `allowedTools` handling

### F. Git Isolation

Status: scoped by issue; not implemented.

Findings:

- **should-fix before large concurrent agent work:** #36 remains the right
  umbrella for isolating branches/worktrees when multiple agents operate at
  once. It is not a blocker for #218/#208/#157, but it becomes important before
  parallel implementation campaigns.

Evidence to inspect:

- #36
- git workflow docs/skills
- task dispatch and branch/PR CLI behavior

### G. Imitation Crab / Dev Runtime

Status: focused verification passed; contract-harness slices in progress.

Findings:

- **should-fix before CLI/onboarding demos rely on it:** current dev mock
  gateway/seed/safety tests pass, but imitation-crab is still fixture-oriented.
  The audit should decide whether it becomes a first-class runtime/search test
  adapter or remains a deterministic dev harness.
- **recommended direction:** build an adapter-like facade for dev/runtime tests
  only after #218 establishes the policy boundary it must simulate.
- **first slice:** make the mock environment deterministic and testable before
  adapterizing it. The seed path now honors a configured mock home, force re-seed
  removes stale fixture state, the gateway port is configurable, and chat mode
  validation fails loud.
- **second slice:** add an Imitation Crab AppServices harness backed by the
  OpenClaw runtime adapter plus mock search, normalize the seeded main workspace
  into the mock home, and fix the OpenClaw config cache so swapping
  `OPENCLAW_HOME` cannot reuse a same-mtime config from another path.
- **third slice:** add a runtime contract suite against that harness covering
  roster, workspace files, skills, messaging, streaming, tool invocation,
  channels, cron create/update/run/remove, and task execution status.
- **fourth slice:** add mock gateway failure controls and a runtime failure
  contract suite proving chat, stream, tool, and channel-send gateway errors
  reject loudly through the OpenClaw adapter when no CLI target fallback applies.
- **fifth slice:** add onboarding contracts against Imitation Crab and fix the
  runtime integrity check so OpenClaw `agents.defaults.workspace` is treated as
  the main workspace default, not as an inherited subagent workspace collision.

Evidence to inspect:

- `dev/imitation-crab/*`
- `tests/dev/*`
- adapter testing helpers
- onboarding runtime/search checks

### H. CLI and Onboarding

Status: focused verification passed.

Findings:

- **non-issue / already covered at correctness level:** focused CLI and
  onboarding tests pass.
- **should-fix after substrate semantics settle:** the CLI still needs a product
  UX audit for onboarding, selection, command output, and repair flows. That is
  lower dependency order than MCP policy and package context.

Evidence to inspect:

- `cli/bakin.ts`
- `src/core/onboarding/*`
- `src/core/doctor.ts`
- `tests/cli/*`
- `tests/core/onboarding/*`

## Verification Log

- `bun test tests/architecture/adapter-boundary.test.ts --isolate` - pass
  (3 tests).
- `bun test tests/core/mcp-server.test.ts tests/core/mcp-server-registration.test.ts tests/integration/usage-wiring-mcp.test.ts --isolate`
  - pass (10 tests).
- `bun test tests/adapter-openclaw/runtime-cron.test.ts tests/adapter-openclaw/runtime-channels.test.ts --isolate`
  - pass (15 tests).
- `bun test tests/adapter-antfly/search.test.ts tests/core/search-registry.test.ts tests/core/search-reconcile.test.ts tests/core/search-cleanup.test.ts tests/core/search-auto-registration.test.ts --isolate`
  - pass (102 tests).
- `bun test tests/agent-packages/manifest.test.ts tests/agent-packages/installer.test.ts tests/agent-packages/updater.test.ts tests/agent-packages/uninstaller.test.ts tests/agent-packages/projector.test.ts tests/agent-packages/managed-blocks.test.ts tests/agent-packages/standalone-packs.test.ts tests/agent-packages/load-sources.test.ts --isolate`
  - pass (130 tests).
- `bun test tests/plugins/lifecycle/install-dependencies.test.ts tests/plugins/lifecycle/install-source-swap.test.ts tests/plugins/lifecycle/install-subpath.test.ts tests/plugins/lifecycle/upgrade-flow.integration.test.ts tests/plugins/lifecycle/remove-smoke.test.ts tests/plugins/lifecycle/registry-teardown-smoke.test.ts tests/api/plugins-install.test.ts tests/api/user-plugin-lifecycle.test.ts --isolate`
  - pass (52 tests).
- `bun test tests/dev/mock-env.test.ts tests/dev/mock-seed.test.ts tests/dev/mock-gateway.test.ts tests/dev/mock-gateway-streaming.test.ts tests/dev/mock-safety.test.ts --isolate`
  - pass (24 tests).
- `bun test tests/dev/mock-harness.test.ts tests/adapter-openclaw/config-cache.test.ts tests/dev/mock-env.test.ts tests/dev/mock-seed.test.ts tests/dev/mock-gateway.test.ts tests/dev/mock-gateway-streaming.test.ts tests/dev/mock-safety.test.ts --isolate`
  - pass (27 tests).
- `bun test tests/dev/mock-runtime-failure-contract.test.ts tests/dev/mock-runtime-contract.test.ts tests/dev/mock-harness.test.ts --isolate`
  - pass (6 tests).
- `bun test tests/dev/mock-onboarding-contract.test.ts tests/core/onboarding/runtime.test.ts --isolate`
  - pass (14 tests).
- `bunx eslint dev/imitation-crab/cli-shim-install.ts dev/imitation-crab/env.ts dev/imitation-crab/gateway.ts dev/imitation-crab/harness.ts dev/imitation-crab/index.ts dev/imitation-crab/safety.ts dev/imitation-crab/seed.ts packages/adapter-openclaw/src/config.ts tests/adapter-openclaw/config-cache.test.ts tests/dev/mock-env.test.ts tests/dev/mock-gateway-streaming.test.ts tests/dev/mock-harness.test.ts tests/dev/mock-runtime-contract.test.ts tests/dev/mock-runtime-failure-contract.test.ts tests/dev/mock-seed.test.ts`
  - pass.
- `bun test tests/cli/bakin.test.ts tests/cli/plugin-install-args.test.ts tests/cli/agents-packages.test.ts tests/cli/install-plugin-assets.test.ts tests/cli/install-agent-assets.test.ts tests/core/onboarding/index.test.ts tests/core/onboarding/runtime.test.ts tests/core/onboarding/plugin-assets.test.ts tests/core/onboarding/models.test.ts --isolate`
  - pass (96 tests).
- `bun run typecheck` - pass.
- `bun run lint` - current repo-wide lint fails on existing unused-var/routing
  baseline outside the Imitation Crab change; changed-file eslint command above
  passes.
- `git diff --check` - pass.

## Candidate Execution Order

Initial order, subject to audit findings:

1. #218 MCP hard scoping.
2. #222 register or remove the `bakin_exec_assets_open` dispatch contract.
3. #208 managed context compaction.
4. #157 dispatch-time package knowledge retrieval.
5. #36 git isolation.
6. imitation-crab adapterization / dev-runtime hardening.
7. CLI/onboarding UX cleanup after the platform semantics are firm.
8. #163 Workshop UI once package lifecycle semantics and policy are stable.

## Commit Strategy

- Audit artifact PR: commit only this plan and any minimal docs references
  needed to make the audit discoverable.
- Policy PR: implement #218 in one slice with tests for list filtering,
  invocation denial, audit logging, package `allowedTools`, and legacy fallback.
- Assets dispatch PR: close #222 by either adding `bakin_exec_assets_open` or
  changing dispatch to reference registered tools. Keep this separate unless the
  #218 implementation naturally touches the same tests.
- Context PRs: land #208 before #157 so dispatch-time retrieval has less static
  context to compete with.
- UX PRs: defer Workshop and CLI polish until the policy/context contracts are
  stable enough to expose.

## Open Questions

- Should Bakin-managed agents fail closed when package `allowedTools` is empty or
  missing, while unmanaged/adopted agents remain permissive until configured?
  Recommendation: yes. It gives package authors a real security contract without
  breaking legacy local agents unexpectedly.
- Should imitation-crab become a first-class runtime adapter or remain a dev
  fixture bundle? Recommendation pending code audit.
