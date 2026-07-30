#!/usr/bin/env bun
/**
 * Kit-growth gate (storybook-refit T1.4, decision D9).
 *
 * Adding a component to the public kit is an explicit, reviewed act. Every
 * component-shaped VALUE export of the supported UI entrypoints (from the
 * public-api freeze) must be demonstrated by the public catalog — imported
 * from `@makinbakin/sdk/*` by at least one file under `storybook/public/`
 * or `storybook/support/`.
 *
 * Component-shaped means PascalCase (`Button`, `PageShell`); UPPER_SNAKE
 * constants and camelCase hooks/utils are out of scope — the gate exists to
 * stop unvetted patterns, not to force stories for plumbing.
 *
 * `design-system/kit-coverage.json` grandfathers today's undemonstrated
 * exports (monotonic ratchet, same contract as story-compliance.json): a
 * NEW export without a story fails immediately; reductions pass and are
 * committed via `generate`; a missing baseline file means absolute mode.
 *
 * Registration itself is already enforced by the public-api freeze
 * (`ui:public-api:check`) — this gate adds the demonstration leg.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const PUBLIC_API_PATH = 'design-system/public-api.json'
const BASELINE_PATH = 'design-system/kit-coverage.json'
const STORY_ROOTS = ['storybook/public', 'storybook/support']
const SDK_PREFIX = '@makinbakin/sdk'

interface PublicApiDocument {
  entrypoints: Array<{
    specifier: string
    status: string
    values: string[]
  }>
}

export interface KitCoverageBaseline {
  schemaVersion: 1
  generatedBy: string
  undemonstrated: string[]
}

function isComponentShaped(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && !/^[A-Z0-9_]+$/.test(name)
}

/** Component exports of every supported (non-frozen) UI entrypoint. */
export function supportedComponentExports(rootDir = REPO_ROOT): Map<string, string> {
  const document = JSON.parse(readFileSync(join(rootDir, PUBLIC_API_PATH), 'utf8')) as PublicApiDocument
  const components = new Map<string, string>()
  for (const entrypoint of document.entrypoints) {
    if (entrypoint.status.includes('frozen')) continue
    for (const name of entrypoint.values) {
      if (isComponentShaped(name)) components.set(name, entrypoint.specifier)
    }
  }
  return components
}

function walkSources(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path)
    }
  }
  visit(root)
  return files
}

/** Every name the public catalog imports from @makinbakin/sdk/*. */
export function catalogImportedNames(rootDir = REPO_ROOT): Set<string> {
  const names = new Set<string>()
  for (const rootName of STORY_ROOTS) {
    for (const path of walkSources(join(rootDir, rootName))) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
        if (!statement.moduleSpecifier.text.startsWith(SDK_PREFIX)) continue
        const clause = statement.importClause
        if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue
        for (const binding of clause.namedBindings.elements) {
          names.add((binding.propertyName ?? binding.name).text)
        }
      }
    }
  }
  return names
}

export function collectUndemonstrated(rootDir = REPO_ROOT): string[] {
  const demonstrated = catalogImportedNames(rootDir)
  const undemonstrated: string[] = []
  for (const [name, specifier] of supportedComponentExports(rootDir)) {
    if (!demonstrated.has(name)) undemonstrated.push(`${specifier} :: ${name}`)
  }
  return undemonstrated.sort()
}

function readBaseline(rootDir: string): KitCoverageBaseline | null {
  const path = join(rootDir, BASELINE_PATH)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as KitCoverageBaseline
}

export function checkKitGrowth(rootDir = REPO_ROOT): string[] {
  const baseline = readBaseline(rootDir)
  const grandfathered = new Set(baseline?.undemonstrated ?? [])
  return collectUndemonstrated(rootDir)
    .filter((entry) => !grandfathered.has(entry))
    .map((entry) => `${entry} is exported by the public kit but demonstrated by no public story${baseline ? '' : ' [absolute mode: no baseline file]'}`)
}

export function generateKitGrowth(rootDir = REPO_ROOT): KitCoverageBaseline {
  const baseline: KitCoverageBaseline = {
    schemaVersion: 1,
    generatedBy: 'bun run ui:kit-coverage:generate',
    undemonstrated: collectUndemonstrated(rootDir),
  }
  writeFileSync(join(rootDir, BASELINE_PATH), `${JSON.stringify(baseline, null, 2)}\n`)
  return baseline
}

if (import.meta.main) {
  const mode = process.argv[2]
  if (mode === 'generate') {
    const baseline = generateKitGrowth()
    console.log(`Generated ${BASELINE_PATH}: ${baseline.undemonstrated.length} grandfathered undemonstrated exports`)
  } else if (mode === 'check') {
    const errors = checkKitGrowth()
    if (errors.length > 0) {
      console.error(`Kit-growth gate failed:\n${errors.map((error) => `- ${error}`).join('\n')}`)
      process.exit(1)
    }
    const baseline = readBaseline(REPO_ROOT)
    console.log(`Kit-growth gate valid: ${baseline?.undemonstrated.length ?? 0} grandfathered exports remain${baseline ? '' : ' (absolute mode)'}`)
  } else {
    console.error('Usage: bun run scripts/ui/kit-growth.ts generate|check')
    process.exit(1)
  }
}
