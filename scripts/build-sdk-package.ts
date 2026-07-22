/**
 * Build a self-contained publish directory for the public SDK package.
 *
 * The source SDK package is optimized for the monorepo import map. This
 * script turns it into an npm package: bundled ESM entrypoints, generated
 * declarations, a publish-only package.json, and no repo-only import leaks.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(import.meta.dir, '..')
const SDK_DIR = join(REPO_ROOT, 'packages/sdk')
const ROOT_PACKAGE_PATH = join(REPO_ROOT, 'package.json')
const SDK_PACKAGE_PATH = join(SDK_DIR, 'package.json')
export const PUBLIC_SDK_PACKAGE_NAME = '@makinbakin/sdk'
export const SDK_STYLES_EXPORT = './styles.css'
export const SDK_STYLES_SPECIFIER = `${PUBLIC_SDK_PACKAGE_NAME}/styles.css`
const CANONICAL_SDK_STYLES_PATH = join(SDK_DIR, 'styles.css')
const SDK_UI_TEST_BIN = 'bin/bakin-plugin-test-ui.js'

export interface SdkExportEntry {
  exportPath: string
  source: string
  importPath: string
  typesPath: string
}

export const SDK_EXPORTS: SdkExportEntry[] = [
  { exportPath: '.', source: 'packages/sdk/src/index.ts', importPath: './index.js', typesPath: './index.d.ts' },
  { exportPath: './ui', source: 'packages/sdk/src/ui/index.ts', importPath: './ui/index.js', typesPath: './ui/index.d.ts' },
  { exportPath: './layout', source: 'packages/sdk/src/layout/index.ts', importPath: './layout/index.js', typesPath: './layout/index.d.ts' },
  { exportPath: './patterns', source: 'packages/sdk/src/patterns/index.ts', importPath: './patterns/index.js', typesPath: './patterns/index.d.ts' },
  { exportPath: './charts', source: 'packages/sdk/src/charts/index.ts', importPath: './charts/index.js', typesPath: './charts/index.d.ts' },
  { exportPath: './conversation', source: 'packages/sdk/src/conversation/index.ts', importPath: './conversation/index.js', typesPath: './conversation/index.d.ts' },
  { exportPath: './content', source: 'packages/sdk/src/content/index.ts', importPath: './content/index.js', typesPath: './content/index.d.ts' },
  { exportPath: './hooks', source: 'packages/sdk/src/hooks/index.ts', importPath: './hooks/index.js', typesPath: './hooks/index.d.ts' },
  { exportPath: './components', source: 'packages/sdk/src/components/index.ts', importPath: './components/index.js', typesPath: './components/index.d.ts' },
  { exportPath: './slots', source: 'packages/sdk/src/slots/index.tsx', importPath: './slots/index.js', typesPath: './slots/index.d.ts' },
  { exportPath: './types', source: 'packages/sdk/src/types/index.ts', importPath: './types/index.js', typesPath: './types/index.d.ts' },
  { exportPath: './utils', source: 'packages/sdk/src/utils/index.ts', importPath: './utils/index.js', typesPath: './utils/index.d.ts' },
  { exportPath: './metadata', source: 'packages/sdk/src/metadata/index.ts', importPath: './metadata/index.js', typesPath: './metadata/index.d.ts' },
  { exportPath: './routing', source: 'packages/sdk/src/routing/index.ts', importPath: './routing/index.js', typesPath: './routing/index.d.ts' },
  { exportPath: './navigation', source: 'packages/sdk/src/navigation/index.ts', importPath: './navigation/index.js', typesPath: './navigation/index.d.ts' },
  { exportPath: './testing', source: 'packages/sdk/src/testing/index.ts', importPath: './testing/index.js', typesPath: './testing/index.d.ts' },
  { exportPath: './testing/ui', source: 'packages/sdk/src/testing/ui/index.ts', importPath: './testing/ui/index.js', typesPath: './testing/ui/index.d.ts' },
  { exportPath: './testing/ui/conformance', source: 'packages/sdk/src/testing/ui/conformance/index.ts', importPath: './testing/ui/conformance/index.js', typesPath: './testing/ui/conformance/index.d.ts' },
  { exportPath: './internal', source: 'packages/sdk/src/internal/index.ts', importPath: './internal/index.js', typesPath: './internal/index.d.ts' },
]

const EXTERNAL_JS_PEERS = [
  '@tanstack/react-router',
  'axe-core',
  'playwright',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
]

const FORBIDDEN_BARE_PREFIXES = [
  '@/',
  '@bakin/ui',
  '@bakin/core',
  '@bakin/team',
  '@bakin/workflows',
  '@bakin/assets',
  '@bakin/tasks',
  '@bakin/memory',
  '@bakin/models',
  '@bakin/health',
  '@bakin/schedule',
]

const IMPORT_SPECIFIER_RE = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g

interface PackageJson {
  name?: string
  description?: string
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  dependencies?: Record<string, string>
  repository?: unknown
  homepage?: string
  bugs?: unknown
  author?: string
  license?: string
  keywords?: string[]
}

interface BuildSdkPackageOptions {
  version: string
  outDir: string
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function withoutDtsExtension(rel: string): string {
  return rel.replace(/\.d\.ts$/, '')
}

function normalizeRel(path: string): string {
  return toPosix(path).replace(/^\.\//, '')
}

function ensureRelativeSpecifier(specifier: string): string {
  return specifier.startsWith('.') ? specifier : `./${specifier}`
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return `${scope}/${name}`
  }
  return specifier.split('/')[0]
}

function collectFiles(dir: string, predicate: (path: string) => boolean): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(path, predicate))
    else if (predicate(path)) out.push(path)
  }
  return out
}

function mapSdkModule(rest: string): string | null {
  if (rest === 'index') return 'index'
  if (rest === 'register') return 'register'
  if (rest.endsWith('/index')) return rest
  if (rest === 'types' || rest === 'routing' || rest === 'ui' || rest === 'layout' || rest === 'patterns' || rest === 'charts' || rest === 'conversation' || rest === 'content' || rest === 'hooks' || rest === 'components' || rest === 'slots' || rest === 'utils' || rest === 'metadata' || rest === 'testing' || rest === 'testing/ui' || rest === 'testing/ui/conformance' || rest === 'internal') {
    return `${rest}/index`
  }
  // Public entry declarations retain relative references to their SDK leaf
  // modules (especially `types/*`). Preserve those leaves in the package;
  // dropping them leaves syntactically valid barrels whose exports resolve
  // to missing declarations for external consumers.
  return rest
}

function mapOriginalModulePath(originalNoExt: string): string | null {
  const normalized = normalizeRel(originalNoExt)
  if (normalized.startsWith('packages/sdk/src/')) {
    return mapSdkModule(normalized.slice('packages/sdk/src/'.length))
  }
  if (normalized.startsWith('packages/ui/src/')) {
    return `_internal/ui/${normalized.slice('packages/ui/src/'.length)}`
  }
  if (normalized.startsWith('packages/host/src/')) {
    return `_internal/host/${normalized.slice('packages/host/src/'.length)}`
  }
  if (normalized.startsWith('src/')) {
    return `_internal/app/${normalized.slice('src/'.length)}`
  }
  if (normalized.startsWith('packages/core/src/')) {
    return `_internal/core/${normalized.slice('packages/core/src/'.length)}`
  }
  if (normalized.startsWith('plugins/')) {
    return `_internal/plugins/${normalized.slice('plugins/'.length)}`
  }
  return null
}

function resolveOriginalRelativeSpecifier(originalFileRel: string, specifier: string): string | null {
  const base = normalizeRel(join(dirname(originalFileRel), specifier))
  const direct = mapOriginalModulePath(base)
  if (direct) return direct
  return mapOriginalModulePath(`${base}/index`)
}

function aliasTarget(specifier: string): string | null {
  if (specifier.startsWith('@/')) {
    return `_internal/app/${specifier.slice(2)}`
  }
  if (specifier === '@bakin/ui') return '_internal/ui/index'
  if (specifier.startsWith('@bakin/ui/')) {
    return `_internal/ui/${specifier.slice('@bakin/ui/'.length)}`
  }
  if (specifier === '@bakin/core') return '_internal/core/index'
  if (specifier.startsWith('@bakin/core/')) {
    return `_internal/core/${specifier.slice('@bakin/core/'.length)}`
  }
  for (const plugin of ['team', 'workflows', 'assets', 'tasks', 'memory', 'models', 'health', 'schedule']) {
    const prefix = `@bakin/${plugin}/`
    if (specifier.startsWith(prefix)) {
      return `_internal/plugins/${plugin}/${specifier.slice(prefix.length)}`
    }
  }
  return null
}

function rewriteModuleSpecifier(
  specifier: string,
  originalFileRel: string,
  outputFileRel: string,
): string {
  if (specifier.startsWith(PUBLIC_SDK_PACKAGE_NAME)) return specifier
  const target = aliasTarget(specifier)
    ?? (specifier.startsWith('.') ? resolveOriginalRelativeSpecifier(originalFileRel, specifier) : null)
  if (!target) return specifier

  const rewritten = toPosix(relative(dirname(outputFileRel), target))
  return ensureRelativeSpecifier(rewritten)
}

function rewriteDeclarationImports(content: string, originalFileRel: string, outputFileRel: string): string {
  return content.replace(IMPORT_SPECIFIER_RE, (match, fromSpec, bareSpec, dynamicSpec) => {
    const specifier = fromSpec ?? bareSpec ?? dynamicSpec
    const rewritten = rewriteModuleSpecifier(specifier, originalFileRel, outputFileRel)
    return match.replace(specifier, rewritten)
  })
}

function copyDeclarationTree(tempDtsDir: string, outDir: string): void {
  for (const file of collectFiles(tempDtsDir, (path) => path.endsWith('.d.ts'))) {
    const originalFileRel = normalizeRel(relative(tempDtsDir, file))
    const originalNoExt = withoutDtsExtension(originalFileRel)
    const mapped = mapOriginalModulePath(originalNoExt)
    if (!mapped) continue

    const outputFileRel = `${mapped}.d.ts`
    const outputFile = join(outDir, outputFileRel)
    const content = rewriteDeclarationImports(readFileSync(file, 'utf-8'), originalFileRel, outputFileRel)
    mkdirSync(dirname(outputFile), { recursive: true })
    writeFileSync(outputFile, content, 'utf-8')
  }
}

function buildJsEntry(entry: SdkExportEntry, outDir: string): void {
  const targetFile = join(outDir, entry.importPath)
  mkdirSync(dirname(targetFile), { recursive: true })
  const result = spawnSync('bun', [
    'build',
    join(REPO_ROOT, entry.source),
    '--outdir',
    dirname(targetFile),
    '--target',
    'bun',
    '--format',
    'esm',
    '--entry-naming',
    '[name].[ext]',
    ...EXTERNAL_JS_PEERS.flatMap((specifier) => ['--external', specifier]),
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    throw new Error(`Failed to build ${entry.exportPath}:\n${result.stdout}${result.stderr}`)
  }
  if (!existsSync(targetFile)) {
    throw new Error(`Expected ${entry.importPath} to be generated`)
  }
  if (statSync(targetFile).size === 0) {
    writeFileSync(targetFile, 'export {}\n', 'utf-8')
  }
}

function buildCli(outDir: string): void {
  const targetFile = join(outDir, SDK_UI_TEST_BIN)
  mkdirSync(dirname(targetFile), { recursive: true })
  const result = spawnSync('bun', [
    'build',
    join(SDK_DIR, 'src/testing/ui/conformance/cli.ts'),
    '--outfile', targetFile,
    '--target', 'bun',
    '--format', 'esm',
    ...EXTERNAL_JS_PEERS.flatMap((specifier) => ['--external', specifier]),
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    throw new Error(`Failed to build bakin-plugin-test-ui:\n${result.stdout}${result.stderr}`)
  }
  if (!existsSync(targetFile) || statSync(targetFile).size === 0) {
    throw new Error(`Expected ${SDK_UI_TEST_BIN} to be generated`)
  }
  const content = readFileSync(targetFile, 'utf8')
  if (!content.startsWith('#!')) writeFileSync(targetFile, `#!/usr/bin/env bun\n${content}`, 'utf8')
  chmodSync(targetFile, 0o755)
}

function buildStylesheet(outDir: string): void {
  const output = join(outDir, 'styles.css')
  const result = spawnSync('bun', [
    join(REPO_ROOT, 'node_modules/.bin/tailwindcss'),
    '-i', join(REPO_ROOT, 'packages/host/src/globals.css'),
    '-o', output,
    '--minify',
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    throw new Error(`Failed to build ${SDK_STYLES_EXPORT}:\n${result.stdout}${result.stderr}`)
  }
  if (!existsSync(output) || statSync(output).size === 0) {
    throw new Error(`Expected ${SDK_STYLES_EXPORT} to be generated`)
  }
  assertSdkStylesheetIdentity(output)
}

/** Refuse to publish CSS that differs from the host/Storybook artifact. */
export function assertSdkStylesheetIdentity(
  candidatePath: string,
  canonicalPath = CANONICAL_SDK_STYLES_PATH,
): void {
  if (!existsSync(canonicalPath)) {
    throw new Error(`Canonical SDK stylesheet is missing at ${canonicalPath}; run bun run build:css`)
  }
  if (!existsSync(candidatePath)) {
    throw new Error(`Compiled SDK stylesheet is missing at ${candidatePath}`)
  }
  if (!readFileSync(candidatePath).equals(readFileSync(canonicalPath))) {
    throw new Error(
      'SDK stylesheet does not match the canonical artifact; run bun run build:css and commit packages/sdk/styles.css',
    )
  }
}

