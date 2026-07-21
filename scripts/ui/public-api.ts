#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Ajv from 'ajv'
import ts from 'typescript'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const INVENTORY_PATH = join(REPO_ROOT, 'design-system/public-api.json')
const SCHEMA_PATH = join(REPO_ROOT, 'design-system/public-api.schema.json')

export type PublicApiStatus = 'supported-prerelease' | 'migration-only-frozen'
export type PublicApiConsumerPolicy = 'supported' | 'migration-only'
export type PublicApiDomain = 'ui' | 'layout' | 'patterns' | 'charts' | 'conversation' | 'content' | 'legacy'

export interface PublicApiEntrypoint {
  specifier: string
  sourcePath: string
  domain: PublicApiDomain
  purpose: string
  status: PublicApiStatus
  newConsumerPolicy: PublicApiConsumerPolicy
  values: string[]
  types: string[]
}

export interface PublicApiInventory {
  schemaVersion: 1
  generatedBy: 'bun run ui:public-api:generate'
  contracts: {
    routing: string
    stylesheet: '@makinbakin/sdk/styles.css'
    privateImplementation: '@bakin/ui'
  }
  summary: {
    entrypoints: number
    supportedEntrypoints: number
    frozenLegacyEntrypoints: number
    valueExports: number
    typeExports: number
  }
  entrypoints: PublicApiEntrypoint[]
}

type EntrypointDefinition = Omit<PublicApiEntrypoint, 'values' | 'types'>

export const PUBLIC_API_ENTRYPOINTS: readonly EntrypointDefinition[] = [
  {
    specifier: '@makinbakin/sdk/ui',
    sourcePath: 'packages/sdk/src/ui/index.ts',
    domain: 'ui',
    purpose: 'Base actions, surfaces, form controls, overlays, states, and semantic style helpers.',
    status: 'supported-prerelease',
    newConsumerPolicy: 'supported',
  },
  {
    specifier: '@makinbakin/sdk/layout',
    sourcePath: 'packages/sdk/src/layout/index.ts',
    domain: 'layout',
    purpose: 'Finite page, flow, grid, section, and bounded-overflow composition.',
    status: 'supported-prerelease',
    newConsumerPolicy: 'supported',
  },
  {
    specifier: '@makinbakin/sdk/patterns',
    sourcePath: 'packages/sdk/src/patterns/index.ts',
    domain: 'patterns',
    purpose: 'Reusable application patterns with consumer-owned data, persistence, and routing.',
    status: 'supported-prerelease',
    newConsumerPolicy: 'supported',
  },
  {
    specifier: '@makinbakin/sdk/charts',
    sourcePath: 'packages/sdk/src/charts/index.ts',
    domain: 'charts',
    purpose: 'Opt-in accessible data visualization isolated from routine UI consumers.',
    status: 'supported-prerelease',
    newConsumerPolicy: 'supported',
  },
  {
    specifier: '@makinbakin/sdk/conversation',
    sourcePath: 'packages/sdk/src/conversation/index.ts',
    domain: 'conversation',
    purpose: 'Opt-in conversation models, folding, streaming, turns, composer, and embedded output.',
    status: 'supported-prerelease',
    newConsumerPolicy: 'supported',
  },
  {
    specifier: '@makinbakin/sdk/content',
    sourcePath: 'packages/sdk/src/content/index.ts',
    domain: 'content',
    purpose: 'Opt-in rich Markdown rendering and editing isolated from routine UI consumers.',
    status: 'supported-prerelease',
    newConsumerPolicy: 'supported',
  },
  {
    specifier: '@makinbakin/sdk/components',
    sourcePath: 'packages/sdk/src/components/index.ts',
    domain: 'legacy',
    purpose: 'Frozen migration-only compatibility barrel for existing consumers.',
    status: 'migration-only-frozen',
    newConsumerPolicy: 'migration-only',
  },
] as const

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function summary(entrypoints: readonly PublicApiEntrypoint[]): PublicApiInventory['summary'] {
  return {
    entrypoints: entrypoints.length,
    supportedEntrypoints: entrypoints.filter((entry) => entry.status === 'supported-prerelease').length,
    frozenLegacyEntrypoints: entrypoints.filter((entry) => entry.status === 'migration-only-frozen').length,
    valueExports: entrypoints.reduce((total, entry) => total + entry.values.length, 0),
    typeExports: entrypoints.reduce((total, entry) => total + entry.types.length, 0),
  }
}

