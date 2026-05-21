# Spec: Permissions And Runtime Capability Hardening

## Objective

Audit and harden the places where Bakin conflates permissions, tool policy, runtime capabilities, and workflow state. The immediate goal is to prevent agents from being dispatched into work that cannot complete, and to make failures actionable when runtime dependencies such as channel delivery or image generation are unavailable.

Success means the two observed blocked tasks are explained by precise system failures, those classes of failures are caught before agent work starts where possible, and workflow/task state stays consistent when a tool failure blocks work.

## Assumptions

- Bakin remains the orchestration authority for tasks, audit, assets, workflows, and plugin permissions.
- OpenClaw remains the runtime authority for agent turns, model auth, native tools, channel drivers, and cron.
- Agent package MCP allowlists are not the root cause of the current failures; current installed package manifests do not declare restrictive `allowedTools`.
- Runtime channel names like `#general` should not be treated as the same thing as adapter-native delivery targets unless Bakin has an explicit mapping.
- Existing installs may have a legacy `notifications.channel` + `notifications.target` pair; that pair can supply the default `general` alias for compatibility, but explicit `notifications.channelAliases.general` remains canonical.
- The open channel-alias design question was answered "yes" during kickoff.

## Audit Summary

### Open Tickets

- #266: Runtime messaging lacks hard per-turn tool scoping for `ctx.runtime.messaging.send/stream`. Directly related.
- #296: LLM onboarding checks only accept non-empty `apiKey`, so Codex/OAuth token auth is incorrectly reported as missing. Directly related.
- #203: Workflow cleanup tracks strict step ownership and workflow capability gaps. Adjacent and relevant.
- #267: Plugin builder prerequisite failures should fail before mutating state. Adjacent pattern for capability preflight.
- #98: Per-gate Discord formatting is channel-adjacent, but not the cause of these failures.

### Failure 1: `55fb21a2` Channel Post

Task: `Share an inspirational quote`

Observed failure:

```text
Runtime channel delivery failed: OpenClaw invokeTool failed (404): Tool not available: message_send
```

Root causes:

- `bakin_exec_post_channel` accepts a human channel string and normalizes `#general` to `general`.
- The OpenClaw adapter treats the first channel segment as the runtime channel driver id, so `general` becomes a runtime channel id, not a Discord target.
- The installed runtime config has a Discord channel driver, but Bakin has no explicit `general -> discord:<target>` mapping.
- OpenClaw adapter delivery first calls `/tools/invoke` with `message_send`; that tool is unavailable in the current runtime.
- The adapter only falls back to `openclaw message send` when a target exists. `general` had no target, so the fallback path could not run.
- Doctor/onboarding only validated that channel credentials exist; they did not validate that channel delivery is actually possible.

This was not caused by MCP tool restrictions. The Bakin MCP tool existed and the agent was allowed to call it.

### Failure 2: `messaging-7c20c5e7` Image Step

Task: `Prep: Hot Dog Night, But Better - instagram`

Observed failure:

```text
No Gemini API key found. Set GEMINI_API_KEY env var or configure the runtime skill entry
```

Root causes:

- `bakin_exec_gen_image` only checks `GEMINI_API_KEY`, `GOOGLE_AI_API_KEY`, and `skills.entries.nano-banana-pro`.
- The runtime config uses the newer model provider path for Google image generation, so Bakin looked in the wrong place.
- The workflow step remained `in_progress` after the task was blocked because explicit `blockTaskWithEffects` bypasses the task-store move hook that cancels workflows.
- Watchdog therefore continued to emit timeout logs for a workflow whose visible task card was already blocked.

This was also not caused by MCP tool restrictions.

## Permission And Capability Layers

1. Plugin runtime permissions: `ctx.runtime.*` access is governed by plugin manifests and `src/lib/plugin-permissions.ts`. Current mode is warning-oriented for missing permissions.
2. Agent package MCP policy: per-agent `allowedTools` in package manifests is enforced by `src/core/mcp-tool-policy.ts` and `src/core/mcp-server.ts`. Missing or empty `allowedTools` means unrestricted.
3. Workflow tool authorization: `assertWorkflowToolAllowed` and `workflows.authorizeToolUse` gate current workflow ownership, task completion, and channel posts.
4. Runtime provider capability: OpenClaw may or may not expose provider tools such as `message_send`, channel targets, model auth, or image model credentials.
5. Prompt-only tool guidance: workflow `deny_tools` and dispatch text are not hard enforcement unless translated into runtime or MCP policy.

The failures happened in layers 4 and workflow state coordination, not layer 2.

## Tech Stack

- TypeScript on Bun.
- Runtime adapter contracts in `packages/core/src/adapters/runtime`.
- Public SDK types in `packages/sdk/src/types`.
- OpenClaw adapter in `packages/adapter-openclaw`.
- Core task/workflow orchestration in `src/core`, `plugins/tasks`, and `plugins/workflows`.
- Exec tools in `scripts/lib`.
- Tests use `bun test`.

