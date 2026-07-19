#!/usr/bin/env bun

import {
  existsSync,
  realpathSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import ts from 'typescript'

import { storyGlobsForAudience, type StorybookAudience } from '../../.storybook/audiences.ts'
import { STORY_FIXTURE_MANIFEST } from '../../storybook/fixtures/index.ts'

export { storyGlobsForAudience }

const REPO_ROOT = resolve(import.meta.dir, '../..')
const PUBLIC_ROOT = 'storybook/public'
const FIXTURE_ROOT = 'storybook/fixtures'
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'] as const
const PUBLIC_VISUAL_SDK_ENTRYPOINTS = new Set([
  '@makinbakin/sdk/ui',
  '@makinbakin/sdk/layout',
  '@makinbakin/sdk/patterns',
  '@makinbakin/sdk/charts',
  '@makinbakin/sdk/conversation',
])

export interface PublicStoryViolation {
  path: string
  line?: number
  message: string
}

function portablePath(root: string, path: string): string {
  return relative(root, path).split('\\').join('/')
}

function walkSourceFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && SOURCE_EXTENSIONS.includes(extname(path) as (typeof SOURCE_EXTENSIONS)[number])) files.push(path)
    }
  }
  visit(root)
  return files
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') || path.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

interface ModuleReference {
  specifier: string | null
  line: number
}

function moduleReferences(file: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = []
  const add = (literal: ts.Expression): void => {
    references.push({
      specifier: ts.isStringLiteralLike(literal) ? literal.text : null,
      line: file.getLineAndCharacterOfPosition(literal.getStart(file)).line + 1,
    })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier)
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) add(node.moduleSpecifier)
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (node.moduleReference.expression) add(node.moduleReference.expression)
    }
    else if (
      ts.isCallExpression(node)
      && node.arguments.length > 0
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      )
    ) add(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(file)
  return references
}

function resolveLocalModule(importer: string, specifier: string): string | null {
  const base = resolve(dirname(importer), specifier)
  const candidates = extname(base)
    ? [base]
    : [base, ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`), ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`))]
  const candidate = candidates.find((entry) => existsSync(entry) && statSync(entry).isFile())
  return candidate ? realpathSync(candidate) : null
}

function isWithin(path: string, directory: string): boolean {
  const child = relative(directory, path)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function hasStaticPublicTag(file: ts.SourceFile): boolean {
  const declarations = new Map<string, ts.Expression>()
  let defaultExport: ts.Expression | undefined
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer)
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      defaultExport = statement.expression
    }
  }

  const unwrap = (expression: ts.Expression): ts.Expression => {
    if (
      ts.isSatisfiesExpression(expression)
      || ts.isAsExpression(expression)
      || ts.isTypeAssertionExpression(expression)
      || ts.isParenthesizedExpression(expression)
    ) return unwrap(expression.expression)
    if (ts.isIdentifier(expression) && declarations.has(expression.text)) return unwrap(declarations.get(expression.text)!)
    return expression
  }

  if (!defaultExport) return false
  const meta = unwrap(defaultExport)
  if (!ts.isObjectLiteralExpression(meta)) return false
  const tags = meta.properties.find((property): property is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(property)) return false
    return (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) && property.name.text === 'tags'
  })
  if (!tags) return false
  const value = unwrap(tags.initializer)
  return ts.isArrayLiteralExpression(value)
    && value.elements.some((element) => ts.isStringLiteralLike(element) && element.text === 'public')
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.find((property): property is ts.PropertyAssignment => (
    ts.isPropertyAssignment(property)
    && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
    && property.name.text === name
  ))
}

function unwrapStaticExpression(
  expression: ts.Expression,
  declarations: ReadonlyMap<string, ts.Expression>,
): ts.Expression {
  if (
    ts.isSatisfiesExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isParenthesizedExpression(expression)
  ) return unwrapStaticExpression(expression.expression, declarations)
  if (ts.isIdentifier(expression) && declarations.has(expression.text)) {
    return unwrapStaticExpression(declarations.get(expression.text)!, declarations)
  }
  return expression
}

