# Plan: Tailwind Direct Spawn

Spec: `.claude/specs/tailwind-direct-spawn.md` (approved 2026-06-12). Small two-commit change; tasks are strictly linear.

## Task 1 — the fix (commit 1)

**Files:** `scripts/dev.ts` (`startTailwindWatch()`, ~line 215), `package.json` (`build:css`, line 18).

- `dev.ts`: add `const TAILWIND_BIN = join(REPO_ROOT, 'node_modules/.bin/tailwindcss')` near the other path constants; change the spawn from `nodeSpawn('bunx', ['@tailwindcss/cli', '-i', …, '-o', …, '--watch=always'], …)` to `nodeSpawn('bun', [TAILWIND_BIN, '-i', …, '-o', …, '--watch=always'], …)`. Stdio wiring, log classification, exit listener all unchanged.
- `package.json`: `"build:css": "tailwindcss -i ./packages/host/src/globals.css -o ./packages/host/public/globals.css"` (node_modules/.bin is on PATH in package scripts).
- Include the spec + this plan file.

**Verify:** typecheck clean; `bun run build:css` exits 0 and writes `packages/host/public/globals.css`; full suite green.

**Commit:** `fix(dev): spawn pinned local tailwind bin directly, not bunx @latest`

## Task 2 — manual end-to-end verification (checkpoint, no commit)

1. Ports 3737/3738 free → `bun run dev` → ready.
2. `ps` tree: exactly one tailwind process, direct child of the dev pid; no node grandchild, no bunx/volta wrapper; `pgrep -fl "tailwindcss@latest|bunx-"` finds nothing new.
3. `kill -TERM <dev pid>` → graceful chain runs → `pgrep -fl tailwindcss` empty; no orphans; revert any `_embedded-assets-static.ts` churn from the dev boot (known build-stamp trap).

## Task 3 — docs (commit 2)

- `.claude/knowledge/dev-loop.md` line 52: diagram line → `Spawn bun node_modules/.bin/tailwindcss --watch=always (child process)`.
- Same file, § Shutdown ordering: rewrite the "Separate pre-existing leak" sentence — leak fixed by direct spawn; keep one line of history for context.
- Only doc touch point (grep-verified across README/CLAUDE/CONTRIBUTING/docs).

**Commit:** `docs(dev): update dev-loop tailwind spawn + leak notes`

## Task 4 — ship

Code review of the diff, push `fix/tailwind-direct-spawn`, PR (no issue — straight to PR per spec), context in PR body.

## Verification summary

No new unit tests (spawn configuration, no logic surface — per spec). Gates: typecheck, `bun run build:css`, full suite, manual repro above.