## Commands

Focused verification commands:

```bash
bun test tests/core/onboarding/credentials.test.ts
bun test tests/scripts/generate-image.test.ts
bun test tests/adapter-openclaw/runtime-channels.test.ts
bun test tests/adapter-openclaw/runtime-stream.test.ts
bun test tests/core/task-service.test.ts tests/plugins/workflows/runtime.test.ts
bun test tests/lib/plugin-permissions.test.ts tests/core/mcp-tool-policy.test.ts
```

Broader verification before final handoff:

```bash
bun test tests/core/onboarding/credentials.test.ts tests/scripts/generate-image.test.ts tests/adapter-openclaw/runtime-channels.test.ts tests/adapter-openclaw/runtime-stream.test.ts tests/core/task-service.test.ts tests/plugins/workflows/runtime.test.ts tests/plugins/health/system-checks.test.ts
```

## Project Structure

- `src/core/onboarding/credentials.ts`: LLM and channel credential readiness.
- `scripts/lib/post-channel.ts`: Bakin channel post exec tool.
- `scripts/lib/generate-image.ts`: image generation key/model resolution and asset save.
- `src/core/task-service.ts` and `src/core/task-store.ts`: task state transitions and workflow cancellation hooks.
- `plugins/workflows/lib/runtime.ts`: workflow instance state and tool authorization.
- `packages/core/src/adapters/runtime/concepts.ts`: adapter-neutral runtime contract.
- `packages/sdk/src/types/index.ts`: plugin-facing SDK contract.
- `packages/adapter-openclaw/src/runtime.ts`: OpenClaw runtime implementation.
- `plugins/health/lib/system-checks`: doctor-visible readiness checks.
- `.claude/knowledge`: documentation updates for architecture and operational rules.

## Code Style

Prefer small, named normalization helpers over inline shape checks:

```ts
function hasUsableAuthSecret(entry: unknown): entry is Record<string, unknown> {
  if (!entry || typeof entry !== 'object') return false
  return AUTH_SECRET_FIELDS.some((field) => {
    const value = (entry as Record<string, unknown>)[field]
    return typeof value === 'string' && value.trim().length > 0
  })
}
```

No secret values should be logged, returned in doctor details, or written to audit.

## Testing Strategy

- Add regression tests before each behavior change.
- Test narrow modules first: credential normalization, image key lookup, channel reference resolution, workflow block coordination.
- Add adapter contract tests for runtime messaging tool policy.
- Keep live channel delivery tests mocked; do not send real Discord messages in automated tests.
- Use existing mock OpenClaw gateway tests for request payload assertions.

## Implementation Plan

### Phase 1: Fix Incorrect Readiness Checks

Task 1: Broaden LLM auth detection.

- Acceptance: Codex/OAuth/token auth profiles count as configured; warning copy no longer implies only `apiKey` is valid.
- Verify: `bun test tests/core/onboarding/credentials.test.ts`.
- Likely files: `src/core/onboarding/credentials.ts`, `tests/core/onboarding/credentials.test.ts`.

Task 2: Make image generation read the active runtime provider config.

- Acceptance: Google provider config under runtime model/provider settings satisfies `bakin_exec_gen_image`; old env and skill-entry paths still work; no secret is exposed in errors.
- Verify: `bun test tests/scripts/generate-image.test.ts`.
- Likely files: `scripts/lib/generate-image.ts`, `tests/scripts/generate-image.test.ts`.

Checkpoint A:

- Commit: `fix readiness checks for auth and image generation`.
- Verification: focused tests above.

### Phase 2: Make Channel Delivery Explicit

Task 3: Introduce deterministic channel reference resolution.

- Acceptance: fully qualified refs pass through; bare names such as `#general` resolve only when Bakin has an explicit alias/default target; unresolved names fail before runtime invocation with a clear remediation.
- Verify: `bun test tests/scripts/post-channel.test.ts tests/adapter-openclaw/runtime-channels.test.ts`.
- Likely files: `scripts/lib/post-channel.ts`, `packages/adapter-openclaw/src/runtime.ts`, relevant tests.

Task 4: Surface channel delivery capability in health.

- Acceptance: doctor reports when configured channel credentials exist but Bakin cannot prove channel delivery is routable; adapter health checks are included or mirrored in plugin health output.
- Verify: `bun test tests/plugins/health/system-checks.test.ts tests/adapter-openclaw/runtime-channels.test.ts`.
- Likely files: `plugins/health/index.ts`, `plugins/health/lib/system-checks/*`, `packages/adapter-openclaw/src/runtime.ts`.

Checkpoint B:

- Commit: `harden runtime channel delivery preflight`.
- Verification: focused channel and health tests.

