#!/usr/bin/env bun

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, posix, relative, resolve } from 'node:path'
import Ajv from 'ajv'
import ts from 'typescript'

import { PLUGIN_CLIENT_EXTERNALS } from '../../src/core/whiskit/externals'
import { externalSourceRoots } from '../docs/source-scan'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const PERFORMANCE_PATH = join(REPO_ROOT, 'design-system/performance.json')
const PERFORMANCE_SCHEMA_PATH = join(REPO_ROOT, 'design-system/performance.schema.json')
const BASE_UI_ENTRY = 'packages/sdk/src/ui/index.ts'
const UI_VENDOR_NAMES = new Set([
  'sdk-ui',
  'sdk-components',
  'sdk-layout',
  'sdk-patterns',
  'sdk-charts',
  'sdk-conversation',
])

export interface ByteArtifact {
  path: string
  bytes: number
}

export interface UiEntrypointArtifact extends ByteArtifact {
  name: string
  reachableBytes: number
}

export interface UiPluginArtifact extends ByteArtifact {
  repository: 'bakin' | 'bakin-bits-official'
  pluginId: string
}

export interface UiPerformanceSnapshot {
  schemaVersion: 1
  generatedBy: 'bun run ui:performance:generate'
  scope: {
    mode: 'official'
    repositories: ['bakin', 'bakin-bits-official']
    compatibilityMatrix: 'design-system/compatibility.json'
  }
  css: {
    canonicalPath: string
    canonicalBytes: number
    copyCount: number
    copyPaths: string[]
  }
  hostInitialJs: ByteArtifact
  sdkUiBundles: UiEntrypointArtifact[]
  vendorChunks: ByteArtifact[]
  pluginClients: UiPluginArtifact[]
}

export interface CssSource {
  path: string
  source: string
}

function portablePath(root: string, path: string, prefix = ''): string {
  const suffix = relative(root, path).split('\\').join('/')
  return prefix ? `${prefix}/${suffix}` : suffix
}

function resolveSourceImport(root: string, importer: string, specifier: string): string | undefined {
  let unresolved: string
  if (specifier.startsWith('@/')) unresolved = join(root, 'src', specifier.slice(2))
  else if (specifier.startsWith('.')) unresolved = resolve(dirname(importer), specifier)
  else return undefined

  const candidates = extname(unresolved)
    ? [unresolved]
    : [
        unresolved,
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        `${unresolved}.js`,
        `${unresolved}.jsx`,
        join(unresolved, 'index.ts'),
        join(unresolved, 'index.tsx'),
        join(unresolved, 'index.js'),
        join(unresolved, 'index.jsx'),
      ]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

function moduleSpecifiers(path: string): string[] {
  const source = readFileSync(path, 'utf-8')
  const parsed = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const specifiers = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) specifiers.add(node.moduleSpecifier.text)
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0])
    ) specifiers.add(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return [...specifiers].sort()
}

function forbiddenUiDomain(path: string): boolean {
  const normalized = path.split('\\').join('/')
  return normalized.includes('/components/charts/')
    || normalized.includes('/components/conversation/')
    || /\/packages\/sdk\/src\/(?:charts|conversation)\//.test(normalized)
}

/** Return the import chains by which base UI reaches a heavy UI domain. */
export function findForbiddenBaseUiDependencies(root: string): string[] {
  const entry = join(root, BASE_UI_ENTRY)
  if (!existsSync(entry)) return [`missing base UI entrypoint: ${BASE_UI_ENTRY}`]
  const findings = new Set<string>()

  const visit = (path: string, chain: string[], active: Set<string>): void => {
    for (const specifier of moduleSpecifiers(path)) {
      const imported = resolveSourceImport(root, path, specifier)
      if (!imported) continue
      const importedPath = portablePath(root, imported)
      const nextChain = [...chain, importedPath]
      if (forbiddenUiDomain(imported)) {
        findings.add(nextChain.join(' -> '))
        continue
      }
      if (active.has(imported)) continue
      visit(imported, nextChain, new Set([...active, imported]))
    }
  }

  visit(entry, [BASE_UI_ENTRY], new Set([entry]))
  return [...findings].sort()
}

