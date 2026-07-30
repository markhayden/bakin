# Bakin UI conformance contract

## Authority order

Use the first applicable source; never resolve a conflict by inventing another contract.

1. `storybook/public/` — executable public component, pattern, state, and composition behavior.
2. `design-system/public-api.json` — reviewed focused entrypoints, ownership, and frozen migration-only surface.
3. `packages/ui/tokens/*.tokens.json` and generated `--bakin-*` artifacts — visual values and semantic roles.
4. `.claude/knowledge/style-guide.md` and `docs/src/content/docs/extending/ui/overview.md` — composition and author guidance.
5. `.claude/knowledge/url-state-deep-linking.md` and `.claude/specs/routing-overhaul.md` — authoritative routing behavior.
6. `design-system/{census,migrations,performance,exceptions}.json` — official fleet scope and no-regression evidence.

If guidance conflicts with Storybook, the public API inventory, or the routing contract, stop and fix or report the drift. Do not follow stale prose.

## Pattern lookup

Search public stories before source implementations:

```sh
rg -n "title:|bakinCoverage|<interaction-or-domain-term>" storybook/public
rg -n '"<ComponentName>"' design-system/public-api.json
```

Use the most specific applicable layer:

| UI need | Storybook area | Focused entrypoint |
| --- | --- | --- |
| actions, controls, overlays, cards, state feedback | `Foundation/`, `Forms/`, `States/` | `@makinbakin/sdk/ui` |
| page rhythm, flow, grid, sections, bounded overflow | `Layout/` | `@makinbakin/sdk/layout` |
| page archetypes, filters, status, settings, pickers, destructive flows | `Patterns/`, `Forms/`, `Choices/`, `Search/`, `Agents/` | `@makinbakin/sdk/patterns` |
| exact data plus visual summaries | `Charts/` | `@makinbakin/sdk/charts` |
| messages, turns, composer, streaming, tool detail | `Conversation/` | `@makinbakin/sdk/conversation` |
| rendered or editable rich text | `Content/` | `@makinbakin/sdk/content` |
| runtime links, URL state, history, dirty-exit behavior | `Patterns/Destructive and dirty state` | `@makinbakin/sdk/navigation` |

Archetypes own page composition. Primitives do not grant permission to rebuild an archetype locally.

## Change obligations

| Change | Required evidence |
| --- | --- |
| Existing pattern composition | reference the closest story; focused behavior test; quick conformance |
| Supported component behavior or props | public story and interaction/state coverage; API inventory review; docs; full conformance |
| Semantic token | DTCG source and deterministic generated artifacts; specimens/docs; explicit approval if new public token |
| Routing presentation | routing contract tests plus relevant story/browser behavior; no parallel router helper |
| Domain CSS | exact unmet domain need, ownership-root scope, narrow/responsive/keyboard verification |
| Visual baseline change | before/after evidence and exact explicit approval before update |
| Accessibility suppression | reason, evidence, manual verification, and exact explicit approval |
| Performance ceiling increase | measured delta, attribution, alternatives, and exact explicit approval |
| Deliberate design-system deviation | explanation to the user before implementation, explicit approval, then `design-system/exceptions.json` |
| New public story entry | `CanonicalUsage` first story (minimal, `@makinbakin/sdk/*` imports only; `Recipes/` exempt), a play assertion, `bakinCoverage` axes, docs description, visual baseline — `ui:story-compliance:check` enforces; scaffolding comes from `storybook/support/`, never inside `CanonicalUsage` |
| New public kit component export | public story demonstrating it + public-api registration — `ui:kit-coverage:check` enforces; adding to the kit is a reviewed act (D9) |

## Deviation explanation template

```text
UI deviation approval required
- Closest pattern: storybook/public/...stories.tsx — ExportName
- Exact mismatch: ...
- Why composition/escape hatches fail: ...
- Proposed alternative and scope: ...
- Reuse decision: system extension | temporary exception
- Safeguards:
  - Accessibility: ...
  - Responsiveness: ...
  - Routing: ...
  - Plugin isolation: ...
- Review/removal condition: ...
```

Wait for an explicit yes to this deviation. Approval of the feature, plan, or general direction is not approval of the exception.

## Verification selection

- Run focused unit/architecture/story tests first.
- Run `bun run ui:conformance --quick` for every UI-affecting change.
- Run the plugin's `bun run test:ui` fixture for every changed page or slot contribution and inspect its HTML report. Treat CSS containment and canonical stylesheet identity as package blockers; keep overflow, axe, keyboard/focus, console, and screenshot review in conformance/CI.
- Run `bun run ui:conformance --full` for merge-ready migrations, supported-contract changes, and checkpoints.
- Run the canonical Storybook/Playwright tooling for visuals; never substitute host-OS screenshots for baseline approval.
- Keep the maintainer Storybook running when the user is actively reviewing it.

CI can prove imports, tokens, recorded debt, exception evidence, browser behavior, accessibility automation, performance, and deterministic publication. It cannot prove that a developer selected the right pattern. This skill's Storybook comparison and user-visible deviation explanation are therefore mandatory, not optional prose.
