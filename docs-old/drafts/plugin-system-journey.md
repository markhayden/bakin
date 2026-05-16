# Building a Plugin System That Didn't Fight Us (Eventually)

> **Draft — cleanup + research before publishing.**
> Working title options: "What I Learned Building a Plugin System on Next.js (Then Moving Off It)", "The Plugin System Your Framework Hates", "Three Tries at Runtime-Loaded UI Plugins"

---

## The setup

I've been building Bakin, a self-hosted multi-agent orchestration platform. Single user (me), runs on a Mac mini accessed via Tailscale. The whole point is extensibility — ten core plugins ship with it (tasks, workflows, projects, assets, schedule, memory, messaging, models, team, health), and I want third parties to be able to ship their own plugins with real UI, not just backend hooks.

Simple goal. Or so I thought.

## Where we started

Server-side plugin loading was already working: drop a folder in `~/.bakin/plugins/`, Bakin's server boots, dynamic-imports the plugin's `index.ts`, calls `plugin.activate(ctx)`. Hook registry, MCP tools, search content types, watchers, REST routes — all wired. For backend-only plugins this was clean and worked.

Client side was the problem. Every plugin's UI got imported statically at Bakin build time via a hand-maintained `plugin-manifest.ts` that had ten `import { navItems as taskNav } from '../../plugins/tasks/client'` lines. User plugins in `~/.bakin/plugins/` couldn't contribute UI because Next.js's bundle was closed after build. They could register server stuff and be invisible in the sidebar.

Not good.

## The plan

Build a plugin SDK (`@makinbakin/sdk`), migrate all plugins to import through it, introduce a slot system (`<Slot name="asset-preview" />` so plugins can inject UI anywhere), and finally add a runtime bundle loader that dynamically imports user plugins' pre-built JS at browser load.

The first 60% shipped cleanly. PR #145 landed 10 commits:
- `@makinbakin/sdk/{ui,hooks,components,slots,types,utils}` scaffolded
- Slot primitive (`registerSlot('slot-name', Component)` + `<Slot name="..." />`)
- All ~65 plugin files rewired to import only from `@makinbakin/sdk`
- ESLint rule locking the contract
- Cross-plugin component embeds (`AssetDetailModal`, `TaskAssets`) converted to slots
- `src/app/*/page.tsx` wrappers decoupled — each renders `<Slot name="page:/route" />`, plugins register their pages via `registerSlot` at load time

Zero `@bakin/<plugin-id>/*` imports left in `src/`. The SDK is the contract, enforced by lint. Really clean.

Then we hit the wall.

## The wall: React-sharing

The runtime bundle loader (Phase 3+4 in my spec) needed user plugins to ship a pre-built `dist/client.mjs`, Bakin to fetch it at runtime and dynamic-import via the browser. The plugin's module says `import { useState } from 'react'`. That `react` has to resolve to the SAME React instance as Bakin's own shell, or React hooks break catastrophically (two Reacts = two hook states = bedlam).

The textbook solution: externalize `react` from both the plugin's build AND the host's build, resolve via a browser import map to a single shared `react.mjs`.

Bakin's host is Next.js 16 with Turbopack. Here's what I discovered:

**You can't easily externalize React from Next.js.** Next.js ships with React bundled as a dependency of the framework itself. Marking it external requires custom webpack config that fights Next.js's own assumptions. Turbopack (the new Rust-based bundler Next.js 16 defaults to) doesn't expose this knob at all.

**Module Federation doesn't work on Turbopack.** Vercel's published position is that Module Federation is unsupported and won't be. Next.js 16 is Turbopack-first for production builds. Using MF means betting against the direction Next.js itself is going.

**The globalThis-React shim pattern** — have Bakin set `globalThis.__React = React`, write a tiny `/vendor/react.mjs` that re-exports from the global — is possible but fragile. You have to enumerate every React export (`useState`, `useEffect`, ... all of them) because ESM named exports don't proxy.

Every path I looked at was either fighting the framework, betting against its direction, or writing shims I'd regret.

## The realization

I went looking at how other plugin systems solve this:
- **Obsidian** ships plugins as pre-built `main.js`. Obsidian is Electron — the plugin runs in the same renderer as the host, sharing globals via `require('obsidian')`. Clean because there's only one JS runtime.
- **VS Code** uses a separate extension host process with IPC. Heavier than I want, but the isolation is real.
- **WordPress** plugins are PHP files loaded by the PHP interpreter. No bundling story at all — the language runtime is the plugin runtime.

The pattern: **plugin systems work cleanly when the host and plugins share a runtime layer that was designed to be extended.** Next.js's closed-world bundler is the opposite — it wants to know about every module at build time and ship one optimized blob.

The right question wasn't "how do I make Next.js do runtime bundle loading?" It was "why am I using a framework that doesn't want me to do this?"

## The pivot

Bun.