function emitDeclarations(tempDtsDir: string): void {
  const result = spawnSync('bunx', [
    'tsc',
    '-p', 'packages/sdk/tsconfig.json',
    '--noEmit', 'false',
    '--declaration',
    '--emitDeclarationOnly',
    '--declarationMap', 'false',
    '--incremental', 'false',
    '--rootDir', '.',
    '--outDir', tempDtsDir,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    throw new Error(`Declaration emit failed:\n${result.stdout}${result.stderr}`)
  }
}

function collectBareDeclarationDependencies(outDir: string): string[] {
  const packages = new Set<string>()
  for (const file of collectFiles(outDir, (path) => path.endsWith('.d.ts'))) {
    const content = readFileSync(file, 'utf-8')
    for (const match of content.matchAll(IMPORT_SPECIFIER_RE)) {
      const specifier = match[1] ?? match[2] ?? match[3]
      if (!specifier || specifier.startsWith('.') || specifier.startsWith(PUBLIC_SDK_PACKAGE_NAME)) continue
      packages.add(packageName(specifier))
    }
  }
  return [...packages].sort()
}

function buildDependencies(outDir: string, sourceSdkPkg: PackageJson): Record<string, string> {
  const rootPkg = readJson<PackageJson>(ROOT_PACKAGE_PATH)
  const rootDeps = {
    ...(rootPkg.dependencies ?? {}),
    ...(rootPkg.peerDependencies ?? {}),
  }
  const sourcePeers = sourceSdkPkg.peerDependencies ?? {}
  const deps: Record<string, string> = {}
  for (const name of collectBareDeclarationDependencies(outDir)) {
    if (name in sourcePeers) continue
    const version = rootDeps[name]
    if (!version) {
      throw new Error(`No package.json version found for SDK declaration dependency: ${name}`)
    }
    deps[name] = version
  }
  return deps
}

function writePackageJson(outDir: string, version: string): void {
  const sourcePkg = readJson<PackageJson>(SDK_PACKAGE_PATH)
  const exportsMap: Record<string, unknown> = Object.fromEntries(SDK_EXPORTS.map((entry) => [
    entry.exportPath,
    {
      import: entry.importPath,
      types: entry.typesPath,
    },
  ]))
  exportsMap[SDK_STYLES_EXPORT] = SDK_STYLES_EXPORT

  const pkg = {
    name: PUBLIC_SDK_PACKAGE_NAME,
    version,
    description: sourcePkg.description,
    type: 'module',
    sideEffects: [SDK_STYLES_EXPORT],
    main: './index.js',
    types: './index.d.ts',
    exports: exportsMap,
    files: [
      '**/*.js',
      '**/*.d.ts',
      'styles.css',
      'README.md',
    ],
    bin: {
      'bakin-plugin-test-ui': `./${SDK_UI_TEST_BIN}`,
    },
    peerDependencies: sourcePkg.peerDependencies ?? {
      '@tanstack/react-router': '^1.168.23',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
    },
    peerDependenciesMeta: sourcePkg.peerDependenciesMeta,
    dependencies: buildDependencies(outDir, sourcePkg),
    repository: sourcePkg.repository,
    homepage: sourcePkg.homepage,
    bugs: sourcePkg.bugs,
    author: sourcePkg.author,
    license: sourcePkg.license,
    keywords: sourcePkg.keywords,
    publishConfig: { access: 'public' },
  }
  writeJson(join(outDir, 'package.json'), pkg)
}

function copyReadme(outDir: string): void {
  const source = join(SDK_DIR, 'README.md')
  if (!existsSync(source)) return
  const content = readFileSync(source, 'utf-8')
  writeFileSync(join(outDir, 'README.md'), content, 'utf-8')
}

export function findForbiddenPackageImports(files: string[], packageRoot: string): string[] {
  const leaks: string[] = []
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    for (const match of content.matchAll(IMPORT_SPECIFIER_RE)) {
      const specifier = match[1] ?? match[2] ?? match[3]
      if (!specifier) continue
      const isForbiddenBare = FORBIDDEN_BARE_PREFIXES.some((prefix) => specifier === prefix.replace(/\/$/, '') || specifier.startsWith(prefix))
      const isForbiddenPath = specifier.includes('packages/host') || specifier.includes('/src/') || specifier.startsWith('src/') || specifier.startsWith('workspace:')
      const isAbsoluteRepoPath = specifier.startsWith(REPO_ROOT)
      if (isForbiddenBare || isForbiddenPath || isAbsoluteRepoPath) {
        leaks.push(`${toPosix(relative(packageRoot, file))}: ${specifier}`)
      }
    }
  }
  return leaks
}