function staticObject(
  parent: ts.ObjectLiteralExpression,
  name: string,
  declarations: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression | undefined {
  const property = objectProperty(parent, name)
  if (!property) return undefined
  const value = unwrapStaticExpression(property.initializer, declarations)
  return ts.isObjectLiteralExpression(value) ? value : undefined
}

function isStaticBoolean(
  parent: ts.ObjectLiteralExpression,
  name: string,
  declarations: ReadonlyMap<string, ts.Expression>,
  expected: boolean,
): boolean {
  const property = objectProperty(parent, name)
  const expectedKind = expected ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword
  return Boolean(property && unwrapStaticExpression(property.initializer, declarations).kind === expectedKind)
}

function isStaticTrue(
  parent: ts.ObjectLiteralExpression,
  name: string,
  declarations: ReadonlyMap<string, ts.Expression>,
): boolean {
  return isStaticBoolean(parent, name, declarations, true)
}

function staticString(
  parent: ts.ObjectLiteralExpression,
  name: string,
  declarations: ReadonlyMap<string, ts.Expression>,
): string | undefined {
  const property = objectProperty(parent, name)
  if (!property) return undefined
  const value = unwrapStaticExpression(property.initializer, declarations)
  return ts.isStringLiteralLike(value) ? value.text : undefined
}

function disablesA11yRule(
  a11y: ts.ObjectLiteralExpression,
  declarations: ReadonlyMap<string, ts.Expression>,
): boolean {
  const config = staticObject(a11y, 'config', declarations)
  const rulesProperty = config && objectProperty(config, 'rules')
  if (!rulesProperty) return false
  const rules = unwrapStaticExpression(rulesProperty.initializer, declarations)
  if (!ts.isArrayLiteralExpression(rules)) return false
  return rules.elements.some((element) => {
    const rule = unwrapStaticExpression(element as ts.Expression, declarations)
    return ts.isObjectLiteralExpression(rule) && isStaticBoolean(rule, 'enabled', declarations, false)
  })
}

function hasA11ySuppression(
  story: ts.ObjectLiteralExpression,
  declarations: ReadonlyMap<string, ts.Expression>,
): boolean {
  const parameters = staticObject(story, 'parameters', declarations)
  const a11y = parameters && staticObject(parameters, 'a11y', declarations)
  const globals = staticObject(story, 'globals', declarations)
  const globalA11y = globals && staticObject(globals, 'a11y', declarations)
  if (globalA11y && isStaticTrue(globalA11y, 'manual', declarations)) return true
  if (!a11y) return false

  const testMode = staticString(a11y, 'test', declarations)
  const context = staticObject(a11y, 'context', declarations)
  return testMode === 'todo'
    || testMode === 'off'
    || isStaticTrue(a11y, 'disable', declarations)
    || Boolean(context && objectProperty(context, 'exclude'))
    || disablesA11yRule(a11y, declarations)
}

function hasA11ySuppressionEvidence(
  story: ts.ObjectLiteralExpression,
  declarations: ReadonlyMap<string, ts.Expression>,
): boolean {
  const parameters = staticObject(story, 'parameters', declarations)
  const metadata = parameters && staticObject(parameters, 'bakinA11ySuppression', declarations)
  return Boolean(
    metadata
    && staticString(metadata, 'reason', declarations)?.trim()
    && staticString(metadata, 'evidence', declarations)?.trim(),
  )
}

function collectPublicStoryA11yViolations(rootDir = REPO_ROOT): PublicStoryViolation[] {
  const canonicalRoot = realpathSync(rootDir)
  const publicRoot = realpathSync(join(canonicalRoot, PUBLIC_ROOT))
  const stories = walkSourceFiles(publicRoot).filter((path) => /\.stories\.(?:ts|tsx)$/.test(path))
  const violations: PublicStoryViolation[] = []

  for (const storyPath of stories) {
    const file = sourceFile(storyPath)
    const declarations = new Map<string, ts.Expression>()
    const storyObjects: Array<{ expression: ts.Expression, line: number }> = []

    for (const statement of file.statements) {
      if (ts.isVariableStatement(statement)) {
        const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
          declarations.set(declaration.name.text, declaration.initializer)
          if (exported) {
            storyObjects.push({
              expression: declaration.initializer,
              line: file.getLineAndCharacterOfPosition(declaration.getStart(file)).line + 1,
            })
          }
        }
      } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        storyObjects.push({
          expression: statement.expression,
          line: file.getLineAndCharacterOfPosition(statement.getStart(file)).line + 1,
        })
      }
    }

    for (const candidate of storyObjects) {
      const expression = unwrapStaticExpression(candidate.expression, declarations)
      if (!ts.isObjectLiteralExpression(expression) || !hasA11ySuppression(expression, declarations)) continue
      if (hasA11ySuppressionEvidence(expression, declarations)) continue
      violations.push({
        path: portablePath(canonicalRoot, storyPath),
        line: candidate.line,
        message: 'accessibility suppression requires non-empty parameters.bakinA11ySuppression.reason and .evidence',
      })
    }
  }
  return violations
}