function normalizedCss(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '')
    .trim()
}

/** Find plugin CSS that embeds the canonical host/design-system stylesheet. */
export function findDuplicateDesignSystemCss(canonical: CssSource, candidates: readonly CssSource[]): string[] {
  const expected = normalizedCss(canonical.source)
  if (expected.length < 32) return []
  return candidates
    .filter((candidate) => candidate.path !== canonical.path)
    .filter((candidate) => normalizedCss(candidate.source).includes(expected))
    .map((candidate) => candidate.path)
    .sort()
}

function mapBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  return new Map(values.map((value) => [key(value), value]))
}

/** Compare current measurements to the checked-in monotonic ceilings. */
export function diffUiPerformance(
  baseline: UiPerformanceSnapshot,
  actual: UiPerformanceSnapshot,
): string[] {
  const errors: string[] = []
  if (actual.css.canonicalBytes > baseline.css.canonicalBytes) {
    errors.push(`design-system CSS bytes increased: ${baseline.css.canonicalBytes} -> ${actual.css.canonicalBytes}`)
  }
  if (actual.css.copyCount > baseline.css.copyCount) {
    errors.push(`design-system CSS copies increased: ${baseline.css.copyCount} -> ${actual.css.copyCount}`)
  }
  if (actual.hostInitialJs.bytes > baseline.hostInitialJs.bytes) {
    errors.push(`initial host JS increased: ${baseline.hostInitialJs.bytes} -> ${actual.hostInitialJs.bytes}`)
  }

  const expectedSdk = mapBy(baseline.sdkUiBundles, (entry) => entry.name)
  for (const entry of actual.sdkUiBundles) {
    const expected = expectedSdk.get(entry.name)
    if (!expected) {
      errors.push(`new SDK UI bundle: ${entry.name} (${entry.bytes} bytes)`)
      continue
    }
    if (entry.bytes > expected.bytes) {
      errors.push(`SDK UI bundle increased: ${entry.name} bytes ${expected.bytes} -> ${entry.bytes}`)
    }
    if (entry.reachableBytes > expected.reachableBytes) {
      errors.push(`SDK UI bundle reachable bytes increased: ${entry.name} ${expected.reachableBytes} -> ${entry.reachableBytes}`)
    }
  }

  const sharedVendor = (entry: ByteArtifact): boolean => /\/sdk-shared-[^/]+\.js$/.test(entry.path)
  const expectedSharedBytes = baseline.vendorChunks
    .filter(sharedVendor)
    .reduce((total, entry) => total + entry.bytes, 0)
  const actualSharedBytes = actual.vendorChunks
    .filter(sharedVendor)
    .reduce((total, entry) => total + entry.bytes, 0)
  if (actualSharedBytes > expectedSharedBytes) {
    errors.push(`SDK shared vendor chunks increased: ${expectedSharedBytes} -> ${actualSharedBytes}`)
  }

  const expectedVendor = mapBy(baseline.vendorChunks.filter((entry) => !sharedVendor(entry)), (entry) => entry.path)
  for (const entry of actual.vendorChunks.filter((candidate) => !sharedVendor(candidate))) {
    const expected = expectedVendor.get(entry.path)
    if (!expected) errors.push(`new vendor chunk: ${entry.path} (${entry.bytes} bytes)`)
    else if (entry.bytes > expected.bytes) {
      errors.push(`vendor chunk increased: ${entry.path} ${expected.bytes} -> ${entry.bytes}`)
    }
  }

  const pluginKey = (entry: UiPluginArtifact): string => `${entry.repository}:${entry.pluginId}`
  const expectedPlugins = mapBy(baseline.pluginClients, pluginKey)
  for (const entry of actual.pluginClients) {
    const key = pluginKey(entry)
    const expected = expectedPlugins.get(key)
    if (!expected) errors.push(`new plugin client: ${key} (${entry.bytes} bytes)`)
    else if (entry.bytes > expected.bytes) {
      errors.push(`plugin client increased: ${key} ${expected.bytes} -> ${entry.bytes}`)
    }
  }
  return errors
}