function assertNoForbiddenImports(outDir: string): void {
  const files = collectFiles(outDir, (path) => path.endsWith('.js') || path.endsWith('.d.ts'))
  const leaks = findForbiddenPackageImports(files, outDir)
  if (leaks.length > 0) {
    throw new Error(`SDK package contains repo-only imports:\n${leaks.join('\n')}`)
  }
}

export async function buildSdkPackage(opts: BuildSdkPackageOptions): Promise<void> {
  if (!opts.version) throw new Error('version is required')
  if (!opts.outDir) throw new Error('outDir is required')

  const outDir = resolve(opts.outDir)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  for (const entry of SDK_EXPORTS) buildJsEntry(entry, outDir)
  buildCli(outDir)
  buildStylesheet(outDir)

  const tempDtsDir = mkdtempSync(join(tmpdir(), 'bakin-sdk-dts-'))
  try {
    emitDeclarations(tempDtsDir)
    copyDeclarationTree(tempDtsDir, outDir)
  } finally {
    rmSync(tempDtsDir, { recursive: true, force: true })
  }

  copyReadme(outDir)
  writePackageJson(outDir, opts.version)
  assertNoForbiddenImports(outDir)
}

function parseArgs(argv: string[]): BuildSdkPackageOptions {
  let version = ''
  let outDir = ''
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--version') {
      version = argv[++i] ?? ''
    } else if (arg === '--out') {
      outDir = argv[++i] ?? ''
    }
  }
  return { version, outDir }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  await buildSdkPackage(opts)
  const count = collectFiles(resolve(opts.outDir), (path) => statSync(path).isFile()).length
  console.log(`Built ${PUBLIC_SDK_PACKAGE_NAME}@${opts.version} package at ${resolve(opts.outDir)} (${count} files)`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
