# Terminal Multi-Device: Evidence

Spec: `terminal-multi-device.md`. Plan: `terminal-multi-device-plan.md` (its
own **Evidence** section holds the dated, per-task findings this file
summarizes). Scope: development build through checkpoint B6, before the
pushed-stack gates (T25) and the cutover and release (T26/T27).

## Repositories and versions

| | Base | Build tip (2026-11-01) |
|---|---|---|
| bakin | `ad2010cf3` (origin/main, rc.44 prep) | `feat/terminal-md-h2-socket-routes` @ `aa5c003d5` (67 commits over main) |
| bakin-bits-official | `7fa54da` (origin/main, terminal 0.3.5) | `feat/terminal-md-r3-scroll` @ `90e1f50` (236 commits over the base), terminal **0.4.0-dev.30** |

Nothing is pushed or merged past the checkpoint tags noted below; the stacks
are pushed and CI-verified in T25.

## Checkpoints (local tags, bits)

| Tag | Commit | What it closed |
|---|---|---|
| `tmd/cp3` | `55ac8e9` | B1 managed tmux, fingerprint, first bridge |
| `tmd/cp4` | `64f2a86` | B2 viewer WebSocket (SSE and POST input retired) |
| `tmd/cp5` | `3d14a74` | B3 sizing authority, presence, width fit |
| `tmd/cp6` | `0b0a604` | B4 `bakin terminal new|attach|ls` handoff |
| `tmd/r0-baseline` | `237754c` | R-track baseline before the replica rework |
| `tmd/r2` | `e19a5d0` | R2 one replica per session, raw display, final bundles |
| `tmd/r3` | `1906092` | R3 native scrolling, copy offers |
| `tmd/r3-accepted` | `e6fcac8` | Mark's live acceptance round on R3 |
| `tmd/cp8` | `90e1f50` | B6 attention, uploads, image draft, plus T38b (bridge deleted) |

`cp5` and `cp6` were pushed during B3/B4; the rest are local.

## Gates at `tmd/cp8` (all green, run sequentially)

Typecheck, lint, unit (1322 pass, including the Bits root contract tests), fuzz
shards 1–4 (677 pass each), real-tmux process tests (28 pass), viewer
browser suite on the live preview (Chromium 34 pass; WebKit 26 pass, 8 touch
cases skipped — WebKit has no gesture synthesis), and the Bits UI conformance
run against an SDK package built from bakin `03b477dab`
(`scripts/publish-sdk.ts --dry-run --keep-package-dir`, fresh stylesheet).

Bakin, at `aa5c003d5`: typecheck; composer, architecture and UI architecture
tests; story interaction tests for the changed stories; visual baselines
regenerated in the canonical Playwright image (Composer's unchanged, the new
tray's added). `ui:conformance --quick` passes every step except the census
SDK compatibility matrix, which tracks the sibling Bits checkout's ref and is
refreshed by T24b.

## Codex reviews

Every task went through at least two Codex CLI rounds, and every finding was
fixed or explicitly declined with Mark. B6: T21 seven rounds (the hand-written
bell scanner was dropped for tmux's own count), T22 four, T23a three, T23b
four, the checkpoint two.

## Open questions resolved

1. **Codex approval hook** (T21): Codex 0.160 has a `PermissionRequest`
   hook. Hooks need one-time trust in Codex's own review screen (Mark chose
   "trust once"); Bakin never passes `--dangerously-bypass-hook-trust`.
2. **Claude Code `--settings`** (T21): hooks passed with `--settings` merge
   with the user's, project and plugin hooks (verified on 2.1.316: a flag
   hook and a plugin hook both ran; `/hooks` does not list flag hooks).
3. **Ghostty extended keys and hyperlinks through tmux 3.7c**: configured
   (`lib/tmux-config.ts`); live verification is pending T26.
4. **Versions**: terminal 0.4.0 (breaking), Bakin rc.45.

Also verified (T23b): Claude Code 2.1.316 and Codex 0.160 turn a pasted image
path into an attached image only when the paste is the path alone, so images
are sent one path per paste; both read the file when it is pasted, which
settles the plan's readability check.

## Decisions made during the build (Mark)

- Codex hooks: trust once, never bypassed (2026-10-31).
- Desktop image paste: the same compose sheet in the page's input accessory
  (2026-11-01).
- `ComposerAttachmentTray`: Composer's tray made public in the SDK
  (2026-11-01, approved system extension).
- Six design-system exceptions renewed unchanged to 2027-01-31 (2026-11-01).
- Host body limit: left as documented (Claude's call, delegated; see spec).
- The detach "hang" report: not chased now; debugged in small steps as Mark
  uses it (2026-10-31).