function filesIn(directory: string, predicate: (name: string) => boolean): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter(predicate)
    .map((name) => join(directory, name))
    .filter((path) => statSync(path).isFile())
    .sort()
}

function byteArtifact(root: string, path: string, prefix = ''): ByteArtifact {
  return { path: portablePath(root, path, prefix), bytes: statSync(path).size }
}

export function measureReachableJsBytes(entry: string, boundary: string): number {
  const seen = new Set<string>()
  const visit = (path: string): void => {
    if (seen.has(path)) return
    seen.add(path)
    for (const specifier of moduleSpecifiers(path).filter((candidate) => candidate.startsWith('.'))) {
      const imported = resolve(dirname(path), specifier)
      if (!imported.startsWith(`${boundary}/`) || !existsSync(imported) || !statSync(imported).isFile()) continue
      visit(imported)
    }
  }
  visit(entry)
  return [...seen].reduce((total, path) => total + statSync(path).size, 0)
}

/**
 * Measure emitted JavaScript without Bun's checkout-path module labels.
 * Those labels are comments such as `// ../../repo/src/file.tsx`; their byte
 * count varies with the absolute checkout location even when code is identical.
 */
export function measureStableBuiltJsBytes(source: string): number {
  const moduleLabel = /^\/\/ (?:\.\.\/|\/).+\.(?:[cm]?[jt]sx?|json)$/
  const stableSource = source.split('\n').filter((line) => !moduleLabel.test(line)).join('\n')
  return Buffer.byteLength(stableSource)
}

function pluginClientEntries(pluginsRoot: string): Array<{ id: string; entry: string }> {
  if (!existsSync(pluginsRoot)) return []
  return readdirSync(pluginsRoot)
    .sort()
    .flatMap((id) => {
      const root = join(pluginsRoot, id)
      const entry = join(root, 'client.tsx')
      if (!existsSync(join(root, 'bakin-plugin.json')) || !existsSync(entry)) return []
      return [{ id, entry }]
    })
}

interface BuiltBitsClients {
  artifacts: UiPluginArtifact[]
  css: CssSource[]
  dispose: () => void
}

async function buildBitsClients(bitsPluginsRoot: string): Promise<BuiltBitsClients> {
  const entries = pluginClientEntries(bitsPluginsRoot)
  if (entries.length === 0) throw new Error(`No official Bits clients found under ${bitsPluginsRoot}`)
  const tempRoot = mkdtempSync(join(tmpdir(), 'bakin-bits-ui-performance-'))
  const artifacts: UiPluginArtifact[] = []
  const css: CssSource[] = []
  try {
    for (const { id, entry } of entries) {
      const outdir = join(tempRoot, id)
      let result: Awaited<ReturnType<typeof Bun.build>>
      try {
        result = await Bun.build({
          entrypoints: [entry],
          outdir,
          target: 'browser',
          format: 'esm',
          naming: 'client.[ext]',
          external: [...PLUGIN_CLIENT_EXTERNALS],
        })
      } catch (error) {
        throw new Error(
          `Failed to build official Bits client ${id}. Run bun install --frozen-lockfile in the Bits checkout.\n${String(error)}`,
        )
      }
      if (!result.success) {
        throw new Error(
          `Failed to build official Bits client ${id}. Run bun install --frozen-lockfile in the Bits checkout.\n${result.logs.join('\n')}`,
        )
      }
      const client = join(outdir, 'client.js')
      if (!existsSync(client)) throw new Error(`Official Bits client ${id} produced no client.js`)
      artifacts.push({
        repository: 'bakin-bits-official',
        pluginId: id,
        path: `bakin-bits-official/plugins/${id}/dist/client.js`,
        bytes: measureStableBuiltJsBytes(readFileSync(client, 'utf-8')),
      })
      const clientCss = join(outdir, 'client.css')
      if (existsSync(clientCss)) {
        css.push({
          path: `bakin-bits-official/plugins/${id}/dist/client.css`,
          source: readFileSync(clientCss, 'utf-8'),
        })
      }
    }
    return {
      artifacts: artifacts.sort((left, right) => left.path.localeCompare(right.path)),
      css: css.sort((left, right) => left.path.localeCompare(right.path)),
      dispose: () => rmSync(tempRoot, { recursive: true, force: true }),
    }
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true })
    throw error
  }
}

