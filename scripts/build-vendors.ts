/**
 * Build vendor bundles for the browser import map.
 *
 * Produces standalone ESM bundles that the shell + every plugin resolve to
 * at runtime via the import map emitted in packages/host/public/index.html.
 * One copy of each externalized module lives under
 * `packages/host/public/vendor/` and is served by the static file handler.
 *
 * The paths here must match the `imports` map keys in index.html.
 *
 * ## Layout
 *
 * - React family + tanstack-router: one bundle per specifier, built from
 *   generated wrapper entries (see below).
 * - @makinbakin/sdk/*: all browser subpath entries built in a SINGLE
 *   `bun build --splitting` invocation, so code shared between subpaths
 *   (shadcn primitives, @bakin/core helpers, plugin hooks) lands once in
 *   `sdk-shared-<hash>.js` chunks instead of being inlined into every
 *   subpath bundle (#422). The entry filenames are stable
 *   (`sdk-index.js`, `sdk-ui.js`, ...) and the import map is unchanged;
 *   only the chunk filenames are content-hashed. Chunk names CANNOT be
 *   deterministic: Bun rejects non-unique chunk output paths.
 *
 * ## Why the wrappers are generated instead of checked-in .ts files
 *
 * React, react-dom, and the jsx runtimes are CJS upstream. Passing their
 * package entrypoints directly to Bun.build produces `export default
 * require_react()` and nothing else — every `import { useState } from 'react'`
 * fails at runtime. Fix: wrapper files that import the default and
 * explicitly re-export every name in the package's CJS exports list.
 *
 * But wrappers can't be checked-in .ts files doing `import X from 'react'`
 * when we also need `--external react` to prevent the bundle from inlining
 * a second React copy. Bun's `--external react` is a prefix match — it
 * also externalizes `react/jsx-runtime`, so the jsx-runtime wrapper ends
 * up import-map-self-referencing. We generate the wrappers on the fly
 * with the OWN specifier resolved to an absolute path (so Bun inlines it)
 * while leaving `react` itself as the bare specifier (so Bun externalizes
 * and the import map resolves it to /vendor/react.js).
 *
 * The SDK entries are generated for a different reason: every real SDK
 * entry file is named `index.ts(x)`, so a multi-entry build with
 * `--entry-naming [name]` would collide. Each shim re-exports its real
 * entry and carries the desired output name.
 */
import { rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { jsxDevRuntimeEntrySource } from './vendor-entrypoints'

const REPO_ROOT = resolve(import.meta.dir, '..')
const VENDOR_DIR = join(REPO_ROOT, 'packages/host/public/vendor')

/** The browser-resolvable SDK subpaths and their stable vendor bundle names. */
export const SDK_VENDOR_TARGETS: ReadonlyArray<{ specifier: string; name: string; entrypoint: string }> = [
  { specifier: '@makinbakin/sdk', name: 'sdk-index', entrypoint: 'packages/sdk/src/index.ts' },
  { specifier: '@makinbakin/sdk/ui', name: 'sdk-ui', entrypoint: 'packages/sdk/src/ui/index.ts' },
  { specifier: '@makinbakin/sdk/layout', name: 'sdk-layout', entrypoint: 'packages/sdk/src/layout/index.ts' },
  { specifier: '@makinbakin/sdk/patterns', name: 'sdk-patterns', entrypoint: 'packages/sdk/src/patterns/index.ts' },
  { specifier: '@makinbakin/sdk/charts', name: 'sdk-charts', entrypoint: 'packages/sdk/src/charts/index.ts' },
  { specifier: '@makinbakin/sdk/conversation', name: 'sdk-conversation', entrypoint: 'packages/sdk/src/conversation/index.ts' },
  { specifier: '@makinbakin/sdk/content', name: 'sdk-content', entrypoint: 'packages/sdk/src/content/index.ts' },
  { specifier: '@makinbakin/sdk/hooks', name: 'sdk-hooks', entrypoint: 'packages/sdk/src/hooks/index.ts' },
  { specifier: '@makinbakin/sdk/slots', name: 'sdk-slots', entrypoint: 'packages/sdk/src/slots/index.tsx' },
  { specifier: '@makinbakin/sdk/types', name: 'sdk-types', entrypoint: 'packages/sdk/src/types/index.ts' },
  { specifier: '@makinbakin/sdk/utils', name: 'sdk-utils', entrypoint: 'packages/sdk/src/utils/index.ts' },
  { specifier: '@makinbakin/sdk/metadata', name: 'sdk-metadata', entrypoint: 'packages/sdk/src/metadata/index.ts' },
  { specifier: '@makinbakin/sdk/routing', name: 'sdk-routing', entrypoint: 'packages/sdk/src/routing/index.ts' },
  { specifier: '@makinbakin/sdk/navigation', name: 'sdk-navigation', entrypoint: 'packages/sdk/src/navigation/index.ts' },
  { specifier: '@makinbakin/sdk/internal', name: 'sdk-internal', entrypoint: 'packages/sdk/src/internal/index.ts' },
]

/**
 * Patch immutable ESM namespace imports into mutable bindings.
 *
 * React's CJS source (react-jsx-runtime.development.js) does
 * `var React = require('react'); ...; React = { react_stack_bottom_frame };`
 * Bun bundles `require('react')` into `import * as React from "react"` when
 * react is externalized — but ESM namespace imports are const, so the later
 * `React = { ... }` throws `TypeError: Assignment to constant variable` at
 * module load time. We rewrite every top-level `import * as X from "..."`
 * into `import * as X__ns from "..."; var X = X__ns;` so the CJS-style
 * reassignment works against a mutable `var` binding. Patched lines no
 * longer match the pattern, so re-running is a no-op.
 */
function patchNamespaceImports(dir: string): void {
  const NS_IMPORT_RE = /^import \* as ([A-Za-z_$][A-Za-z0-9_$]*) from (["'][^"']+["']);$/gm
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.js')) continue
    const path = join(dir, file)
    const src = readFileSync(path, 'utf-8')
    const patched = src.replace(NS_IMPORT_RE, 'import * as $1__ns from $2; var $1 = $1__ns;')
    if (patched !== src) writeFileSync(path, patched)
  }
}

/**
 * Build all nine @makinbakin/sdk/* vendor bundles in one splitting build.
 * Exported for the vendor-bundle tests, which run it against a temp outDir.
 */