Bun is a Node-compatible runtime that also includes a bundler (`Bun.build()`), a package manager (`bun install`), and a single-file compiler (`bun build --compile` produces a cross-platform binary, 50-80MB, bundles the whole Bun runtime inside).

The insight that unlocked everything: **if Bakin ships as a binary, and the binary includes `Bun.build()`, then Bakin can compile plugins on the user's machine without the user having any toolchain.** Plugin authors ship TypeScript source. The user runs `bakin plugins install github:foo/bar`. Bakin git-clones the source, runs `Bun.build()` on it (using the bundler embedded in the binary), loads the result at runtime.

No Node on the user's machine. No pnpm. No Vite. Just the one binary.

For React-sharing: both Bakin's shell and plugin bundles mark `react` as external. Bakin emits an import map at page load pointing `react` at a vendor bundle Bakin serves. One React instance. Import maps are a W3C standard, shipped in every evergreen browser since 2023. No framework magic. No federation.

## Where we landed

Locked architecture:
- **Runtime + bundler + package manager:** Bun
- **Server:** `Bun.serve()` (replaces Next.js API routes, Hono, Express)
- **Client bundler:** `Bun.build()` with externals (replaces webpack/Turbopack)
- **Router:** TanStack Router (replaces Next.js App Router)
- **Distribution:** `bun build --compile` produces one binary per platform
- **Plugin model:** authors ship source, Bakin compiles on install, loaded at runtime via import maps
- **Core plugins:** compiled into the binary at release time (Obsidian model)
- **User plugins:** `~/.bakin/plugins/<id>/`, built on install, loaded dynamically, no restart required
- **SDK:** `@makinbakin/sdk` published to npm for plugin author IDE types

Migration spec is written, tracking issue is #147, ~5 calendar weeks of work estimated. Nine phases with explicit commit checkpoints and rollback strategy per phase.

## What I'd tell someone else building a plugin system

A few concrete takeaways, some expected, some not:

**1. Start with the install UX. Work backward.** "Can a non-technical user install a plugin?" is the single constraint that cascades through every technical choice. If "yes," then the host either (a) ships an interpreter for the plugin language, (b) bundles plugins into its own build at install time, or (c) runtime-loads pre-built bundles. Each has very different implications. Pick one before picking a framework.

**2. React-sharing is not a footnote.** If your plugins use React and you want them runtime-loaded, React-sharing is the single hardest technical problem you'll solve. Plan for it day one. Import maps are the cleanest answer in 2026. Module Federation works but locks you to webpack. Electron/Tauri sidestep it by sharing a renderer.

**3. Closed-world bundlers fight runtime-loaded plugins.** Next.js, Remix, Astro — all optimize for "know all code at build time, ship one blob." They're great for apps, bad for plugin hosts. Vite sits on a spectrum — it's more amenable to externals and import maps but still fundamentally a build-time tool.

**4. Build tool = plugin author's tool.** If you pick webpack for your host, plugin authors need a webpack-compatible build config for their externals to work. Pick a bundler both sides can use. Or better: pick a runtime that includes the bundler so plugin authors don't even need one.

**5. Two-tier architectures ("core plugins are special, user plugins are restricted") rot.** Every exception in the contract is a place where drift accumulates. If you're going to have both core plugins and user plugins, make them structurally identical — just different sources. We committed to this and it prevented a bunch of future "but wait, core plugins can reach into X because they're trusted" conversations.

**6. The Obsidian model is a proven reference point.** Single-process, plugins-as-modules, ship pre-built JS, permissions declared-but-not-enforced-at-runtime, curated marketplace as a social trust layer. If you're building something in that shape, study it hard. It works.

**7. A lint rule is worth a thousand architecture docs.** We added `no-restricted-imports` blocking cross-plugin and cross-layer imports from `plugins/**`. It caught zero violations when we added it (post-migration) but locks the door forever. Future-me can't accidentally drift back.

**8. When the framework fights the product, change the framework.** This one took me way too long to accept. I spent a week looking at globalThis shims before admitting the right answer was "stop using Next.js." The sunk cost of an existing codebase is almost never as expensive as fighting the wrong tool for months.

## What's next

Migration to Bun across 9 phases, ~25 working days. Binary distribution (Mac arm64 + Linux x64/arm64 day one). `@makinbakin/sdk` on npm. `bakin plugins install github:foo/bar` as the canonical install. Six months from now the success measure is: "a hobbyist self-hoster downloads the binary, installs a plugin from a friend's GitHub link, has working UI in under 2 minutes."

The plugin system survived the migration. That's the part I'm proud of. The SDK surface, the slot system, the hook registry, the `BakinPlugin.activate(ctx)` contract — all of that stays identical. We're replacing the runtime underneath, not the plugin contract on top. That's possible because the #145 work drew a clean boundary before the framework question got asked.

Get the contract right first. Then you can move the floor.