export function validatePublicStoryA11yContract(rootDir = REPO_ROOT): string[] {
  return collectPublicStoryA11yViolations(rootDir).map((violation) => (
    `${violation.path}${violation.line ? `:${violation.line}` : ''} ${violation.message}`
  ))
}

function bannedBareImport(specifier: string): string | null {
  if (specifier === '@makinbakin/sdk/internal' || specifier.startsWith('@makinbakin/sdk/internal/')) {
    return `public catalog cannot import ${specifier}; use a supported @makinbakin/sdk/* entrypoint`
  }
  if (
    (specifier === '@makinbakin/sdk' || specifier.startsWith('@makinbakin/sdk/'))
    && !PUBLIC_VISUAL_SDK_ENTRYPOINTS.has(specifier)
  ) {
    return `public catalog cannot import ${specifier}; use a focused visual SDK entrypoint`
  }
  if (
    specifier.startsWith('@/')
    || specifier === '@bakin/core'
    || specifier.startsWith('@bakin/')
    || /^(?:packages|plugins|src)(?:\/|$)/.test(specifier)
  ) {
    return `public catalog cannot import ${specifier}; use @makinbakin/sdk/*`
  }
  return null
}

export function collectPublicStoryViolations(rootDir = REPO_ROOT): PublicStoryViolation[] {
  const canonicalRoot = realpathSync(rootDir)
  const publicRoot = realpathSync(join(canonicalRoot, PUBLIC_ROOT))
  const fixtureRoot = realpathSync(join(canonicalRoot, FIXTURE_ROOT))
  const stories = walkSourceFiles(publicRoot).filter((path) => /\.stories\.(?:ts|tsx)$/.test(path))
  const queue = [...stories]
  const visited = new Set<string>()
  const violations: PublicStoryViolation[] = []

  violations.push(...collectPublicStoryA11yViolations(canonicalRoot))

  for (const story of stories) {
    const parsed = sourceFile(story)
    if (!hasStaticPublicTag(parsed)) {
      violations.push({
        path: portablePath(canonicalRoot, story),
        message: 'public story must declare the static tag public',
      })
    }
  }

  while (queue.length > 0) {
    const path = queue.shift()!
    if (visited.has(path)) continue
    visited.add(path)
    const parsed = sourceFile(path)

    for (const reference of moduleReferences(parsed)) {
      if (reference.specifier === null) {
        violations.push({
          path: portablePath(canonicalRoot, path),
          line: reference.line,
          message: 'public catalog cannot use a computed import or require specifier',
        })
        continue
      }
      const banned = bannedBareImport(reference.specifier)
      if (banned) {
        violations.push({ path: portablePath(canonicalRoot, path), line: reference.line, message: banned })
        continue
      }
      if (!reference.specifier.startsWith('.')) continue
      const resolved = resolveLocalModule(path, reference.specifier)
      if (!resolved) continue
      if (!isWithin(resolved, publicRoot) && !isWithin(resolved, fixtureRoot)) {
        violations.push({
          path: portablePath(canonicalRoot, path),
          line: reference.line,
          message: `public catalog cannot import ${reference.specifier} (resolves outside ${PUBLIC_ROOT} and ${FIXTURE_ROOT})`,
        })
        continue
      }
      queue.push(resolved)
    }
  }

  return violations.sort((a, b) => {
    const pathOrder = a.path.localeCompare(b.path)
    if (pathOrder !== 0) return pathOrder
    return (a.line ?? 0) - (b.line ?? 0) || a.message.localeCompare(b.message)
  })
}

