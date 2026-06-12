# Tailwind Direct Spawn — fix watch-process leak + version drift

**Tracking:** No issue (confirmed straight-to-PR); discovered during #459 verification, noted in `.claude/knowledge/dev-loop.md` § Shutdown ordering.

## Objective

Killing the dev loop must not orphan the tailwind watch process, and tailwind must run the lockfile-pinned version.

### Root causes (verified live 2026-06-11)

1. **Leak:** `scripts/dev.ts` `startTailwindWatch()` spawns `bunx @tailwindcss/cli … --watch=always`. On this machine the chain is volta-shim → bunx → **node grandchild** (the CLI's `#!/usr/bin/env node` shebang). `tailwindChild.kill('SIGTERM')` hits only the wrapper; the node grandchild reparents to launchd and watches files forever. Observed twice during #459 verification (pids 91436, 91590, ppid 1).
2. **Version drift:** the bunx temp dir was `bunx-501-@tailwindcss/cli@latest` — bunx downloaded floating **@latest** instead of using the repo's pinned devDependency `@tailwindcss/cli@^4.2.4` (present at `node_modules/.bin/tailwindcss` → `../@tailwindcss/cli/dist/index.mjs`).

## Design (decisions confirmed 2026-06-11)

1. **`scripts/dev.ts`:** spawn the local bin directly under bun — `nodeSpawn('bun', [join(REPO_ROOT, 'node_modules/.bin/tailwindcss'), '-i', …, '-o', …, '--watch=always'], …)`. The child pid IS the tailwind process: SIGTERM kills it, no grandchild, no wrapper resolution at boot, version comes from the lockfile. Verified: `bun node_modules/.bin/tailwindcss --help` runs v4.2.4 clean (bun executes the .mjs directly, shebang ignored). Everything else (stdio piping, log classification, `--watch=always` for closed stdin, exit listener, `.killed` guard) unchanged.
2. **`package.json` `build:css`:** switch `bunx @tailwindcss/cli …` → `tailwindcss …` — package scripts have `node_modules/.bin` on PATH, so this unambiguously resolves to the pinned version. One-shot command (no leak), fixed for drift + consistency.
3. **No issue filed** — PR carries the context.

## Acceptance criteria

1. `bun run dev` → ready: exactly one tailwind process, a **direct child** of the dev process (no node grandchild, no bunx/volta wrapper).
2. `kill -TERM <dev pid>` → graceful shutdown → `pgrep -fl tailwindcss` empty.
3. CSS pipeline still works: tailwind watch emits, `build:css` produces `packages/host/public/globals.css` with the pinned v4.2.4.
4. Full suite (`bun run test`) passes; typecheck clean.

## Out of scope

- No changes to `scripts/dev-shutdown.ts` (just shipped in #491; its caller-side `.killed` guard already handles double-kill).
- No process-group machinery — tailwind v4's CLI spawns no workers of its own.

## Testing strategy

- This is spawn configuration, not logic — no meaningful unit test surface; do NOT add brittle tests that grep package.json. Manual verification per acceptance criteria + full-suite regression.

## Commit strategy (rollback checkpoints)

Branch `fix/tailwind-direct-spawn` off `main`:

1. `fix(dev): spawn pinned local tailwind bin directly, not bunx @latest` — `scripts/dev.ts` + `package.json` (`build:css`) + this spec.
2. `docs(dev): update dev-loop tailwind spawn + leak notes` — amend `.claude/knowledge/dev-loop.md` (architecture diagram line "Spawn bunx @tailwindcss/cli" and the § Shutdown ordering known-leak note → fixed).

## Documentation impact

- `.claude/knowledge/dev-loop.md`: two touch points (diagram + leak note).
- README / CLAUDE.md / CONTRIBUTING.md: verify no `bunx @tailwindcss` references; no other impact expected.
