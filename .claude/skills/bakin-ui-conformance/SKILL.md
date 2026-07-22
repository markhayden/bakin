---
name: bakin-ui-conformance
description: Enforce Bakin's Storybook-first browser design system for Codex and Claude Code. Use for every change that creates, modifies, reviews, or documents browser UI, including host pages, core or official Bits plugins, SDK UI, CSS, visual behavior, routing presentation, stories, and UI tests.
---

# Bakin UI conformance

Keep browser UI aligned with the public SDK and make every deliberate departure visible to the user. Storybook is the executable contract; CI validates facts; this skill supplies the design judgment static analysis cannot infer.

Read [references/conformance-contract.md](references/conformance-contract.md) before planning or editing affected UI.

## Required workflow

1. Identify every affected browser surface, including loading, empty, error, busy, disabled, narrow, and long-content states. Treat core and official Bits as one first-party fleet.
2. Inspect the closest public Storybook pattern before proposing markup or styling. Search `storybook/public/` by interaction, archetype, component, and state—not only by the requested feature name.
3. State the selected story path and export in the working notes. Compose supported focused entrypoints: `@makinbakin/sdk/ui`, `/layout`, `/patterns`, `/charts`, `/conversation`, `/content`, and `/navigation`. Do not add a new consumer of the frozen `/components` barrel.
4. Preserve the recent routing contract. Use `/navigation` for browser links, router hooks, URL state, history, and dirty-exit behavior; keep server declarations in `/routing`. Do not create visual-only routing abstractions.
5. Implement the smallest coherent change. Update the public story, interaction coverage, visual/browser evidence, public guidance, and API inventory whenever the supported contract changes.
6. Run `bun run ui:conformance --quick` while iterating. Run `bun run ui:conformance --full` before a migration checkpoint or merge-ready handoff. Never regenerate a visual baseline, public API freeze, legacy allowance, token artifact, or performance ceiling merely to make a failure pass.
7. Report the story used, focused SDK entrypoints used, checks run, and whether the change has any deviation.

## Handle a missing pattern

First decide whether the need is reusable.

- If reusable, propose a system extension. Define or revise the public Storybook contract before consuming it in product code. A new public entrypoint, token, archetype, visual baseline, accessibility suppression, or performance-budget increase requires explicit user approval.
- If domain-specific, prefer documented composition and constrained escape hatches. Keep domain CSS scoped to plugin-owned content and continue using system layout, controls, states, typography, and feedback.
- If a required capability exists only in `@makinbakin/sdk/components`, report it as a public-API checkpoint gap. Do not create a new legacy-barrel consumer or silently publish a replacement.

## Explain every deviation before implementation

When the defined system cannot be used, pause before the material deviation and give the user one concrete, human-readable explanation containing:

1. the closest public Storybook pattern, with story path and export;
2. the exact mismatch between that contract and the domain requirement;
3. why composition and documented escape hatches are insufficient;
4. the proposed alternative and its narrow scope;
5. whether the gap should become a reusable system pattern or remain a temporary exception;
6. how the alternative protects accessibility, responsiveness, routing, and plugin isolation; and
7. the review/removal condition.

Do not accept “custom,” “easier,” “looks better,” or “existing code” as rationale. Do not infer approval from silence or from approval of the surrounding feature.

After explicit user approval, add a path-scoped record to `design-system/exceptions.json`. The record must reference the closest story, capture the approved explanation and safeguards, and include a dated review. If approval is declined, return to supported composition. If the user approves a reusable extension, update Storybook and the public contract instead of recording a permanent exception.

## Review existing work

Treat undocumented divergence as a finding even when the code predates the design system. Separate findings into:

- fix now with an existing pattern;
- public-system gap requiring approval before expansion;
- temporary exception requiring explicit approval; or
- migration debt already pinned by `design-system/migrations.json`.

Do not convert known migration debt into a new exception just to preserve it. Do not start unrelated surface migration during a foundation or API review.

## Handoff format

Use this compact evidence block in the final handoff:

```text
UI conformance
- Pattern: storybook/public/<path>.stories.tsx — <Export>
- Contract: @makinbakin/sdk/<focused-entrypoint>
- Story/style-guide update: <what changed or “not needed”>
- Deviation: none | <approved exception id> | approval required
- Verification: <quick/full commands and focused checks>
```