function compilerProgram(root: string): ts.Program {
  const configPath = join(root, 'tsconfig.app.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  return ts.createProgram(parsed.fileNames, parsed.options)
}

function exportsFor(
  program: ts.Program,
  checker: ts.TypeChecker,
  root: string,
  definition: EntrypointDefinition,
): Pick<PublicApiEntrypoint, 'values' | 'types'> {
  const path = join(root, definition.sourcePath)
  const source = program.getSourceFile(path)
  if (!source) throw new Error(`${definition.specifier} source is not in the TypeScript program: ${definition.sourcePath}`)
  const module = checker.getSymbolAtLocation(source)
  if (!module) throw new Error(`${definition.specifier} has no module symbol: ${definition.sourcePath}`)

  const values = new Set<string>()
  const types = new Set<string>()
  for (const symbol of checker.getExportsOfModule(module)) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    if (target.flags & ts.SymbolFlags.Value) values.add(symbol.name)
    if (target.flags & ts.SymbolFlags.Type) types.add(symbol.name)
  }
  return { values: sorted(values), types: sorted(types) }
}

/** Build the exact reviewed surface from TypeScript's resolved module exports. */
export function buildPublicApiInventory(root = REPO_ROOT): PublicApiInventory {
  const program = compilerProgram(root)
  const checker = program.getTypeChecker()
  const entrypoints = PUBLIC_API_ENTRYPOINTS.map((definition) => ({
    ...definition,
    ...exportsFor(program, checker, root, definition),
  }))
  return {
    schemaVersion: 1,
    generatedBy: 'bun run ui:public-api:generate',
    contracts: {
      routing: '@makinbakin/sdk/routing and the existing query-state hooks remain authoritative; visual entrypoints do not create a second routing model.',
      stylesheet: '@makinbakin/sdk/styles.css',
      privateImplementation: '@bakin/ui',
    },
    summary: summary(entrypoints),
    entrypoints,
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function diffNames(
  errors: string[],
  specifier: string,
  kind: 'value' | 'type',
  expected: readonly string[],
  actual: readonly string[],
): void {
  const expectedNames = new Set(expected)
  const actualNames = new Set(actual)
  const added = actual.filter((name) => !expectedNames.has(name))
  const removed = expected.filter((name) => !actualNames.has(name))
  if (added.length > 0) errors.push(`${specifier} added ${kind} exports: ${added.join(', ')}`)
  if (removed.length > 0) errors.push(`${specifier} removed ${kind} exports: ${removed.join(', ')}`)
}

/** Explain every unreviewed entrypoint, metadata, value, or type change. */
export function diffPublicApiInventory(
  expected: PublicApiInventory,
  actual: PublicApiInventory,
): string[] {
  const errors: string[] = []
  const expectedBySpecifier = new Map(expected.entrypoints.map((entry) => [entry.specifier, entry]))
  const actualBySpecifier = new Map(actual.entrypoints.map((entry) => [entry.specifier, entry]))

  for (const specifier of sorted(actualBySpecifier.keys())) {
    if (!expectedBySpecifier.has(specifier)) errors.push(`added public entrypoint: ${specifier}`)
  }
  for (const specifier of sorted(expectedBySpecifier.keys())) {
    const expectedEntry = expectedBySpecifier.get(specifier)!
    const actualEntry = actualBySpecifier.get(specifier)
    if (!actualEntry) {
      errors.push(`removed public entrypoint: ${specifier}`)
      continue
    }
    for (const key of ['sourcePath', 'domain', 'purpose', 'status', 'newConsumerPolicy'] as const) {
      if (actualEntry[key] !== expectedEntry[key]) errors.push(`${specifier} changed ${key}`)
    }
    diffNames(errors, specifier, 'value', expectedEntry.values, actualEntry.values)
    diffNames(errors, specifier, 'type', expectedEntry.types, actualEntry.types)
  }
  if (!sameValue(expected.contracts, actual.contracts)) errors.push('public API ownership contracts changed')
  if (!sameValue(expected.summary, actual.summary)) errors.push('public API summary changed')
  return errors
}

/** Validate schema, ordering, uniqueness, definitions, and derived totals. */
export function validatePublicApiInventory(inventory: PublicApiInventory): string[] {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
  const validate = new Ajv({ allErrors: true }).compile(schema)
  const errors = validate(inventory)
    ? []
    : (validate.errors ?? []).map((error) => `${error.instancePath || '<root>'} ${error.message}`)
  const definitions = new Map(PUBLIC_API_ENTRYPOINTS.map((entry) => [entry.specifier, entry]))

  for (const entry of inventory.entrypoints ?? []) {
    const definition = definitions.get(entry.specifier)
    if (!definition) errors.push(`unknown public API entrypoint: ${entry.specifier}`)
    else {
      for (const key of ['sourcePath', 'domain', 'purpose', 'status', 'newConsumerPolicy'] as const) {
        if (entry[key] !== definition[key]) errors.push(`${entry.specifier} has unreviewed ${key}`)
      }
    }
    for (const [kind, names] of [['values', entry.values], ['types', entry.types]] as const) {
      if (!sameValue(names, sorted(new Set(names)))) errors.push(`${entry.specifier} ${kind} are not sorted and unique`)
    }
  }
  const focused = (inventory.entrypoints ?? []).filter((entry) => entry.status === 'supported-prerelease')
  for (const kind of ['values', 'types'] as const) {
    const owners = new Map<string, string[]>()
    for (const entry of focused) {
      for (const name of entry[kind]) owners.set(name, [...(owners.get(name) ?? []), entry.specifier])
    }
    for (const [name, specifiers] of owners) {
      if (specifiers.length > 1) {
        errors.push(`focused ${kind === 'values' ? 'value' : 'type'} export ${name} has multiple owners: ${specifiers.join(', ')}`)
      }
    }
  }
  const expectedSpecifiers = PUBLIC_API_ENTRYPOINTS.map((entry) => entry.specifier)
  if (!sameValue(inventory.entrypoints?.map((entry) => entry.specifier), expectedSpecifiers)) {
    errors.push('public API entrypoints do not match the reviewed order')
  }
  if (!sameValue(inventory.summary, summary(inventory.entrypoints ?? []))) {
    errors.push('public API summary does not match the export inventory')
  }
  return errors
}

function generate(): void {
  const inventory = buildPublicApiInventory()
  const errors = validatePublicApiInventory(inventory)
  if (errors.length > 0) throw new Error(`Invalid generated public API inventory:\n- ${errors.join('\n- ')}`)
  writeFileSync(INVENTORY_PATH, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
  console.log(`Generated design-system/public-api.json with ${inventory.summary.valueExports} values and ${inventory.summary.typeExports} types`)
}

function check(): void {
  if (!existsSync(INVENTORY_PATH)) {
    throw new Error('Missing design-system/public-api.json; run bun run ui:public-api:generate')
  }
  const expected = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as PublicApiInventory
  const actual = buildPublicApiInventory()
  const errors = [...validatePublicApiInventory(expected), ...diffPublicApiInventory(expected, actual)]
  if (errors.length > 0) throw new Error(`Public API freeze failed:\n- ${errors.join('\n- ')}`)
  console.log(`Public API freeze valid: ${actual.summary.entrypoints} entrypoints, ${actual.summary.valueExports} values, ${actual.summary.typeExports} types`)
}

function main(): void {
  const command = process.argv[2]
  if (process.argv.length > 3 || (command !== 'generate' && command !== 'check')) {
    throw new Error('Usage: bun run scripts/ui/public-api.ts <generate|check>')
  }
  if (command === 'generate') generate()
  else check()
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
