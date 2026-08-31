#!/usr/bin/env bun
/**
 * Story-compliance gate + ratchet (storybook-refit T1.3).
 *
 * Every public story entry must carry:
 *  - canonical-usage:   its FIRST exported story is `CanonicalUsage`, whose
 *                       JSX renders only `@makinbakin/sdk/*` imports or DOM
 *                       intrinsics — minimal, copy-pasteable, zero scaffolding
 *                       (`Recipes/` entries are exempt from this one rule);
 *  - play-assertion:    at least one story in the file has a play function
 *                       that actually asserts (references `expect`);
 *  - interactive-controls: the `CanonicalUsage` story is controllable — it or
 *                       its meta declares `argTypes` so the Storybook UI can
 *                       exercise the component's real props (`Recipes/` and
 *                       `Tokens/` entries are exempt alongside canonical-usage);
 *  - coverage-axes:     meta declares non-empty `parameters.bakinCoverage`;
 *  - docs-description:  meta declares `parameters.docs.description.component`;
 *  - visual-baseline:   some spec under tests/ui/visual references the entry
 *                       (`id=<title-slug>--…`).
 *
 * `design-system/story-compliance.json` is the monotonic ratchet baseline
 * (same contract as migrations.json): recorded gaps pass, new gaps fail,
 * reductions pass and are committed via `generate`. A MISSING baseline file
 * means absolute mode — every gap fails. That is the planned end state: the
 * file is deleted when the last entry complies (refit P5).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const PUBLIC_ROOT = 'storybook/public'
const VISUAL_ROOT = 'tests/ui/visual'
const BASELINE_PATH = 'design-system/story-compliance.json'
const SDK_PREFIX = '@makinbakin/sdk'

export type StoryRequirement =
  | 'canonical-usage'
  | 'interactive-controls'
  | 'play-assertion'
  | 'coverage-axes'
  | 'docs-description'
  | 'visual-baseline'

export interface StoryComplianceEntry {
  path: string
  title: string
  missing: StoryRequirement[]
}

export interface StoryComplianceBaseline {
  schemaVersion: 1
  generatedBy: string
  entries: StoryComplianceEntry[]
}

function walkStoryFiles(root: string): string[] {
  const publicRoot = join(root, PUBLIC_ROOT)
  if (!existsSync(publicRoot)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.stories\.(?:ts|tsx)$/.test(entry.name)) files.push(path)
    }
  }
  visit(publicRoot)
  return files
}

function readVisualSources(root: string): string {
  const visualRoot = join(root, VISUAL_ROOT)
  if (!existsSync(visualRoot)) return ''
  return readdirSync(visualRoot)
    .filter((name) => ['.ts', '.tsx', '.mts'].includes(extname(name)))
    .map((name) => readFileSync(join(visualRoot, name), 'utf8'))
    .join('\n')
}

/** Storybook's title → id sanitation (matches @storybook/csf sanitize). */
export function storyTitleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isSatisfiesExpression(current) || ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property)) {
      const key = property.name
      const keyText = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined
      if (keyText === name) return unwrap(property.initializer)
    }
  }
  return undefined
}

interface ParsedStoryFile {
  imports: Map<string, string>
  meta: ts.ObjectLiteralExpression | null
  stories: Array<{ name: string; initializer: ts.ObjectLiteralExpression }>
}

function parseStoryFile(path: string): ParsedStoryFile {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const imports = new Map<string, string>()
  const variables = new Map<string, ts.Expression>()
  let meta: ts.ObjectLiteralExpression | null = null
  const stories: ParsedStoryFile['stories'] = []

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text
      const clause = statement.importClause
      if (!clause) continue
      if (clause.name) imports.set(clause.name.text, specifier)
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const binding of clause.namedBindings.elements) imports.set(binding.name.text, specifier)
      }
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        imports.set(clause.namedBindings.name.text, specifier)
      }
      continue
    }
    if (ts.isVariableStatement(statement)) {
      const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        const value = unwrap(declaration.initializer)
        variables.set(declaration.name.text, value)
        if (exported && ts.isObjectLiteralExpression(value)) {
          stories.push({ name: declaration.name.text, initializer: value })
        }
      }
      continue
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const value = unwrap(statement.expression)
      if (ts.isObjectLiteralExpression(value)) meta = value
      else if (ts.isIdentifier(value)) {
        const resolved = variables.get(value.text)
        if (resolved && ts.isObjectLiteralExpression(resolved)) meta = resolved
      }
    }
  }

  return { imports, meta, stories }
}

/** Collect capitalized JSX element roots used outside the story's play(). */
function jsxComponentRoots(story: ts.ObjectLiteralExpression): string[] {
  const roots = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const key = node.name
      const keyText = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined
      if (keyText === 'play') return
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      let tag: ts.Node = node.tagName
      while (ts.isPropertyAccessExpression(tag)) tag = tag.expression
      if (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text)) roots.add(tag.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(story)
  return [...roots]
}

function subtreeReferencesExpect(node: ts.Node): boolean {
  if (ts.isIdentifier(node) && node.text === 'expect') return true
  let found = false
  ts.forEachChild(node, (child) => {
    if (!found && subtreeReferencesExpect(child)) found = true
  })
  return found
}

function storyHasPlayAssertion(story: ts.ObjectLiteralExpression): boolean {
  const play = objectProperty(story, 'play')
  return play !== undefined && subtreeReferencesExpect(play)
}

