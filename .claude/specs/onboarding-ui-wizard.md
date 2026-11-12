# Spec seed: Browser onboarding wizard

Status: **seed, not a spec.** This records what is already decided or
already built, so the real spec starts from facts. The spec itself needs its
own interview (`/waffleoff`); the open questions at the end are where it
starts.

## What this is

A second way to do first-run setup: in the browser, alongside the terminal
wizard. `bakin onboard` would ask whether to continue in the terminal or in
the browser.

## Already built (onboarding hardening, PRs 1-5)

The terminal flow was hardened first so the browser wizard is a second
client of one engine, not a second implementation.

| Piece | Where | What the browser wizard gets |
|---|---|---|
| Component installs as operations | `POST /api/runtime/onboarding/install`, `componentInstallOperation` | Every install already runs on the server with live progress (`useOperation`, `OperationProgress`) |
| Typed outcomes | `ComponentOutcome` in `src/core/onboarding/index.ts` | `status`, `reason`, `requires`, `code`; nothing to parse |
| Declared requirements | `requires` on each component | The wizard can show why a step is held back |
| Runtime decision table | `src/core/onboarding/runtime-choice.ts` (pure) | Same table; the browser is one more caller that can `ask` |
| Runtime commit | `settings` install with `runtimeAdapter` | One writer under `install-state`; typed refusals |
| Per-runtime copy | `RUNTIME_ADAPTER_SUPPORT` | `label`, `summary`, `loginSteps`, `docsUrl` for the login screen |
| Setup checklist engine | `src/core/onboarding/setup-checklist.ts` | `buildSetupChecklist` is pure; only an HTTP route and a renderer are missing |
| Write-free checks | `createCheckAppServices`, read-only storage | A "what would this do" preview is safe |
| Harness | `tests/integration/onboarding/` | Can boot the real server for a throwaway home (`startServer`) |

Knowledge: `.claude/knowledge/onboarding.md`.

## Decided during the hardening interview

- **Bakin never handles the LLM secret.** Credentials are guide-and-recheck
  on every surface: show the runtime's steps, the operator logs in inside
  the runtime, the wizard rechecks.
- **Terminal app handoff for login** (maintainer's idea, to be designed):
  the browser wizard can open a session in the official Terminal plugin
  with the login command prefilled, or show the steps in a corner panel to
  copy. Terminal is an official Bits plugin
  (`github:markhayden/bakin-bits-official#plugins/terminal`), not core, so
  the wizard cannot assume it is installed.
- **A reminder that follows you.** The setup checklist is the content; in
  the browser it becomes a sidebar card that stays until the items are done
  or dismissed. The shell already owns a "Make Bakin Yours" card
  (`packages/host/src/components/layout/sidebar-promo.tsx`).
- **Deferred to this spec, on purpose:** the checklist HTTP route and
  dismissals (which items the operator has waved off, and where that is
  stored).
- **Spend limits and brands are never checklist items.** Both are opt-in.

## Constraints the spec has to respect

- Browser UI work follows `.claude/skills/bakin-ui-conformance/SKILL.md`:
  Storybook-first, a defined pattern by default, explicit approval for any
  deviation.
- `bakin serve` is not marker-gated but `bakin start` is: a home that is
  not onboarded has no server unless something starts one. A browser
  wizard needs a server before the home is onboarded.
- A server binds its runtime at boot and plugins bind `ctx.runtime` at
  activation. Choosing a runtime in a browser served by a process already
  bound to another one is the `server_running_other_runtime` case; today
  that is a refusal, and a completed runtime switch needs a restart.
- Read-only storage is process-wide and never used in a server. A browser
  "preview" cannot use the CLI's check composition as is.
- Approvals carry provenance (#898): a decision made in the browser is a
  declared operator action, never an agent's.

## Open questions (the interview starts here)

1. **Bootstrap.** How does a server exist before the home is onboarded?
   Does `bakin onboard` start one in a limited mode and open the browser,
   or does `bakin start` serve only the wizard on a home with no marker?
2. **Runtime choice in the browser.** The server is already bound to a
   runtime when the page loads. Decide before the server starts (in the
   terminal), or let the browser choose and restart the server?
3. **Terminal or browser, asked where?** At the start of `bakin onboard`,
   and what happens on a machine with no browser (a headless mini over
   Tailscale: print a URL)?
4. **Login handoff.** Terminal plugin session, a copyable panel, or both;
   and what when the Terminal plugin is not installed yet?
5. **Checklist surface.** Route shape, where dismissals are stored, when
   the sidebar card disappears for good, and whether Health or Explore
   also shows it.
6. **Resume.** A wizard closed halfway: what does reopening it show, and is
   that state on the server or derived from checks?
7. **Scope of v1.** The whole flow in the browser, or only what benefits
   from one (plugin and agent selection, the model plan, the checklist)?
