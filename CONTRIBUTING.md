# Contributing to Bakin'

Thanks for helping improve Bakin'. This file is the quick source-tree setup and check list; the canonical contributor guide lives in [Bakin' Core](https://makinbakin.com/docs/extending/development-workflow/).

## Prerequisites

- [Bun](https://bun.sh) `>= 1.2.0`
- Git

Install Bun:

```sh
curl -fsSL https://bun.sh/install | bash
# or
brew install oven-sh/bun/bun
```

Verify:

```sh
bun --version
```

No separate Node.js, pnpm, yarn, or Vite install is needed for normal repo work.

## First-Time Setup

```sh
git clone git@github.com:markhayden/bakin.git
cd bakin
bun install
bun run typecheck
bun run test
```

## Common Commands

```sh
bun run dev                 # watch-mode local app
bun run start               # build assets, then boot server.ts
bun run server              # boot server.ts without rebuilding
bun run build               # production binary build
bun run typecheck           # TypeScript
bun run test                # full test suite (the flags CI uses live in package.json)
bun run test:watch          # test watch mode
bun test <file> --isolate   # one file, fresh process
bun run lint                # ESLint
bun run docs:check          # generate, validate, and build public docs
```

For mock runtime development:

```sh
bun run dev:mock
```

For Docker-backed OpenClaw development, see [dev/docker/README.md](./dev/docker/README.md).

## Development Loop

Use `bun run dev` for day-to-day app and plugin work. It builds the host shell, watches client-side plugin and shell changes, and runs Bakin locally.

The full loop, including what rebuilds on each file change, plugin `devWatch`, generated docs, and PR expectations, is maintained in [Bakin' Core](https://makinbakin.com/docs/extending/development-workflow/).

## Public Contracts

When behavior changes, update the contract next to it and regenerate docs:

- CLI metadata in `src/core/cli/registry.ts`
- declarative route metadata or manifest `contributes.apiRoutes`
- hook metadata where hooks are registered
- exec tool descriptions and schemas
- plugin manifest permissions, runtime capabilities, and contributions
- SDK exports and TSDoc for public SDK surfaces
- docs snippets and generated docs blocks

Then run:

```sh
bun run docs:check
```

## Tests

All tests must mock `packages/core/src/content-dir` to use a temp directory. Tests must not read or write the real `~/.bakin/` directory.

Run targeted tests while iterating, then run the broader checks before review:

```sh
bun run typecheck
bun run lint
bun run test
bun run docs:check
```

## Releases

Releases are cut from `main` with the local release driver:

```sh
bun run release patch --dry-run
bun run release patch
bun run release minor --rc
bun run release promote
```

The release workflow builds binaries, signs and notarizes macOS artifacts, computes checksums, publishes `@makinbakin/sdk`, updates the Homebrew tap for stable releases, publishes the GitHub release, and runs post-publish smoke checks. npm publishing uses trusted publishing; do not add an `NPM_TOKEN`.