function analyzeStoryFile(root: string, path: string, visualSources: string): StoryComplianceEntry {
  const { imports, meta, stories } = parseStoryFile(path)
  const missing = new Set<StoryRequirement>()

  const titleExpression = meta ? objectProperty(meta, 'title') : undefined
  const title = titleExpression && ts.isStringLiteral(titleExpression) ? titleExpression.text : ''
  // Recipes demonstrate assembly and Tokens document the raw material — neither
  // has a single component whose minimal usage a CanonicalUsage story could
  // show. Every other requirement still applies to both.
  const recipes = title.startsWith('Recipes/') || title.startsWith('Tokens/')

  // canonical-usage
  if (!recipes) {
    const first = stories[0]
    if (!first || first.name !== 'CanonicalUsage') {
      missing.add('canonical-usage')
    } else {
      const componentRoots = jsxComponentRoots(first.initializer)
      const sdkImported = (name: string): boolean => (imports.get(name) ?? '').startsWith(SDK_PREFIX)
      if (componentRoots.length > 0) {
        if (!componentRoots.every(sdkImported)) missing.add('canonical-usage')
      } else {
        // args-only story: the rendered component comes from meta/story `component`.
        const component = objectProperty(first.initializer, 'component')
          ?? (meta ? objectProperty(meta, 'component') : undefined)
        if (!component || !ts.isIdentifier(component) || !sdkImported(component.text)) {
          missing.add('canonical-usage')
        }
      }
      // interactive-controls: the canonical story must be exercisable from
      // the Storybook UI — argTypes on the story itself or on the meta.
      const argTypes = objectProperty(first.initializer, 'argTypes')
        ?? (meta ? objectProperty(meta, 'argTypes') : undefined)
      if (!argTypes) missing.add('interactive-controls')
    }
  }

  if (!stories.some((story) => storyHasPlayAssertion(story.initializer))) missing.add('play-assertion')

  const parameters = meta ? objectProperty(meta, 'parameters') : undefined
  const coverage = parameters && ts.isObjectLiteralExpression(parameters)
    ? objectProperty(parameters, 'bakinCoverage')
    : undefined
  if (!coverage || !ts.isArrayLiteralExpression(coverage) || coverage.elements.length === 0) {
    missing.add('coverage-axes')
  }

  const docs = parameters && ts.isObjectLiteralExpression(parameters) ? objectProperty(parameters, 'docs') : undefined
  const description = docs && ts.isObjectLiteralExpression(docs) ? objectProperty(docs, 'description') : undefined
  const component = description && ts.isObjectLiteralExpression(description)
    ? objectProperty(description, 'component')
    : undefined
  if (!component || !ts.isStringLiteral(component) || component.text.trim().length === 0) {
    missing.add('docs-description')
  }

  if (title === '' || !visualSources.includes(`id=${storyTitleSlug(title)}--`)) missing.add('visual-baseline')

  return {
    path: relative(root, path).split('\\').join('/'),
    title,
    missing: [...missing].sort(),
  }
}

export function collectStoryCompliance(rootDir = REPO_ROOT): StoryComplianceEntry[] {
  const visualSources = readVisualSources(rootDir)
  return walkStoryFiles(rootDir).map((path) => analyzeStoryFile(rootDir, path, visualSources))
}

function readBaseline(rootDir: string): StoryComplianceBaseline | null {
  const path = join(rootDir, BASELINE_PATH)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as StoryComplianceBaseline
}

export function checkStoryCompliance(rootDir = REPO_ROOT): string[] {
  const baseline = readBaseline(rootDir)
  const allowed = new Map<string, Set<string>>()
  for (const entry of baseline?.entries ?? []) allowed.set(entry.path, new Set(entry.missing))

  const errors: string[] = []
  for (const entry of collectStoryCompliance(rootDir)) {
    if (entry.missing.length === 0) continue
    const grandfathered = allowed.get(entry.path) ?? new Set<string>()
    const fresh = entry.missing.filter((requirement) => !grandfathered.has(requirement))
    for (const requirement of fresh) {
      errors.push(`${entry.path} (${entry.title || 'untitled'}): missing ${requirement}${baseline ? '' : ' [absolute mode: no baseline file]'}`)
    }
  }
  return errors.sort()
}

export function generateStoryCompliance(rootDir = REPO_ROOT): StoryComplianceBaseline {
  const entries = collectStoryCompliance(rootDir)
    .filter((entry) => entry.missing.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path))
  const baseline: StoryComplianceBaseline = {
    schemaVersion: 1,
    generatedBy: 'bun run ui:story-compliance:generate',
    entries,
  }
  writeFileSync(join(rootDir, BASELINE_PATH), `${JSON.stringify(baseline, null, 2)}\n`)
  return baseline
}

if (import.meta.main) {
  const mode = process.argv[2]
  if (mode === 'generate') {
    const baseline = generateStoryCompliance()
    const gaps = baseline.entries.reduce((total, entry) => total + entry.missing.length, 0)
    console.log(`Generated ${BASELINE_PATH}: ${baseline.entries.length} noncompliant entries, ${gaps} recorded gaps`)
  } else if (mode === 'check') {
    const errors = checkStoryCompliance()
    if (errors.length > 0) {
      console.error(`Story compliance ratchet failed:\n${errors.map((error) => `- ${error}`).join('\n')}`)
      process.exit(1)
    }
    const baseline = readBaseline(REPO_ROOT)
    const remaining = baseline?.entries.length ?? 0
    console.log(`Story compliance ratchet valid: ${remaining} grandfathered entries remain${baseline ? '' : ' (absolute mode)'}`)
  } else {
    console.error('Usage: bun run scripts/ui/story-compliance.ts generate|check')
    process.exit(1)
  }
}