function officialBitsPluginsRoot(): string {
  for (const root of externalSourceRoots()) {
    for (const candidate of [root, join(root, 'plugins')]) {
      if (['messaging', 'projects', '_template'].every((id) => existsSync(join(candidate, id, 'bakin-plugin.json')))) {
        return candidate
      }
    }
  }
  throw new Error(
    'Official Bits plugins input is unavailable. Use BAKIN_DOCS_EXTERNAL_SOURCES or clone bakin-bits-official beside Bakin.',
  )
}

function collectCorePluginClients(root: string): UiPluginArtifact[] {
  const pluginsRoot = join(root, 'plugins')
  return pluginClientEntries(pluginsRoot).map(({ id }) => {
    const client = join(pluginsRoot, id, 'dist/client.js')
    if (!existsSync(client)) {
      throw new Error(`Missing production client ${portablePath(root, client)}; run bun run build:plugins`)
    }
    return {
      repository: 'bakin' as const,
      pluginId: id,
      ...byteArtifact(root, client),
    }
  }).sort((left, right) => left.path.localeCompare(right.path))
}

function collectCorePluginCss(root: string): CssSource[] {
  return pluginClientEntries(join(root, 'plugins')).flatMap(({ id }) => {
    const path = join(root, 'plugins', id, 'dist/client.css')
    if (!existsSync(path)) return []
    return [{ path: portablePath(root, path), source: readFileSync(path, 'utf-8') }]
  })
}

function requiredSingleArtifact(paths: string[], hint: string): string {
  if (paths.length !== 1) throw new Error(`${hint}; found ${paths.length}`)
  return paths[0]
}

/** Collect exact production UI payload measurements from core and official Bits. */
export async function collectUiPerformanceSnapshot(
  root = REPO_ROOT,
  bitsPluginsRoot = officialBitsPluginsRoot(),
): Promise<UiPerformanceSnapshot> {
  const vendorRoot = join(root, 'packages/host/public/vendor')
  const vendorPaths = filesIn(vendorRoot, (name) => name.endsWith('.js'))
  if (vendorPaths.length === 0) throw new Error('Missing production vendor bundles; run bun run build:vendors')

  const hostPath = requiredSingleArtifact(
    filesIn(join(root, 'packages/host/dist'), (name) => /^main\.(?:js|mjs)$/.test(name)),
    'Expected exactly one production host entry; run bun run build:host-shell',
  )
  const sdkUiBundles = vendorPaths.flatMap((path) => {
    const name = posix.basename(path, '.js')
    if (!UI_VENDOR_NAMES.has(name)) return []
    return [{
      name,
      ...byteArtifact(root, path),
      reachableBytes: measureReachableJsBytes(path, vendorRoot),
    }]
  }).sort((left, right) => left.name.localeCompare(right.name))
  if (!sdkUiBundles.some((entry) => entry.name === 'sdk-ui') || !sdkUiBundles.some((entry) => entry.name === 'sdk-components')) {
    throw new Error('Missing current SDK UI vendor entries; run bun run build:vendors')
  }

  const canonicalPath = existsSync(join(root, 'packages/sdk/styles.css'))
    ? join(root, 'packages/sdk/styles.css')
    : join(root, 'packages/host/public/globals.css')
  if (!existsSync(canonicalPath)) throw new Error('Missing design-system CSS; run bun run build:css')
  const canonical: CssSource = {
    path: portablePath(root, canonicalPath),
    source: readFileSync(canonicalPath, 'utf-8'),
  }

  const builtBits = await buildBitsClients(bitsPluginsRoot)
  try {
    const cssCandidates = [canonical, ...collectCorePluginCss(root), ...builtBits.css]
    const duplicatePaths = findDuplicateDesignSystemCss(canonical, cssCandidates)
    if (duplicatePaths.length > 0) {
      throw new Error(`Plugin bundles duplicate the design-system stylesheet:\n- ${duplicatePaths.join('\n- ')}`)
    }
    return {
      schemaVersion: 1,
      generatedBy: 'bun run ui:performance:generate',
      scope: {
        mode: 'official',
        repositories: ['bakin', 'bakin-bits-official'],
        compatibilityMatrix: 'design-system/compatibility.json',
      },
      css: {
        canonicalPath: canonical.path,
        canonicalBytes: Buffer.byteLength(canonical.source),
        copyCount: 1 + duplicatePaths.length,
        copyPaths: [canonical.path, ...duplicatePaths],
      },
      hostInitialJs: byteArtifact(root, hostPath),
      sdkUiBundles,
      vendorChunks: vendorPaths.map((path) => byteArtifact(root, path)),
      pluginClients: [...collectCorePluginClients(root), ...builtBits.artifacts]
        .sort((left, right) => left.path.localeCompare(right.path)),
    }
  } finally {
    builtBits.dispose()
  }
}

