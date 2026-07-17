#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import Ajv from 'ajv'
import ts from 'typescript'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const CENSUS_PATH = join(REPO_ROOT, 'design-system/census.json')
const SCHEMA_PATH = join(REPO_ROOT, 'design-system/census.schema.json')
const SDK_COMPONENT_ENTRYPOINT = '@makinbakin/sdk/components'
const SDK_COMPONENT_BARREL = 'packages/sdk/src/components/index.ts'

export type CensusKind = 'host-route' | 'plugin-slot' | 'shared-component' | 'sdk-ui-export'
export type CensusClassification =
  | 'visual-surface'
  | 'embedded-surface'
  | 'non-visual-alias'
  | 'shared-ui'
  | 'public-contract'

export interface CensusEvidence {
  type: 'route-definition' | 'manifest-slot' | 'client-registration' | 'source-export' | 'public-export'
  path: string
  detail: string
}

export interface CensusEntry {
  id: string
  kind: CensusKind
  owner: {
    repository: 'bakin'
    area: 'host' | 'sdk' | 'plugin'
    pluginId?: string
  }
  identity: {
    route?: string
    slot?: string
    component?: string
    symbol?: string
    entrypoint?: string
  }
  sourcePath: string
  symbols: string[]
  exportStatus: 'public' | 'private' | 'not-applicable'
  classification: CensusClassification
  evidence: CensusEvidence[]
}

export interface CensusDocument {
  schemaVersion: 1
  generatedBy: string
  scope: {
    repositories: ['bakin']
    includes: string[]
  }
  summary: {
    total: number
    byKind: Record<CensusKind, number>
    nonVisualAliases: number
  }
  entries: CensusEntry[]
}

interface PublicExport {
  name: string
  importedName: string
  kind: 'type' | 'value'
  moduleSpecifier: string
  sourcePath: string
}

interface ClientSlotRegistration {
  slot: string
  symbol: string
  sourcePath: string
}

function walkFiles(root: string, include: (path: string) => boolean): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && include(path)) files.push(path)
    }
  }
  visit(root)
  return files
}

function portablePath(root: string, path: string): string {
  return relative(root, path).split('\\').join('/')
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(ts.getModifiers(node as ts.HasModifiers)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : bindingNames(element.name))
}

function exportedValueSymbols(path: string): string[] {
  const symbols = new Set<string>()
  for (const statement of sourceFile(path).statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      if (statement.isTypeOnly) continue
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) symbols.add(element.name.text)
      }
      continue
    }
    if (!hasExportModifier(statement)) continue
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
      symbols.add(statement.name.text)
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) symbols.add(name)
      }
    }
  }
  return [...symbols].sort()
}