### Phase 3: Keep Workflow And Task State Consistent

Task 5: Cancel or block workflow instances when task blocking is explicit.

- Acceptance: `bakin_exec_tasks_block` on a workflow-backed task stops the active workflow instance from staying `in_progress`; watchdog no longer times out already-blocked work.
- Verify: `bun test tests/core/task-service.test.ts tests/plugins/workflows/runtime.test.ts tests/core/watchdog.test.ts`.
- Likely files: `src/core/task-service.ts`, `plugins/workflows/lib/runtime.ts`, tests.

Task 6: Tighten workflow dispatch tool exposure.

- Acceptance: workflow dispatch text only advertises tools relevant to the current step; prompt-only `deny_tools` remains documentation unless backed by hard policy.
- Verify: `bun test tests/core/dispatch.test.ts tests/core/dispatch-assets.test.ts`.
- Likely files: `src/core/dispatch.ts`, tests.

Checkpoint C:

- Commit: `keep blocked workflows out of active dispatch`.
- Verification: workflow/task/watchdog tests.

### Phase 4: Add Hard Runtime Messaging Tool Policy

Task 7: Add adapter-neutral per-turn tool policy to runtime messaging.

- Acceptance: SDK and core adapter types expose `toolsMode`, `toolsAllow`, and `toolsDeny` on `send` and `stream`.
- Verify: `bun test tests/dev/mock-runtime-contract.test.ts tests/adapter-openclaw/runtime-stream.test.ts`.
- Likely files: `packages/core/src/adapters/runtime/concepts.ts`, `packages/sdk/src/types/index.ts`, mock runtime, OpenClaw adapter.

Task 8: Apply policy in OpenClaw agent turns.

- Acceptance: `toolsMode: "none"` and allow/deny lists are forwarded to OpenClaw agent requests; tests prove the request payload contains the policy.
- Verify: `bun test tests/adapter-openclaw/runtime-stream.test.ts tests/dev/mock-runtime-contract.test.ts`.
- Likely files: `packages/adapter-openclaw/src/runtime.ts`, dev mock gateway tests.

Checkpoint D:

- Commit: `add runtime messaging tool policy`.
- Verification: runtime contract and adapter tests.

### Phase 5: Documentation And Review

Task 9: Update docs.

- Acceptance: `.claude/knowledge` explains the five permission/capability layers, channel aliasing, workflow blocking behavior, and cron `toolsAllow` vs interactive messaging tool policy.
- Verify: docs reviewed, no stale statements in existing relevant knowledge files.
- Likely files: `.claude/knowledge/adapter-architecture.md`, `.claude/knowledge/workflows-plugin.md`, maybe a new `.claude/knowledge/permissions-and-capabilities.md`.

Task 10: Quality pass.

- Acceptance: code review focuses on secret leakage, permission-layer confusion, and behavior regressions.
- Verify: focused suite plus any broader `bun test` subset warranted by changed files.

Checkpoint E:

- Commit: `document permission and capability boundaries`.
- Verification: all focused tests passing.

## Boundaries

- Always: preserve task/workflow audit trails, avoid logging secrets, add regression tests for every failure class.
- Always: prefer explicit capability checks and actionable errors over hidden best-effort behavior.
- Ask first: adding new persistent user-facing settings for channel aliases, changing workflow instance status vocabulary, or changing OpenClaw runtime config shape.
- Never: send real channel messages from tests, bypass Bakin audit with direct runtime commands in agent-facing flows, or weaken workflow step ownership.

## Success Criteria

- `#general` failures become either successful routed deliveries or preflight errors that say exactly what channel alias/target is missing.
- `bakin_exec_gen_image` recognizes the active Google image provider config.
- Codex/OAuth token auth no longer triggers the false `apiKey` onboarding warning.
- Blocking a workflow task removes the workflow from active `in_progress` watchdog scans.
- Runtime messaging supports hard per-turn tool policy for plugin calls.
- Doctor/health distinguishes credential presence from operational delivery capability.
- Documentation clearly distinguishes plugin permissions, MCP tool policy, workflow authorization, runtime provider capabilities, and prompt-only tool guidance.

## Open Design Question

Should Bakin introduce explicit named channel aliases as the canonical way for agents and workflows to say `#general`, `#alerts`, etc., with each alias resolving to a runtime-native target such as `discord:<target>`?

Recommended answer: yes. Agents and workflow YAML should use stable human names; adapter-native ids and targets should live in Bakin/OpenClaw configuration. If an alias is missing, Bakin should fail before dispatching or posting with a remediation message, not try to infer a target from a secret-bearing runtime config or silently bypass through direct runtime commands.

Decision: yes. Explicit aliases are canonical. A legacy `notifications.channel`
and `notifications.target` pair is accepted only as the default `general` alias so
older local settings continue to work until the operator saves explicit
`notifications.channelAliases`.