export async function buildSdkVendorBundles(opts: { outDir: string; production: boolean }): Promise<void> {
  const tmpDir = join(opts.outDir, '.tmp-sdk-entries')
  mkdirSync(tmpDir, { recursive: true })
  try {
    const entries = SDK_VENDOR_TARGETS.map((t) => {
      const shim = join(tmpDir, `${t.name}.ts`)
      // `export *` is sufficient: no SDK entry module has a default export.
      writeFileSync(shim, `export * from '${join(REPO_ROOT, t.entrypoint)}'\n`)
      return shim
    })

    const proc = Bun.spawn([
      'bun', 'build',
      ...entries,
      '--outdir', opts.outDir,
      '--target', 'browser',
      '--format', 'esm',
      '--splitting',
      '--entry-naming', '[name].[ext]',
      '--chunk-naming', 'sdk-shared-[hash].[ext]',
      ...(opts.production ? ['--production'] : []),
      '--external', 'react',
      '--external', 'react-dom',
      '--external', '@tanstack/react-router',
    ], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' })

    if ((await proc.exited) !== 0) {
      console.error('Failed to build the SDK vendor bundles:')
      console.error(await new Response(proc.stderr).text())
      throw new Error('sdk vendor build failed')
    }
  } finally {
    // The shims must not survive — generate-embedded-assets walks outDir.
    rmSync(tmpDir, { recursive: true, force: true })
  }
  patchNamespaceImports(opts.outDir)
}

interface VendorTarget {
  /** Module specifier the import map will redirect (e.g. 'react'). */
  specifier: string
  /** Output filename under vendor/ (without the extension). */
  name: string
  /** Absolute on-disk path to a generated entry module. */
  entrypoint: string
}

async function main(): Promise<void> {
  const PRODUCTION = process.env.BAKIN_DEV !== '1'
  const TMP_DIR = join(VENDOR_DIR, '.tmp-entries')

  rmSync(VENDOR_DIR, { recursive: true, force: true })
  mkdirSync(VENDOR_DIR, { recursive: true })
  mkdirSync(TMP_DIR, { recursive: true })

  // -------------------------------------------------------------------------
  // React-family wrapper content. Each string is written to a temp .ts file
  // with the OWN specifier rewritten to an absolute path. React-family sub-
  // specifiers (react/jsx-runtime, etc.) must NOT be externalized — only
  // `react` is. Everything else gets inlined so the browser only needs to
  // load the import-map-pointed bundle and its single `react` dependency.
  // -------------------------------------------------------------------------
  const REACT_ABS = Bun.resolveSync('react', REPO_ROOT)
  const REACT_DOM_ABS = Bun.resolveSync('react-dom', REPO_ROOT)
  const REACT_DOM_CLIENT_ABS = Bun.resolveSync('react-dom/client', REPO_ROOT)
  const JSX_RUNTIME_ABS = Bun.resolveSync('react/jsx-runtime', REPO_ROOT)
  const JSX_DEV_RUNTIME_ABS = Bun.resolveSync('react/jsx-dev-runtime', REPO_ROOT)
  const TANSTACK_ROUTER_ABS = Bun.resolveSync('@tanstack/react-router', REPO_ROOT)

  function writeEntry(name: string, content: string): string {
    const path = join(TMP_DIR, `${name}.ts`)
    writeFileSync(path, content, 'utf-8')
    return path
  }

  const reactEntry = writeEntry('react', `
// GENERATED — see scripts/build-vendors.ts. Enumerates every react.cjs
// export so Bun preserves them as named exports in the bundle output.
import React from '${REACT_ABS}'
export const {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  __COMPILER_RUNTIME,
  Activity, Children, Component, Fragment, Profiler, PureComponent,
  StrictMode, Suspense,
  act, cache, cacheSignal, captureOwnerStack,
  cloneElement, createContext, createElement, createRef, forwardRef,
  isValidElement, lazy, memo, startTransition, use,
  unstable_useCacheRefresh, version,
  useActionState, useCallback, useContext, useDebugValue, useDeferredValue,
  useEffect, useEffectEvent, useId, useImperativeHandle, useInsertionEffect,
  useLayoutEffect, useMemo, useOptimistic, useReducer, useRef, useState,
  useSyncExternalStore, useTransition,
} = React
export default React
`)

  const reactDomEntry = writeEntry('react-dom', `
// GENERATED. Consolidates react-dom + react-dom/client into one bundle
// so react-dom's shared internal state only exists once. Both import-map
// entries for these specifiers point at this file. React is left as a
// bare specifier so Bun externalizes it.
import ReactDOM from '${REACT_DOM_ABS}'
import * as ReactDOMClient from '${REACT_DOM_CLIENT_ABS}'
export const {
  __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  createPortal, flushSync, preconnect, prefetchDNS, preinit, preinitModule,
  preload, preloadModule, requestFormReset, unstable_batchedUpdates,
  useFormState, useFormStatus,
} = ReactDOM
export const { createRoot, hydrateRoot, version } = ReactDOMClient
export default ReactDOM
`)

  const jsxRuntimeEntry = writeEntry('jsx-runtime', `
// GENERATED. Absolute path for the jsx-runtime itself so Bun's prefix-
// matched '--external react' doesn't catch it; 'react' inside the inlined
// source stays externalized and resolves through the import map.
import JsxRuntime from '${JSX_RUNTIME_ABS}'
export const { jsx, jsxs, Fragment } = JsxRuntime
export default JsxRuntime
`)

  const jsxDevRuntimeEntry = writeEntry('jsx-dev-runtime', jsxDevRuntimeEntrySource({
    production: PRODUCTION,
    jsxRuntimeAbs: JSX_RUNTIME_ABS,
    jsxDevRuntimeAbs: JSX_DEV_RUNTIME_ABS,
  }))

  const tanstackRouterEntry = writeEntry('tanstack-router', `
// GENERATED. Native ESM package, so \`export *\` preserves every name
// cleanly. Must be externalized from every other bundle so the shell's
// <RouterProvider> and the plugins' useLocation/useNavigate share one
// RouterContext instance — otherwise hook reads throw "Cannot read
// properties of null (reading 'isServer')".
export * from '${TANSTACK_ROUTER_ABS}'
`)

  const reactFamilyTargets: VendorTarget[] = [
    { specifier: 'react', name: 'react', entrypoint: reactEntry },
    // One bundle for the whole react-dom surface — the import map points both
    // `react-dom` and `react-dom/client` at this file (see public/index.html).
    { specifier: 'react-dom', name: 'react-dom', entrypoint: reactDomEntry },
    { specifier: 'react/jsx-runtime', name: 'jsx-runtime', entrypoint: jsxRuntimeEntry },
    { specifier: 'react/jsx-dev-runtime', name: 'jsx-dev-runtime', entrypoint: jsxDevRuntimeEntry },
    { specifier: '@tanstack/react-router', name: 'tanstack-router', entrypoint: tanstackRouterEntry },
  ]

  function externalsFor(target: VendorTarget): string[] {
    // Every non-react bundle externalizes `react` so the browser ends up
    // with exactly one React instance resolved through the import map.
    const react = target.specifier === 'react' ? [] : ['react']
    // Every bundle except the tanstack-router bundle itself externalizes
    // tanstack-router so the shell's <RouterProvider> and every consumer
    // read from the single context instance.
    const tanstack = target.specifier === '@tanstack/react-router' ? [] : ['@tanstack/react-router']
    return [...react, ...tanstack].flatMap((s) => ['--external', s])
  }

  // Use subprocess per target — Bun.build() in-process state has trouble
  // with N serial invocations under certain module-resolution patterns.
  // Subprocess isolation avoids it entirely.
  for (const t of reactFamilyTargets) {
    console.log(`  building ${t.specifier} → ${t.name}.js`)
    const proc = Bun.spawn([
      'bun', 'build',
      t.entrypoint,
      '--outdir', VENDOR_DIR,
      '--target', 'browser',
      '--format', 'esm',
      '--entry-naming', `${t.name}.[ext]`,
      ...(PRODUCTION ? ['--production'] : []),
      ...externalsFor(t),
    ], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const err = await new Response(proc.stderr).text()
      console.error(`Failed to build vendor bundle for ${t.specifier}:`)
      console.error(err)
      process.exit(1)
    }
  }

  console.log(`  building @makinbakin/sdk/* → ${SDK_VENDOR_TARGETS.length} bundles + shared chunks (splitting)`)
  await buildSdkVendorBundles({ outDir: VENDOR_DIR, production: PRODUCTION })

  // Remove the tmp entries after the builds — they'd otherwise be picked
  // up by generate-embedded-assets and served by the static handler.
  rmSync(TMP_DIR, { recursive: true, force: true })

  patchNamespaceImports(VENDOR_DIR)

  const bundleCount = readdirSync(VENDOR_DIR).filter((f) => f.endsWith('.js')).length
  console.log(`packages/host/public/vendor: ${bundleCount} bundles built`)
}

if (import.meta.main) {
  await main()
}

export {}