export function validatePublicStoryBoundary(rootDir = REPO_ROOT): string[] {
  return collectPublicStoryViolations(rootDir).map((violation) => (
    `${violation.path}${violation.line ? `:${violation.line}` : ''} ${violation.message}`
  ))
}

export function assertPublicStoryBoundary(rootDir = REPO_ROOT): void {
  const violations = validatePublicStoryBoundary(rootDir)
  if (violations.length > 0) {
    throw new Error(`Public Storybook boundary failed:\n${violations.map((entry) => `- ${entry}`).join('\n')}`)
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  )
}

export function canonicalStoryIndex(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`
}

export function assertSafeStorybookOutput(outputDir: string): void {
  const output = resolve(outputDir)
  const forbidden = new Set([parse(output).root, resolve(REPO_ROOT), resolve(homedir())])
  if (forbidden.has(output)) {
    throw new Error(`Refusing unsafe Storybook output directory: ${output}`)
  }
}

async function run(command: string[], env?: Record<string, string>): Promise<void> {
  const process = Bun.spawn(command, {
    cwd: REPO_ROOT,
    env: { ...globalThis.process.env, ...env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`${command.join(' ')} exited with code ${exitCode}`)
}

async function buildCss(): Promise<void> {
  await run(['bun', 'run', 'build:css'])
}

function writeFixtureManifest(outputDir: string): void {
  writeFileSync(
    join(outputDir, 'bakin-fixtures.json'),
    `${JSON.stringify(sortJson(STORY_FIXTURE_MANIFEST), null, 2)}\n`,
  )
}

export async function buildStorybook(options: {
  audience: StorybookAudience
  outputDir: string
  buildCss?: boolean
}): Promise<void> {
  assertSafeStorybookOutput(options.outputDir)
  if (options.audience === 'public') assertPublicStoryBoundary(REPO_ROOT)
  if (options.buildCss !== false) await buildCss()
  await run(
    [join(REPO_ROOT, 'node_modules/.bin/storybook'), 'build', '--disable-telemetry', '--output-dir', options.outputDir],
    { BAKIN_STORYBOOK_AUDIENCE: options.audience },
  )
  writeFixtureManifest(options.outputDir)
}

export function compareDeterministicBuilds(leftDir: string, rightDir: string): void {
  for (const file of ['index.json', 'bakin-fixtures.json']) {
    const left = canonicalStoryIndex(JSON.parse(readFileSync(join(leftDir, file), 'utf-8')))
    const right = canonicalStoryIndex(JSON.parse(readFileSync(join(rightDir, file), 'utf-8')))
    if (left !== right) throw new Error(`Consecutive public Storybook builds produced different ${file}`)
  }
}

async function verifyDeterminism(audience: StorybookAudience): Promise<void> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'bakin-storybook-determinism-'))
  try {
    await buildCss()
    const left = join(tempRoot, 'left')
    const right = join(tempRoot, 'right')
    await buildStorybook({ audience, outputDir: left, buildCss: false })
    await buildStorybook({ audience, outputDir: right, buildCss: false })
    compareDeterministicBuilds(left, right)
    console.log('Storybook story index and fixture manifest are deterministic across consecutive builds.')
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const audienceArg = process.argv[2]
  if (audienceArg !== 'public' && audienceArg !== 'maintainer') {
    throw new Error('Storybook audience must be public or maintainer')
  }
  const audience: StorybookAudience = audienceArg
  if (process.argv.includes('--verify-determinism')) {
    await verifyDeterminism(audience)
    return
  }
  const defaultOutput = audience === 'public' ? 'storybook-static-public' : 'storybook-static'
  const outputDir = resolve(REPO_ROOT, argumentValue('--output-dir') ?? defaultOutput)
  await buildStorybook({ audience, outputDir })
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