function validateAgainstSchema(value: unknown): string[] {
  const schema = JSON.parse(readFileSync(PERFORMANCE_SCHEMA_PATH, 'utf-8'))
  const validate = new Ajv({ allErrors: true }).compile(schema)
  if (validate(value)) return []
  return (validate.errors ?? []).map((error) => `${error.instancePath || '<root>'} ${error.message}`)
}

export function printUiPerformance(snapshot: UiPerformanceSnapshot): void {
  console.log('\n## Browser UI performance (official core + Bits)')
  console.log(`  ${snapshot.css.canonicalBytes} B  design-system CSS (${snapshot.css.copyCount} runtime copy)`)
  console.log(`  ${snapshot.hostInitialJs.bytes} B  initial host JS`)
  for (const entry of snapshot.sdkUiBundles) {
    console.log(`  ${entry.bytes} B  ${entry.name} (${entry.reachableBytes} B reachable)`)
  }
  for (const entry of snapshot.vendorChunks) console.log(`  ${entry.bytes} B  ${entry.path}`)
  for (const entry of snapshot.pluginClients) {
    console.log(`  ${entry.bytes} B  ${entry.repository}:${entry.pluginId}`)
  }
}

async function generate(): Promise<void> {
  const dependencies = findForbiddenBaseUiDependencies(REPO_ROOT)
  if (dependencies.length > 0) throw new Error(`Base UI reaches forbidden heavy domains:\n- ${dependencies.join('\n- ')}`)
  const snapshot = await collectUiPerformanceSnapshot()
  const errors = validateAgainstSchema(snapshot)
  if (errors.length > 0) throw new Error(`Invalid generated UI performance baseline:\n- ${errors.join('\n- ')}`)
  writeFileSync(PERFORMANCE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(`Generated ${portablePath(REPO_ROOT, PERFORMANCE_PATH)} with ${snapshot.pluginClients.length} plugin clients`)
}

async function check(): Promise<void> {
  if (!existsSync(PERFORMANCE_PATH)) {
    throw new Error('Missing design-system/performance.json; run bun run ui:performance:generate')
  }
  const baseline = JSON.parse(readFileSync(PERFORMANCE_PATH, 'utf-8')) as UiPerformanceSnapshot
  const dependencies = findForbiddenBaseUiDependencies(REPO_ROOT)
  const actual = await collectUiPerformanceSnapshot()
  const errors = [
    ...validateAgainstSchema(baseline),
    ...dependencies.map((chain) => `base UI reaches forbidden heavy domain: ${chain}`),
    ...diffUiPerformance(baseline, actual),
  ]
  if (errors.length > 0) throw new Error(`UI performance ratchet failed:\n- ${errors.join('\n- ')}`)
  console.log(
    `UI performance ratchet valid: ${actual.pluginClients.length} plugin clients, `
    + `${actual.vendorChunks.length} vendor chunks, ${actual.css.copyCount} design-system CSS copy`,
  )
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (process.argv.length > 3 || (command !== 'generate' && command !== 'check')) {
    throw new Error('Usage: bun run scripts/ui/performance.ts <generate|check>')
  }
  if (command === 'generate') await generate()
  else await check()
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
