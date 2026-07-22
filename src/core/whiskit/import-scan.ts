/**
 * Plugin import scanner — enforces the plugin import contract at build time.
 *
 * Every import in a plugin's source must be one of: relative/absolute, a Node
 * builtin, a host-provided external (React / SDK surface — see externals.ts), or
 * a package declared in the plugin's own package.json. Anything else (app
 * internals via `@/`, Bakin internals via `@bakin/*`, the retired `@bakin/sdk`,
 * or an undeclared third-party package) is a violation.
 *
 * Extracted verbatim from user-plugin-builder.ts so the shared build backend
 * (system-bun build + publish path) and the in-process dev build use one scanner
 * and the host-provided set is sourced from the single externals contract.
 * Part of the Whiskit shared build backend (Phase 2).
 */
import { readFileSync, readdirSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { builtinModules } from 'node:module'
import { PLUGIN_CLIENT_EXTERNALS } from './externals'

const HOST_PROVIDED_IMPORTS = new Set<string>(PLUGIN_CLIENT_EXTERNALS)
const BUILTIN_IMPORTS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
])
const SOURCE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/
/** Entries skipped when walking a plugin's runtime source tree (also reused by
 *  source hashing and the builder's mtime/staleness walk). */
export const NON_RUNTIME_DIRS = new Set([
  'dist',
  'node_modules',
  'tests',
  '__tests__',
  'coverage',
  'bakin.ui-test.ts',
])
const OLD_SDK_PACKAGE_NAME = '@bakin' + '/sdk'
const PRIVATE_UI_PACKAGE_NAME = '@bakin' + '/ui'

type SourceLoader = 'ts' | 'tsx' | 'js' | 'jsx'
interface BunImportScanEntry {
  path?: string
}
interface BunImportScanner {
  scanImports(source: string): BunImportScanEntry[]
}
const BunTranspiler = (Bun as unknown as {
  Transpiler: new (options: { loader: SourceLoader }) => BunImportScanner
}).Transpiler

export interface PluginPackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return `${scope}/${name}`
  }
  return specifier.split('/')[0]!
}

function isRelativeOrAbsoluteSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:')
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(current, { withFileTypes: true }) as Dirent[]
    } catch {
      return
    }
    for (const entry of entries) {
      const name = String(entry.name)
      if (NON_RUNTIME_DIRS.has(name) || name.startsWith('.')) continue
      const full = join(current, name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && SOURCE_EXT_RE.test(name)) out.push(full)
    }
  }
  walk(dir)
  return out
}

function sourceLoader(file: string): SourceLoader {
  if (file.endsWith('.tsx')) return 'tsx'
  if (file.endsWith('.ts')) return 'ts'
  if (file.endsWith('.jsx')) return 'jsx'
  return 'js'
}

function collectImportSpecifiers(file: string, source: string): string[] {
  try {
    const transpiler = new BunTranspiler({ loader: sourceLoader(file) })
    return transpiler
      .scanImports(source)
      .map((entry) => entry.path)
      .filter((specifier): specifier is string => typeof specifier === 'string' && specifier.length > 0)
  } catch (err) {
    throw new Error(`Failed to parse imports in ${file}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Scan every source file under `pluginDir` and throw if any import violates the
 * plugin import contract. `pkg` supplies the plugin's declared dependencies.
 */
export function validatePluginImports(pluginDir: string, pkg: PluginPackageJson): void {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ])
  const violations: string[] = []

  for (const file of collectSourceFiles(pluginDir)) {
    const source = readFileSync(file, 'utf-8')
    for (const specifier of collectImportSpecifiers(file, source)) {
      if (!specifier || isRelativeOrAbsoluteSpecifier(specifier) || BUILTIN_IMPORTS.has(specifier)) continue

      if (specifier === OLD_SDK_PACKAGE_NAME || specifier.startsWith(`${OLD_SDK_PACKAGE_NAME}/`)) {
        violations.push(`${file}: ${specifier} is no longer supported; use @makinbakin/sdk`)
        continue
      }
      if (specifier === PRIVATE_UI_PACKAGE_NAME || specifier.startsWith(`${PRIVATE_UI_PACKAGE_NAME}/`)) {
        violations.push(`${file}: ${specifier} is private; use @makinbakin/sdk/*`)
        continue
      }
      if (specifier === '@bakin/core' || specifier.startsWith('@bakin/core/') || specifier.startsWith('@bakin/')) {
        violations.push(`${file}: ${specifier} imports Bakin internals; use @makinbakin/sdk or a declared plugin API`)
        continue
      }
      if (specifier.startsWith('@/')) {
        violations.push(`${file}: ${specifier} imports app internals; use @makinbakin/sdk or a declared plugin API`)
        continue
      }
      if (HOST_PROVIDED_IMPORTS.has(specifier)) continue

      const pkgName = packageName(specifier)
      if (!declared.has(pkgName)) {
        violations.push(`${file}: ${specifier} is not declared in package.json dependencies`)
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Plugin dependency validation failed:\n${violations.join('\n')}`)
  }
}
