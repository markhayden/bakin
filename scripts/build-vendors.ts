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
 */
import { rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const VENDOR_DIR = './packages/host/public/vendor'
const TMP_DIR = './packages/host/public/vendor/.tmp-entries'

rmSync(VENDOR_DIR, { recursive: true, force: true })
mkdirSync(VENDOR_DIR, { recursive: true })
mkdirSync(TMP_DIR, { recursive: true })

interface VendorTarget {
  /** Module specifier the import map will redirect (e.g. 'react'). */
  specifier: string
  /** Output filename under vendor/ (without the extension). */
  name: string
  /** Absolute on-disk path to a generated or existing entry module. */
  entrypoint: string
}

// ---------------------------------------------------------------------------
// React-family wrapper content. Each string is written to a temp .ts file
// with the OWN specifier rewritten to an absolute path. React-family sub-
// specifiers (react/jsx-runtime, etc.) must NOT be externalized — only
// `react` is. Everything else gets inlined so the browser only needs to
// load the import-map-pointed bundle and its single `react` dependency.
// ---------------------------------------------------------------------------
const REACT_ABS = Bun.resolveSync('react', process.cwd())
const REACT_DOM_ABS = Bun.resolveSync('react-dom', process.cwd())
const REACT_DOM_CLIENT_ABS = Bun.resolveSync('react-dom/client', process.cwd())
const JSX_RUNTIME_ABS = Bun.resolveSync('react/jsx-runtime', process.cwd())
const JSX_DEV_RUNTIME_ABS = Bun.resolveSync('react/jsx-dev-runtime', process.cwd())
const TANSTACK_ROUTER_ABS = Bun.resolveSync('@tanstack/react-router', process.cwd())

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

const jsxDevRuntimeEntry = writeEntry('jsx-dev-runtime', `
// GENERATED. Same rationale as jsx-runtime.
import JsxDevRuntime from '${JSX_DEV_RUNTIME_ABS}'
export const { jsxDEV, Fragment } = JsxDevRuntime
export default JsxDevRuntime
`)

const tanstackRouterEntry = writeEntry('tanstack-router', `
// GENERATED. Native ESM package, so \`export *\` preserves every name
// cleanly. Must be externalized from every other bundle so the shell's
// <RouterProvider> and the plugins' useLocation/useNavigate share one
// RouterContext instance — otherwise hook reads throw "Cannot read
// properties of null (reading 'isServer')".
export * from '${TANSTACK_ROUTER_ABS}'
`)

const targets: VendorTarget[] = [
  { specifier: 'react', name: 'react', entrypoint: reactEntry },
  // One bundle for the whole react-dom surface — the import map points both
  // `react-dom` and `react-dom/client` at this file (see public/index.html).
  { specifier: 'react-dom', name: 'react-dom', entrypoint: reactDomEntry },
  { specifier: 'react/jsx-runtime', name: 'jsx-runtime', entrypoint: jsxRuntimeEntry },
  { specifier: 'react/jsx-dev-runtime', name: 'jsx-dev-runtime', entrypoint: jsxDevRuntimeEntry },
  { specifier: '@tanstack/react-router', name: 'tanstack-router', entrypoint: tanstackRouterEntry },
  { specifier: '@bakin/sdk', name: 'sdk-index', entrypoint: './packages/sdk/src/index.ts' },
  { specifier: '@bakin/sdk/ui', name: 'sdk-ui', entrypoint: './packages/sdk/src/ui/index.ts' },
  { specifier: '@bakin/sdk/hooks', name: 'sdk-hooks', entrypoint: './packages/sdk/src/hooks/index.ts' },
  { specifier: '@bakin/sdk/components', name: 'sdk-components', entrypoint: './packages/sdk/src/components/index.ts' },
  { specifier: '@bakin/sdk/slots', name: 'sdk-slots', entrypoint: './packages/sdk/src/slots/index.tsx' },
  { specifier: '@bakin/sdk/types', name: 'sdk-types', entrypoint: './packages/sdk/src/types/index.ts' },
  { specifier: '@bakin/sdk/utils', name: 'sdk-utils', entrypoint: './packages/sdk/src/utils/index.ts' },
]

const SDK_SPECIFIERS = ['@bakin/sdk', '@bakin/sdk/ui', '@bakin/sdk/hooks', '@bakin/sdk/components', '@bakin/sdk/slots', '@bakin/sdk/types', '@bakin/sdk/utils']

function externalsFor(target: VendorTarget): string[] {
  // Every non-react bundle externalizes `react` so the browser ends up
  // with exactly one React instance resolved through the import map.
  // SDK bundles also externalize their siblings to avoid duplicating
  // code across @bakin/sdk subpath bundles.
  const react = target.specifier === 'react' ? [] : ['react']
  const sdk = target.specifier.startsWith('@bakin/sdk')
    ? SDK_SPECIFIERS.filter((s) => s !== target.specifier)
    : []
  // Every bundle except the tanstack-router bundle itself externalizes
  // tanstack-router so the shell's <RouterProvider> and every consumer
  // read from the single context instance.
  const tanstack = target.specifier === '@tanstack/react-router' ? [] : ['@tanstack/react-router']
  return [...react, ...sdk, ...tanstack].flatMap((s) => ['--external', s])
}

// Use subprocess per target — Bun.build() in-process state has trouble
// with N serial invocations under certain module-resolution patterns.
// Subprocess isolation avoids it entirely.
for (const t of targets) {
  console.log(`  building ${t.specifier} → ${t.name}.js`)
  const externalArgs = externalsFor(t)

  const proc = Bun.spawn([
    'bun', 'build',
    t.entrypoint,
    '--outdir', VENDOR_DIR,
    '--target', 'browser',
    '--format', 'esm',
    '--entry-naming', `${t.name}.[ext]`,
    ...externalArgs,
  ], { stdout: 'pipe', stderr: 'pipe' })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const err = await new Response(proc.stderr).text()
    console.error(`Failed to build vendor bundle for ${t.specifier}:`)
    console.error(err)
    process.exit(1)
  }
}

// Remove the tmp entries after the builds — they'd otherwise be picked
// up by generate-embedded-assets and served by the static handler.
rmSync(TMP_DIR, { recursive: true, force: true })

// ---------------------------------------------------------------------------
// Post-process: patch immutable ESM namespace imports into mutable bindings.
//
// React's CJS source (react-jsx-runtime.development.js) does
// `var React = require('react'); ...; React = { react_stack_bottom_frame };`
// Bun bundles `require('react')` into `import * as React from "react"` when
// react is externalized — but ESM namespace imports are const, so the later
// `React = { ... }` throws `TypeError: Assignment to constant variable` at
// module load time. We rewrite every top-level `import * as X from "..."`
// into `import * as X__ns from "..."; var X = X__ns;` so the CJS-style
// reassignment works against a mutable `var` binding.
// ---------------------------------------------------------------------------
const NS_IMPORT_RE = /^import \* as ([A-Za-z_$][A-Za-z0-9_$]*) from (["'][^"']+["']);$/gm
for (const file of readdirSync(VENDOR_DIR)) {
  if (!file.endsWith('.js')) continue
  const path = join(VENDOR_DIR, file)
  const src = readFileSync(path, 'utf-8')
  const patched = src.replace(NS_IMPORT_RE, 'import * as $1__ns from $2; var $1 = $1__ns;')
  if (patched !== src) writeFileSync(path, patched)
}

console.log(`packages/host/public/vendor: ${targets.length} bundles built`)

export {}