function resolveModuleSource(root: string, moduleSpecifier: string): string | null {
  let base: string
  if (moduleSpecifier.startsWith('@/')) {
    base = join(root, 'src', moduleSpecifier.slice(2))
  } else if (moduleSpecifier.startsWith('./')) {
    base = join(root, dirname(SDK_COMPONENT_BARREL), moduleSpecifier)
  } else {
    const pluginMatch = moduleSpecifier.match(/^@bakin\/([^/]+)\/(.+)$/)
    if (!pluginMatch) return null
    base = join(root, 'plugins', pluginMatch[1], pluginMatch[2])
  }

  const candidates = extname(base)
    ? [base]
    : [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function collectPublicExports(root: string): PublicExport[] {
  const barrelPath = join(root, SDK_COMPONENT_BARREL)
  if (!existsSync(barrelPath)) return []
  const exports: PublicExport[] = []
  for (const statement of sourceFile(barrelPath).statements) {
    if (!ts.isExportDeclaration(statement)) {
      if (hasExportModifier(statement)) {
        throw new Error(`Unsupported public SDK export syntax in ${SDK_COMPONENT_BARREL}: use a named re-export`)
      }
      continue
    }
    if (
      !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.exportClause
      || !ts.isNamedExports(statement.exportClause)
    ) {
      throw new Error(`Unsupported public SDK export syntax in ${SDK_COMPONENT_BARREL}: use a named re-export`)
    }

    const moduleSpecifier = statement.moduleSpecifier.text
    const resolvedSource = resolveModuleSource(root, moduleSpecifier)
    if (!resolvedSource) {
      throw new Error(`Could not resolve public SDK export source ${JSON.stringify(moduleSpecifier)} from ${SDK_COMPONENT_BARREL}`)
    }
    const resolvedPath = portablePath(root, resolvedSource)
    for (const element of statement.exportClause.elements) {
      exports.push({
        name: element.name.text,
        importedName: element.propertyName?.text ?? element.name.text,
        kind: statement.isTypeOnly || element.isTypeOnly ? 'type' : 'value',
        moduleSpecifier,
        sourcePath: resolvedPath,
      })
    }
  }
  return exports.sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`))
}

function readRoutePath(path: string): string {
  const file = sourceFile(path)
  let routePath: string | null = null
  let rootRoute = false
  const visit = (node: ts.Node): void => {
    if (routePath !== null) return
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'createRootRoute'
    ) rootRoute = true
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'createRoute'
      && node.arguments[0]
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const pathProperty = node.arguments[0].properties.find((property) => (
        ts.isPropertyAssignment(property) && propertyName(property.name, file) === 'path'
      ))
      if (
        pathProperty
        && ts.isPropertyAssignment(pathProperty)
        && (ts.isStringLiteral(pathProperty.initializer) || ts.isNoSubstitutionTemplateLiteral(pathProperty.initializer))
      ) routePath = pathProperty.initializer.text
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return routePath ?? (rootRoute || basename(path) === '__root.tsx' ? '__root' : '<undeclared>')
}

function propertyName(name: ts.PropertyName, file: ts.SourceFile): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return name.getText(file)
}

function collectClientSlots(root: string, pluginDirectory: string): Map<string, ClientSlotRegistration> {
  const candidates = [
    join(root, 'plugins', pluginDirectory, 'client.tsx'),
    join(root, 'plugins', pluginDirectory, 'client.ts'),
  ]
  const path = candidates.find((candidate) => existsSync(candidate))
  if (!path) return new Map()

  const file = sourceFile(path)
  const registrations = new Map<string, ClientSlotRegistration>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'registerPlugin'
      && node.arguments[0]
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const slotsProperty = node.arguments[0].properties.find((property) => (
        ts.isPropertyAssignment(property) && propertyName(property.name, file) === 'slots'
      ))
      if (slotsProperty && ts.isPropertyAssignment(slotsProperty) && ts.isObjectLiteralExpression(slotsProperty.initializer)) {
        for (const property of slotsProperty.initializer.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const slot = propertyName(property.name, file)
          if (!slot) continue
          if (registrations.has(slot)) {
            throw new Error(`${portablePath(root, path)} registers slot ${JSON.stringify(slot)} more than once`)
          }
          registrations.set(slot, {
            slot,
            symbol: property.initializer.getText(file),
            sourcePath: portablePath(root, path),
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return registrations
}

function routeEntries(root: string): CensusEntry[] {
  const routeRoot = join(root, 'packages/host/src/routes')
  return walkFiles(routeRoot, (path) => path.endsWith('.tsx')).map((path) => {
    const sourcePath = portablePath(root, path)
    const stem = basename(path, '.tsx')
    const route = readRoutePath(path)
    const nonVisualAlias = stem === 'index' && readFileSync(path, 'utf-8').includes('redirect(')
    return {
      id: `host-route:${stem}`,
      kind: 'host-route',
      owner: { repository: 'bakin', area: 'host' },
      identity: { route },
      sourcePath,
      symbols: ['Route'],
      exportStatus: 'not-applicable',
      classification: nonVisualAlias ? 'non-visual-alias' : 'visual-surface',
      evidence: [{
        type: 'route-definition',
        path: sourcePath,
        detail: route === '__root' ? 'createRootRoute shell' : `createRoute path ${JSON.stringify(route)}`,
      }],
    }
  })
}

function pluginSlotEntries(root: string): CensusEntry[] {
  const pluginsRoot = join(root, 'plugins')
  if (!existsSync(pluginsRoot)) return []
  const pluginDirectories = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  return pluginDirectories.flatMap((pluginDirectory) => {
    const manifestFile = join(pluginsRoot, pluginDirectory, 'bakin-plugin.json')
    const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf-8')) as {
      id?: string
      contributes?: { slots?: Array<string | { name?: string }> }
    } : null
    const pluginId = manifest?.id ?? pluginDirectory
    const manifestPath = portablePath(root, manifestFile)
    const manifestSlots = new Map<string, number>()
    for (const [index, declaration] of (manifest?.contributes?.slots ?? []).entries()) {
      const slot = typeof declaration === 'string' ? declaration : declaration.name
      if (!slot) throw new Error(`${manifestPath} contributes.slots[${index}] has no slot name`)
      if (manifestSlots.has(slot)) {
        throw new Error(`${manifestPath} declares slot ${JSON.stringify(slot)} more than once`)
      }
      manifestSlots.set(slot, index)
    }
    const clientSlots = collectClientSlots(root, pluginDirectory)
    const slots = [...new Set([...manifestSlots.keys(), ...clientSlots.keys()])].sort()

    return slots.map((slot) => {
      const route = slot.startsWith('page:') ? slot.slice('page:'.length) : undefined
      const registration = clientSlots.get(slot)
      const manifestIndex = manifestSlots.get(slot)
      const evidence: CensusEvidence[] = []
      if (manifestIndex !== undefined) {
        evidence.push({
          type: 'manifest-slot',
          path: manifestPath,
          detail: `contributes.slots[${manifestIndex}]`,
        })
      }
      if (registration) {
        evidence.push({
          type: 'client-registration',
          path: registration.sourcePath,
          detail: `registerPlugin slots ${JSON.stringify(slot)} -> ${registration.symbol}`,
        })
      }
      return {
        id: `plugin-slot:${pluginId}:${slot}`,
        kind: 'plugin-slot' as const,
        owner: { repository: 'bakin' as const, area: 'plugin' as const, pluginId },
        identity: { slot, ...(route ? { route } : {}) },
        sourcePath: registration?.sourcePath ?? manifestPath,
        symbols: registration ? [registration.symbol] : [],
        exportStatus: 'not-applicable' as const,
        classification: route ? 'visual-surface' as const : 'embedded-surface' as const,
        evidence,
      }
    })
  })
}

function componentOwner(sourcePath: string): CensusEntry['owner'] {
  const pluginMatch = sourcePath.match(/^plugins\/([^/]+)\//)
  if (pluginMatch) return { repository: 'bakin', area: 'plugin', pluginId: pluginMatch[1] }
  return {
    repository: 'bakin',
    area: sourcePath.startsWith('packages/host/') ? 'host' : 'sdk',
  }
}

function componentEntries(root: string, publicExports: readonly PublicExport[]): CensusEntry[] {
  const paths = new Set([
    ...walkFiles(join(root, 'src/components'), (path) => path.endsWith('.tsx')),
    ...walkFiles(join(root, 'packages/host/src/components'), (path) => path.endsWith('.tsx')),
  ])
  for (const publicExport of publicExports) {
    const path = join(root, publicExport.sourcePath)
    if (publicExport.sourcePath.endsWith('.tsx') && existsSync(path)) paths.add(path)
  }

  const publicByPath = new Map<string, string[]>()
  for (const item of publicExports) {
    const current = publicByPath.get(item.sourcePath) ?? []
    current.push(item.name)
    publicByPath.set(item.sourcePath, current)
  }

  return [...paths].sort().map((path) => {
    const sourcePath = portablePath(root, path)
    const componentIdentity = sourcePath.replace(/\.tsx$/, '')
    const publicNames = [...new Set(publicByPath.get(sourcePath) ?? [])].sort()
    const evidence: CensusEvidence[] = [{
      type: 'source-export',
      path: sourcePath,
      detail: 'exported values discovered from TSX source',
    }]
    if (publicNames.length > 0) {
      evidence.push({
        type: 'public-export',
        path: SDK_COMPONENT_BARREL,
        detail: publicNames.join(', '),
      })
    }
    return {
      id: `shared-component:${componentIdentity}`,
      kind: 'shared-component',
      owner: componentOwner(sourcePath),
      identity: { component: componentIdentity },
      sourcePath,
      symbols: exportedValueSymbols(path),
      exportStatus: publicNames.length > 0 ? 'public' : 'private',
      classification: 'shared-ui',
      evidence,
    }
  })
}

function sdkExportEntries(publicExports: readonly PublicExport[]): CensusEntry[] {
  return publicExports.map((item) => ({
    id: `sdk-ui-export:${item.kind}:${item.name}`,
    kind: 'sdk-ui-export',
    owner: { repository: 'bakin', area: 'sdk' },
    identity: {
      symbol: item.name,
      entrypoint: SDK_COMPONENT_ENTRYPOINT,
    },
    sourcePath: item.sourcePath,
    symbols: [item.name],
    exportStatus: 'public',
    classification: 'public-contract',
    evidence: [{
      type: 'public-export',
      path: SDK_COMPONENT_BARREL,
      detail: `${item.kind} ${item.name} from ${item.moduleSpecifier} (${item.importedName})`,
    }],
  }))
}

function summarize(entries: readonly CensusEntry[]): CensusDocument['summary'] {
  const byKind: Record<CensusKind, number> = {
    'host-route': 0,
    'plugin-slot': 0,
    'shared-component': 0,
    'sdk-ui-export': 0,
  }
  for (const entry of entries) byKind[entry.kind]++
  return {
    total: entries.length,
    byKind,
    nonVisualAliases: entries.filter((entry) => entry.classification === 'non-visual-alias').length,
  }
}

export function scanCoreCensus(root = REPO_ROOT): CensusDocument {
  const publicExports = collectPublicExports(root)
  const entries = [
    ...routeEntries(root),
    ...pluginSlotEntries(root),
    ...componentEntries(root, publicExports),
    ...sdkExportEntries(publicExports),
  ].sort((a, b) => a.id.localeCompare(b.id))

  return {
    schemaVersion: 1,
    generatedBy: 'bun run ui:census:generate',
    scope: {
      repositories: ['bakin'],
      includes: [
        'host routes',
        'core plugin page and embedded slots',
        'shared TSX component units',
        'public @makinbakin/sdk/components exports',
      ],
    },
    summary: summarize(entries),
    entries,
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function validateCensus(census: CensusDocument): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  let previousId = ''
  for (const entry of census.entries) {
    if (ids.has(entry.id)) errors.push(`duplicate census id: ${entry.id}`)
    ids.add(entry.id)
    if (previousId && previousId.localeCompare(entry.id) > 0) errors.push(`entries are not sorted at: ${entry.id}`)
    previousId = entry.id
    if (isAbsolute(entry.sourcePath) || entry.sourcePath.startsWith('../')) {
      errors.push(`${entry.id} has a non-portable source path`)
    }
    if (entry.evidence.length === 0) errors.push(`${entry.id} has no discovery evidence`)
    for (const evidence of entry.evidence) {
      if (isAbsolute(evidence.path) || evidence.path.startsWith('../')) {
        errors.push(`${entry.id} has a non-portable evidence path`)
      }
    }
    if (entry.kind === 'host-route' && !entry.identity.route) errors.push(`${entry.id} has no route identity`)
    if (entry.kind === 'host-route' && entry.identity.route === '<undeclared>') {
      errors.push(`${entry.id} uses an unsupported route declaration`)
    }
    if (entry.kind === 'plugin-slot' && !entry.identity.slot) errors.push(`${entry.id} has no slot identity`)
    if (entry.kind === 'plugin-slot') {
      const evidenceTypes = new Set(entry.evidence.map((item) => item.type))
      if (!evidenceTypes.has('manifest-slot')) errors.push(`${entry.id} is missing its manifest slot declaration`)
      if (!evidenceTypes.has('client-registration')) errors.push(`${entry.id} is missing its client slot registration`)
    }
    if (entry.kind === 'shared-component' && !entry.identity.component) errors.push(`${entry.id} has no component identity`)
    if (entry.kind === 'sdk-ui-export' && (!entry.identity.symbol || !entry.identity.entrypoint)) {
      errors.push(`${entry.id} has no public export identity`)
    }
  }
  const expectedSummary = summarize(census.entries)
  if (!sameValue(census.summary, expectedSummary)) errors.push('census summary does not match entries')
  return errors
}

export function diffCensusEntries(expected: CensusDocument, actual: CensusDocument): string[] {
  const expectedById = new Map(expected.entries.map((entry) => [entry.id, entry]))
  const actualById = new Map(actual.entries.map((entry) => [entry.id, entry]))
  const errors: string[] = []
  for (const id of [...actualById.keys()].sort()) {
    if (!expectedById.has(id)) errors.push(`unregistered census entry: ${id}`)
  }
  for (const id of [...expectedById.keys()].sort()) {
    if (!actualById.has(id)) errors.push(`missing discovered census entry: ${id}`)
    else if (!sameValue(expectedById.get(id), actualById.get(id))) errors.push(`changed census entry: ${id}`)
  }
  return errors
}

function validateAgainstSchema(census: CensusDocument): string[] {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))
  const validate = new Ajv({ allErrors: true }).compile(schema)
  if (validate(census)) return []
  return (validate.errors ?? []).map((error) => `${error.instancePath || '<root>'} ${error.message}`)
}

function generate(): void {
  const census = scanCoreCensus(REPO_ROOT)
  const errors = [...validateCensus(census), ...validateAgainstSchema(census)]
  if (errors.length > 0) throw new Error(`Invalid generated UI census:\n- ${errors.join('\n- ')}`)
  mkdirSync(dirname(CENSUS_PATH), { recursive: true })
  writeFileSync(CENSUS_PATH, `${JSON.stringify(census, null, 2)}\n`)
  console.log(`Generated ${portablePath(REPO_ROOT, CENSUS_PATH)} with ${census.entries.length} entries`)
}

function check(): void {
  if (!existsSync(CENSUS_PATH)) throw new Error('Missing design-system/census.json; run bun run ui:census:generate')
  const checkedIn = JSON.parse(readFileSync(CENSUS_PATH, 'utf-8')) as CensusDocument
  const actual = scanCoreCensus(REPO_ROOT)
  const errors = [
    ...validateCensus(checkedIn),
    ...validateAgainstSchema(checkedIn),
    ...validateCensus(actual),
    ...diffCensusEntries(checkedIn, actual),
  ]
  if (!sameValue(checkedIn.scope, actual.scope)) errors.push('census scope metadata is stale')
  if (!sameValue(checkedIn.summary, actual.summary)) errors.push('census summary metadata is stale')
  if (errors.length > 0) throw new Error(`UI census is stale or invalid:\n- ${[...new Set(errors)].join('\n- ')}`)
  console.log(`UI census valid: ${actual.entries.length} entries account for the current core surface`)
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'generate') generate()
  else if (command === 'check') check()
  else throw new Error('Usage: bun run scripts/ui/census.ts <generate|check>')
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
