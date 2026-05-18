# Spec: CLI TUI Output Style Spike

## Status

Prototype spike on branch `spike/cli-tui-style-gallery`.

This is a design artifact, not the final CLI migration plan. The gallery exists
so we can tune the look, density, wrapping, status language, and command maps
before wiring real commands into the shared presentation layer.

## Objective

Create an executable mock of the Bakin terminal experience using realistic
fixture data. The mock should show the experience we want users and agents to
see across common command families:

- diagnostics
- repairs and delegated repairs
- onboarding decisions, selections, progress, async feedback, blockers, and completion
- plugin/package/task lists
- setup blockers
- command failures with remediation

Success means we can run one script, inspect the output at narrow and wide
terminal widths, and decide whether the style is worth integrating.

## Commands

Render every screen:

```bash
bun run cli:tui-gallery
```

Render one screen:

```bash
bun run cli:tui-gallery doctor
bun run cli:tui-gallery onboard
bun run cli:tui-gallery onboard-antfly-confirm
bun run cli:tui-gallery onboard-plugin-selection
bun run cli:tui-gallery onboard-agent-selection
bun run cli:tui-gallery doctor-fix
bun run cli:tui-gallery plugins
```

Render at a specific terminal width:

```bash
bun run cli:tui-gallery doctor --columns 100
```

List available screens:

```bash
bun run cli:tui-gallery --list
```

Verify the spike:

```bash
bun test --isolate tests/cli/tui-gallery.test.tsx
bun run typecheck
```

## Project Structure

```text
scripts/cli-tui-gallery.tsx             executable gallery runner
src/core/cli/ui/style-tokens.ts         prototype status/color/spacing tokens
src/core/cli/ui/tui-gallery.tsx         gallery components and fixture screens
tests/cli/tui-gallery.test.tsx          width and screen coverage
.claude/specs/cli-tui-output-style.md   this spec
```

## Style Direction

The gallery should feel like a quiet operational tool:

- every human-facing TTY screen starts with the compact Bakin boxed header
- compact enough for repeated use
- clear status tokens at the left edge
- labels that scan vertically
- messages that wrap into the available width
- remediation grouped under the affected row
- section headers rendered as bold white text with a bold white divider line
- no decorative boxes or nested cards
- summaries near the top and final next actions near the bottom
- interactive selection mocks render the same `MultiSelect` primitive used by
  real onboarding, so focus and selected markers come from Ink UI instead of a
  hand-drawn fixture
- embedded selection prompts omit the internal `MultiSelect` title when the
  surrounding screen header and section already name the interaction
- confirmation mocks show default behavior in the prompt text

Status vocabulary uses fixed-width color blocks with contrasting foreground
text, not bracketed labels:

```text
 OK       completed successfully
 WARN     usable, but attention needed
 FAIL     blocked or failed
 SKIP     intentionally not run
 READY    ready for action
 RUN      in progress or simulated running state
 APPLIED  deterministic change applied
 SENT     delegated request/task delivered
```

## Testing Strategy

The tests do not snapshot the entire screen. They assert the behaviors that
matter for later integration:

- known screens render
- wide output keeps status tokens intact
- narrow output wraps within the requested width
- repair and delegated workflows include realistic next actions
- selection behavior is covered by the `MultiSelect` state reducer tests, while
  gallery tests assert that selection screens render the real Ink UI markers

## Boundaries

- Always: use fixture data only, keep JSON/non-TTY behavior untouched, preserve
  existing real CLI commands.
- Ask first: replacing current production CLI primitives with spike components.
- Never: call Bakin APIs, mutate state, install assets, or change command
  dispatch during this spike.

## Success Criteria

- A developer can run the gallery and inspect realistic CLI screens.
- The gallery renders cleanly at both narrow and wide terminal widths.
- The style tokens are explicit enough to seed the real implementation plan.
- The branch can be reviewed as a design spike without behavior risk.

## Open Questions For The Follow-Up Plan

- Which command family should migrate first after the style is approved?
- Should the real implementation preserve current output substrings for tests,
  or should tests move to component-level assertions?
- Should long-running flows use the same static primitives, or a separate live
  progress layout with shared tokens?
