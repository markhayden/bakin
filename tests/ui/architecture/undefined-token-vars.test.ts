import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Every `var(--bakin-…)` reference must resolve to a real custom property.
 *
 * A CSS variable that resolves to nothing fails silently: `padding: var(--x)`
 * computes to 0, `font-size: var(--x)` falls back to inheritance, and the
 * intent quietly disappears (the P5.9 sweep found 20+ such references). This
 * scanner extracts every `--bakin-*` reference across the design-system
 * surface and fails when a name is neither declared in a checked source nor
 * a documented runtime-set variable.
 */

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')

/**
 * Variables assigned at runtime (inline style objects with dynamic names,
 * `style.setProperty`, plugin-scoped injection) rather than declared in a
 * stylesheet. Each entry documents who sets it.
 */
const RUNTIME_SET_VARS: Record<string, string> = {
  '--bakin-search-input-inline-size': 'SearchInput sets the collapsed/focused inline size per render (packages/ui/src/patterns/search-input.tsx)',
  '--bakin-tool-drawer-width': 'Tool-call drawer sets its user-resized width per render (packages/ui/src/conversation/tool-call-drawer.tsx)',
  '--bakin-grid-columns': 'Internal candidate-ui specimen grid sets its column count per instance (storybook/internal/specimens/candidate-ui.tsx)',
  '--bakin-drawer-width': 'Page drawer sets its persisted resize width; the name is assembled from a string constant, invisible to static scans',
  '--bakin-list-row-columns': 'ListRows consumers set the shared column template per list via inline style (packages/ui/src/patterns/list-rows.tsx contract)',
  '--bakin-header-top': 'Host header sets the banner-stack offset via style.setProperty (packages/host/src/components/layout/header.tsx)',
  '--bakin-shell-top': 'Host header sets the shell sticky offset via style.setProperty (packages/host/src/components/layout/header.tsx)',
}

const SCAN_ROOTS = [
  'storybook',
  'packages/ui/src',
  'packages/sdk/src',
  'packages/host/src',
  'plugins',
] as const

const SCAN_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const EXCLUDED_DIRS = new Set(['dist', 'node_modules'])

const REFERENCE_PATTERN = /var\(\s*(--bakin-[a-zA-Z0-9-]+)/g
// Declarations: CSS custom properties (`--x:`), TS style-object keys
// (`'--x':` / `"--x":`), and imperative assignment (`setProperty('--x'`).
const DECLARATION_PATTERNS = [
  /(--bakin-[a-zA-Z0-9-]+)\s*:/g,
  /['"](--bakin-[a-zA-Z0-9-]+)['"]\s*:/g,
  /setProperty\(\s*['"](--bakin-[a-zA-Z0-9-]+)['"]/g,
] as const

interface Reference {
  name: string
  file: string
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      walk(join(dir, entry.name), files)
    } else if (SCAN_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

export function extractReferences(source: string, file: string): Reference[] {
  const references: Reference[] = []
  for (const match of source.matchAll(REFERENCE_PATTERN)) {
    references.push({ name: match[1]!, file })
  }
  return references
}

export function extractDeclarations(source: string): string[] {
  const declared: string[] = []
  for (const pattern of DECLARATION_PATTERNS) {
    for (const match of source.matchAll(pattern)) declared.push(match[1]!)
  }
  return declared
}

function collect(): { references: Reference[]; declared: Set<string> } {
  const references: Reference[] = []
  const declared = new Set<string>()
  for (const root of SCAN_ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
      const source = readFileSync(file, 'utf8')
      const rel = relative(REPO_ROOT, file)
      references.push(...extractReferences(source, rel))
      for (const name of extractDeclarations(source)) declared.add(name)
    }
  }
  return { references, declared }
}

describe('undefined --bakin token variables', () => {
  it('classifier extracts references and declarations from every supported form', () => {
    // References: plain CSS, Tailwind arbitrary values, inline style strings.
    expect(extractReferences('padding: var(--bakin-layout-space-4);', 'a.css').map((r) => r.name))
      .toEqual(['--bakin-layout-space-4'])
    expect(extractReferences("className=\"duration-[var(--bakin-motion-duration-feedback)]\"", 'a.tsx').map((r) => r.name))
      .toEqual(['--bakin-motion-duration-feedback'])
    expect(extractReferences('var( --bakin-radius-surface )', 'a.css').map((r) => r.name))
      .toEqual(['--bakin-radius-surface'])
    // A fallback-carrying reference still names the variable.
    expect(extractReferences('top: var(--bakin-header-top, 0px)', 'a.css').map((r) => r.name))
      .toEqual(['--bakin-header-top'])
    // Non-bakin variables are out of scope.
    expect(extractReferences('gap: var(--candidate-item-gap)', 'a.css')).toEqual([])

    // Declarations: stylesheet, TS style-object key, setProperty.
    expect(extractDeclarations('  --bakin-layout-space-4: 1rem;')).toContain('--bakin-layout-space-4')
    expect(extractDeclarations("style={{ '--bakin-tool-drawer-width': `${width}px` }}")).toContain('--bakin-tool-drawer-width')
    expect(extractDeclarations("root.style.setProperty('--bakin-shell-top', value)")).toContain('--bakin-shell-top')
    // A reference alone is NOT a declaration.
    expect(extractDeclarations('padding: var(--bakin-layout-space-4);')).toEqual([])
    expect(extractDeclarations('color: var(--bakin-color-text-muted)')).toEqual([])
  })

  it('every referenced --bakin variable is declared or documented as runtime-set', () => {
    const { references, declared } = collect()
    expect(references.length).toBeGreaterThan(100)
    expect(declared.size).toBeGreaterThan(30)

    const offenders = new Map<string, Set<string>>()
    for (const { name, file } of references) {
      if (declared.has(name) || name in RUNTIME_SET_VARS) continue
      const files = offenders.get(name) ?? new Set<string>()
      files.add(file)
      offenders.set(name, files)
    }

    const report = [...offenders.entries()]
      .map(([name, files]) => `${name}\n${[...files].map((file) => `    ${file}`).join('\n')}`)
      .sort()
    expect(report).toEqual([])
  })

  it('keeps the runtime allowlist minimal: every entry is actually referenced', () => {
    const { references } = collect()
    const referenced = new Set(references.map((reference) => reference.name))
    // --bakin-drawer-width is assembled from a string constant at runtime, so
    // no static reference exists; every other entry must still earn its slot.
    const unreferenced = Object.keys(RUNTIME_SET_VARS)
      .filter((name) => !referenced.has(name) && name !== '--bakin-drawer-width')
    expect(unreferenced).toEqual([])
  })
})
