import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const PRIVATE_UI_PACKAGE = '@bakin/ui'
const PRIVATE_UI_SOURCE = 'packages/ui/src'
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', 'vendor', '.git', '.astro'])
const REPOSITORY_SCAN_ROOTS = [
  'packages',
  'plugins',
  'src',
  'storybook',
  '.storybook',
  'examples',
  'docs/snippets',
  'cli',
  'scripts',
]
const ALLOWED_OWNER_ROOTS = [
  PRIVATE_UI_SOURCE,
  'packages/host/src',
  'packages/sdk/src',
  'storybook/internal',
]

interface ModuleReference {
  line: number
  specifier: string
}

interface UiPackageManifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function portablePath(root: string, path: string): string {
  return relative(root, path).split('\\').join('/')
}

function isWithin(parent: string, child: string): boolean {
  const suffix = relative(parent, child)
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix))
}

function sourceFilesUnder(root: string): string[] {
  if (!existsSync(root)) return []
  const output: string[] = []
  const walk = (directory: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true }) as Dirent[]
    } catch {
      return
    }
    for (const entry of entries) {
      const name = String(entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(name)) walk(join(directory, name))
      } else if (entry.isFile() && SOURCE_EXTENSION.test(name)) {
        output.push(join(directory, name))
      }
    }
  }
  walk(root)
  return output.sort()
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function moduleReferences(path: string): ModuleReference[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  const references = new Map<string, ModuleReference>()
  const add = (node: ts.Node, literal: ts.StringLiteralLike): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    references.set(`${line}:${literal.text}`, { line, specifier: literal.text })
  }
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) add(node, node.moduleSpecifier)
    if (
      ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      && node.arguments[0]
      && ts.isStringLiteralLike(node.arguments[0])
    ) add(node, node.arguments[0])
    if (
      ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteralLike(node.argument.literal)
    ) add(node, node.argument.literal)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...references.values()].sort((left, right) => left.line - right.line || left.specifier.localeCompare(right.specifier))
}

function isPrivateUiSpecifier(specifier: string): boolean {
  return specifier === PRIVATE_UI_PACKAGE || specifier.startsWith(`${PRIVATE_UI_PACKAGE}/`)
}

function resolvesInsidePrivateUi(importer: string, specifier: string, privateRoot: string): boolean {
  if (!specifier.startsWith('.')) return false
  return isWithin(privateRoot, resolve(dirname(importer), specifier))
}

function isAllowedOwner(root: string, importer: string): boolean {
  return ALLOWED_OWNER_ROOTS.some((owner) => isWithin(join(root, owner), importer))
}

/** Find imports that bypass the public SDK and reach the private UI package. */
export function findPrivateUiImportViolations(root: string): string[] {
  const privateRoot = join(root, PRIVATE_UI_SOURCE)
  const files = REPOSITORY_SCAN_ROOTS.flatMap((scanRoot) => sourceFilesUnder(join(root, scanRoot)))
  const violations: string[] = []

  for (const file of files) {
    if (isAllowedOwner(root, file)) continue
    for (const reference of moduleReferences(file)) {
      if (
        !isPrivateUiSpecifier(reference.specifier)
        && !resolvesInsidePrivateUi(file, reference.specifier, privateRoot)
      ) continue
      violations.push(
        `${portablePath(root, file)}:${reference.line} cannot import ${reference.specifier}; `
        + 'private UI is limited to host, SDK, and internal Storybook',
      )
    }
  }
  return violations.sort()
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]!
}

/** Find private-package imports that violate its presentation-only dependency direction. */
export function findPrivateUiDependencyViolations(root: string): string[] {
  const packageRoot = join(root, 'packages/ui')
  const sourceRoot = join(packageRoot, 'src')
  const manifestPath = join(packageRoot, 'package.json')
  if (!existsSync(manifestPath)) return ['missing packages/ui/package.json']
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as UiPackageManifest
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  const violations: string[] = []

  for (const file of sourceFilesUnder(sourceRoot)) {
    for (const reference of moduleReferences(file)) {
      const prefix = `${portablePath(root, file)}:${reference.line}`
      if (/\.(?:css|scss|sass|less)(?:\?|$)/.test(reference.specifier)) {
        violations.push(`${prefix} runtime modules must not import CSS: ${reference.specifier}`)
        continue
      }
      if (reference.specifier.startsWith('.')) {
        if (!isWithin(sourceRoot, resolve(dirname(file), reference.specifier))) {
          violations.push(`${prefix} relative import escapes packages/ui/src: ${reference.specifier}`)
        }
        continue
      }
      const dependency = packageName(reference.specifier)
      if (!declared.has(dependency)) {
        violations.push(`${prefix} imports undeclared runtime dependency ${dependency}`)
      }
    }
  }
  return violations.sort()
}
