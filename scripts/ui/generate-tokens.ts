#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../..')

export const TOKEN_LAYERS = ['reference', 'semantic', 'component'] as const
export type TokenLayer = (typeof TOKEN_LAYERS)[number]

export const TOKEN_SOURCE_FILES: Record<TokenLayer, string> = {
  reference: 'packages/ui/tokens/reference.tokens.json',
  semantic: 'packages/ui/tokens/semantic.tokens.json',
  component: 'packages/ui/tokens/component.tokens.json',
}
export const TOKEN_OUTPUT_PATH = 'packages/ui/tokens/tokens.generated.json'

const SUPPORTED_TYPES = [
  'color',
  'cubicBezier',
  'dimension',
  'duration',
  'fontFamily',
  'fontWeight',
  'number',
  'shadow',
  'typography',
] as const
type TokenType = (typeof SUPPORTED_TYPES)[number]

const SUPPORTED_TYPE_SET = new Set<string>(SUPPORTED_TYPES)
const GROUP_PROPERTIES = new Set(['$deprecated', '$description', '$extensions', '$type'])
const TOKEN_PROPERTIES = new Set([
  '$deprecated',
  '$description',
  '$extensions',
  '$ref',
  '$type',
  '$value',
])
const LAYER_EXTENSION = 'dev.bakin.tokens'

type JsonObject = Record<string, unknown>

export interface TokenSourceFile {
  path: string
  layer: TokenLayer
  document: Record<string, unknown>
}

interface SourceMetadata {
  layer: TokenLayer
  status: 'candidate' | 'approved'
}

interface RawToken {
  path: string
  segments: string[]
  layer: TokenLayer
  sourcePath: string
  pointer: string
  description?: string
  declaredType?: TokenType
  inheritedType?: TokenType
  value?: unknown
  ref?: string
}

interface ResolvedToken {
  path: string
  layer: TokenLayer
  visibility: 'internal' | 'public'
  type: TokenType
  description?: string
  source: string
  references: string[]
  value: unknown
}

export interface TokenManifest {
  schemaVersion: 1
  format: 'DTCG 2025.10'
  generatedBy: 'bun run ui:tokens:generate'
  sourceStatus: 'candidate' | 'approved'
  layers: Record<TokenLayer, { visibility: 'internal' | 'public'; tokens: number }>
  tokens: ResolvedToken[]
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function tokenPointer(segments: readonly string[]): string {
  return `#/${segments.map(pointerSegment).join('/')}`
}

function sourceError(path: string, pointer: string, message: string): never {
  throw new Error(`${path}${pointer}: ${message}`)
}

function validateName(sourcePath: string, segments: string[], name: string): void {
  if (name === '$root') return
  if (name.startsWith('$') || /[{}.]/.test(name)) {
    sourceError(
      sourcePath,
      tokenPointer([...segments, name]),
      'token and group names must not begin with "$" or contain "{", "}", or "."',
    )
  }
}

function tokenType(
  sourcePath: string,
  pointer: string,
  value: unknown,
): TokenType | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !SUPPORTED_TYPE_SET.has(value)) {
    sourceError(
      sourcePath,
      pointer,
      `unsupported token type ${JSON.stringify(value)}; supported types: ${SUPPORTED_TYPES.join(', ')}`,
    )
  }
  return value as TokenType
}

function validateDescription(sourcePath: string, pointer: string, value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') sourceError(sourcePath, pointer, '$description must be a string')
  return value
}

function validateDeprecated(sourcePath: string, pointer: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean' && typeof value !== 'string') {
    sourceError(sourcePath, pointer, '$deprecated must be a boolean or string')
  }
}

function validateExtensions(sourcePath: string, pointer: string, value: unknown): void {
  if (value !== undefined && !isObject(value)) sourceError(sourcePath, pointer, '$extensions must be an object')
}

function readSourceMetadata(source: TokenSourceFile): SourceMetadata {
  const extensions = source.document.$extensions
  if (!isObject(extensions)) {
    sourceError(source.path, '#/$extensions', `missing ${LAYER_EXTENSION} layer metadata`)
  }
  const metadata = extensions[LAYER_EXTENSION]
  if (!isObject(metadata)) {
    sourceError(source.path, `#/$extensions/${LAYER_EXTENSION}`, 'layer metadata must be an object')
  }
  const actualLayer = metadata.layer
  if (actualLayer !== source.layer) {
    sourceError(
      source.path,
      `#/$extensions/${LAYER_EXTENSION}/layer`,
      `expected layer "${source.layer}", received ${JSON.stringify(actualLayer)}`,
    )
  }
  const status = metadata.status
  if (status !== 'candidate' && status !== 'approved') {
    sourceError(
      source.path,
      `#/$extensions/${LAYER_EXTENSION}/status`,
      'status must be "candidate" or "approved"',
    )
  }
  return { layer: source.layer, status }
}

function isTokenNode(value: JsonObject): boolean {
  if (Object.hasOwn(value, '$value')) return true
  if (!Object.hasOwn(value, '$ref')) return false
  return Object.keys(value).every((key) => key.startsWith('$'))
}

function collectToken(
  source: TokenSourceFile,
  node: JsonObject,
  segments: string[],
  inheritedType: TokenType | undefined,
  tokens: Map<string, RawToken>,
): void {
  const pointer = tokenPointer(segments)
  for (const key of Object.keys(node)) {
    if (!TOKEN_PROPERTIES.has(key)) {
      sourceError(source.path, `${pointer}/${pointerSegment(key)}`, `unknown token property "${key}"`)
    }
  }
  const hasValue = Object.hasOwn(node, '$value')
  const hasRef = Object.hasOwn(node, '$ref')
  if (hasValue === hasRef) {
    sourceError(source.path, pointer, 'a token must define exactly one of $value or $ref')
  }
  if (hasRef && (typeof node.$ref !== 'string' || !node.$ref.startsWith('#/'))) {
    sourceError(source.path, `${pointer}/$ref`, '$ref must be a local JSON Pointer beginning with "#/"')
  }
  const declaredType = tokenType(source.path, `${pointer}/$type`, node.$type)
  const description = validateDescription(source.path, `${pointer}/$description`, node.$description)
  validateDeprecated(source.path, `${pointer}/$deprecated`, node.$deprecated)
  validateExtensions(source.path, `${pointer}/$extensions`, node.$extensions)
  const path = segments.join('.')
  if (tokens.has(path)) sourceError(source.path, pointer, `duplicate token path "${path}"`)
  tokens.set(path, {
    path,
    segments,
    layer: source.layer,
    sourcePath: source.path,
    pointer,
    description,
    declaredType,
    inheritedType,
    value: hasValue ? node.$value : undefined,
    ref: hasRef ? node.$ref as string : undefined,
  })
}

function walkGroup(
  source: TokenSourceFile,
  group: JsonObject,
  segments: string[],
  inheritedType: TokenType | undefined,
  tokens: Map<string, RawToken>,
): void {
  const pointer = tokenPointer(segments)
  const groupType = tokenType(source.path, `${pointer}/$type`, group.$type) ?? inheritedType
  validateDescription(source.path, `${pointer}/$description`, group.$description)
  validateDeprecated(source.path, `${pointer}/$deprecated`, group.$deprecated)
  validateExtensions(source.path, `${pointer}/$extensions`, group.$extensions)

  for (const [name, child] of Object.entries(group)) {
    if (name.startsWith('$') && name !== '$root') {
      if (!GROUP_PROPERTIES.has(name)) {
        sourceError(
          source.path,
          `${pointer}/${pointerSegment(name)}`,
          name === '$extends'
            ? '$extends is outside Bakin\'s intentionally narrow token pipeline'
            : `unknown group property "${name}"`,
        )
      }
      continue
    }
    validateName(source.path, segments, name)
    if (!isObject(child)) {
      sourceError(source.path, `${pointer}/${pointerSegment(name)}`, 'tokens and groups must be objects')
    }
    const childSegments = [...segments, name]
    if (isTokenNode(child)) collectToken(source, child, childSegments, groupType, tokens)
    else walkGroup(source, child, childSegments, groupType, tokens)
  }
}

function flattenSource(source: TokenSourceFile, tokens: Map<string, RawToken>): SourceMetadata {
  for (const key of Object.keys(source.document).filter((entry) => entry.startsWith('$'))) {
    if (!GROUP_PROPERTIES.has(key)) {
      sourceError(
        source.path,
        `#/${pointerSegment(key)}`,
        key === '$extends'
          ? '$extends is outside Bakin\'s intentionally narrow token pipeline'
          : `unknown group property "${key}"`,
      )
    }
  }
  const inheritedType = tokenType(source.path, '#/$type', source.document.$type)
  validateDescription(source.path, '#/$description', source.document.$description)
  validateDeprecated(source.path, '#/$deprecated', source.document.$deprecated)
  validateExtensions(source.path, '#/$extensions', source.document.$extensions)
  const metadata = readSourceMetadata(source)
  const unexpectedRoots = Object.keys(source.document)
    .filter((key) => !key.startsWith('$') && key !== source.layer)
  if (unexpectedRoots.length > 0) {
    sourceError(
      source.path,
      `#/${pointerSegment(unexpectedRoots[0])}`,
      `source file for layer "${source.layer}" may contain only the "${source.layer}" root group`,
    )
  }
  const root = source.document[source.layer]
  if (!isObject(root)) sourceError(source.path, `#/${source.layer}`, `missing "${source.layer}" root group`)
  walkGroup(source, root, [source.layer], inheritedType, tokens)
  return metadata
}

function decodeJsonPointer(pointer: string, source: RawToken, suffix: string): string[] {
  if (!pointer.startsWith('#/')) {
    sourceError(source.sourcePath, `${source.pointer}${suffix}`, '$ref must begin with "#/"')
  }
  return pointer.slice(2).split('/').map((segment) => {
    if (/~(?:[^01]|$)/.test(segment)) {
      sourceError(source.sourcePath, `${source.pointer}${suffix}`, `invalid JSON Pointer escape in "${pointer}"`)
    }
    return segment.replaceAll('~1', '/').replaceAll('~0', '~')
  })
}

interface TokenReference {
  path: string
  remainder: string[]
}

function pointerReference(
  pointer: string,
  source: RawToken,
  suffix: string,
  tokens: Map<string, RawToken>,
): TokenReference {
  const segments = decodeJsonPointer(pointer, source, suffix)
  for (let index = segments.length; index > 0; index--) {
    const path = segments.slice(0, index).join('.')
    if (!tokens.has(path)) continue
    const remainder = segments.slice(index)
    if (remainder[0] === '$value') remainder.shift()
    return { path, remainder }
  }
  sourceError(source.sourcePath, `${source.pointer}${suffix}`, `unknown JSON Pointer reference "${pointer}"`)
}

function curlyReference(value: string): string | undefined {
  const match = value.match(/^\{([^{}]+)\}$/)
  return match?.[1]
}

function layerReferenceError(source: RawToken, target: RawToken, suffix: string): void {
  if (source.layer === 'reference' && target.layer !== 'reference') {
    sourceError(
      source.sourcePath,
      `${source.pointer}${suffix}`,
      `reference tokens may reference only reference tokens; received ${target.path}`,
    )
  }
  if (source.layer === 'semantic' && target.layer === 'component') {
    sourceError(
      source.sourcePath,
      `${source.pointer}${suffix}`,
      `semantic tokens may reference only reference or semantic tokens; received ${target.path}`,
    )
  }
  if (source.layer === 'component' && target.layer === 'reference') {
    sourceError(
      source.sourcePath,
      `${source.pointer}${suffix}`,
      `component tokens may reference only semantic or component tokens; received ${target.path}`,
    )
  }
}

function nestedValue(value: unknown, remainder: readonly string[], source: RawToken, suffix: string): unknown {
  let current = value
  for (const segment of remainder) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        sourceError(source.sourcePath, `${source.pointer}${suffix}`, `JSON Pointer index "${segment}" is out of bounds`)
      }
      current = current[index]
    } else if (isObject(current) && Object.hasOwn(current, segment)) current = current[segment]
    else sourceError(source.sourcePath, `${source.pointer}${suffix}`, `JSON Pointer property "${segment}" does not exist`)
  }
  return current
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function dimensionError(value: unknown): string | undefined {
  if (
    !isObject(value)
    || !finiteNumber(value.value)
    || (value.unit !== 'px' && value.unit !== 'rem')
  ) return 'dimension must be an object with finite value and unit "px" or "rem"'
  return undefined
}

function colorError(value: unknown): string | undefined {
  if (!isObject(value) || value.colorSpace !== 'srgb') {
    return 'color must use the DTCG sRGB object form'
  }
  if (
    !Array.isArray(value.components)
    || value.components.length !== 3
    || value.components.some((component) => !finiteNumber(component) || component < 0 || component > 1)
  ) return 'color components must contain three numbers between 0 and 1'
  if (value.alpha !== undefined && (!finiteNumber(value.alpha) || value.alpha < 0 || value.alpha > 1)) {
    return 'color alpha must be a number between 0 and 1'
  }
  if (value.hex !== undefined && (typeof value.hex !== 'string' || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value.hex))) {
    return 'color hex metadata must be a six- or eight-digit hex string'
  }
  return undefined
}

function fontFamilyError(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return undefined
  if (Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    return undefined
  }
  return 'fontFamily must be a non-empty string or array of non-empty strings'
}

function fontWeightError(value: unknown): string | undefined {
  const names = new Set([
    'thin', 'hairline', 'extra-light', 'ultra-light', 'light', 'normal', 'regular',
    'book', 'medium', 'semi-bold', 'demi-bold', 'bold', 'extra-bold', 'ultra-bold',
    'black', 'heavy', 'extra-black', 'ultra-black',
  ])
  if ((finiteNumber(value) && value >= 1 && value <= 1000) || (typeof value === 'string' && names.has(value))) {
    return undefined
  }
  return 'fontWeight must be a number from 1 to 1000 or a DTCG weight name'
}

function shadowItemError(value: unknown): string | undefined {
  if (!isObject(value)) return 'shadow entries must be objects'
  if (value.inset !== undefined && typeof value.inset !== 'boolean') {
    return 'shadow inset must be a boolean when present'
  }
  return colorError(value.color)
    ?? dimensionError(value.offsetX)
    ?? dimensionError(value.offsetY)
    ?? dimensionError(value.blur)
    ?? dimensionError(value.spread)
}

function typeValueError(type: TokenType, value: unknown): string | undefined {
  switch (type) {
    case 'color': return colorError(value)
    case 'dimension': return dimensionError(value)
    case 'duration':
      if (
        !isObject(value)
        || !finiteNumber(value.value)
        || value.value < 0
        || (value.unit !== 'ms' && value.unit !== 's')
      ) return 'duration must be a non-negative finite value with unit "ms" or "s"'
      return undefined
    case 'cubicBezier':
      if (
        !Array.isArray(value)
        || value.length !== 4
        || value.some((entry) => !finiteNumber(entry))
        || (value[0] as number) < 0
        || (value[0] as number) > 1
        || (value[2] as number) < 0
        || (value[2] as number) > 1
      ) return 'cubicBezier must contain four finite numbers with x coordinates between 0 and 1'
      return undefined
    case 'number': return finiteNumber(value) ? undefined : 'number must be finite'
    case 'fontFamily': return fontFamilyError(value)
    case 'fontWeight': return fontWeightError(value)
    case 'shadow': {
      const values = Array.isArray(value) ? value : [value]
      if (values.length === 0) return 'shadow must contain at least one shadow entry'
      return values.map(shadowItemError).find(Boolean)
    }
    case 'typography':
      if (!isObject(value)) return 'typography must be an object'
      return fontFamilyError(value.fontFamily)
        ?? dimensionError(value.fontSize)
        ?? fontWeightError(value.fontWeight)
        ?? dimensionError(value.letterSpacing)
        ?? (finiteNumber(value.lineHeight) ? undefined : 'typography lineHeight must be finite')
  }
}

function validateTypeValue(token: RawToken, type: TokenType, value: unknown): void {
  const error = typeValueError(type, value)
  if (error) sourceError(token.sourcePath, `${token.pointer}/$value`, error)
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
  )
}

function resolveTokens(tokens: Map<string, RawToken>): ResolvedToken[] {
  const resolved = new Map<string, ResolvedToken>()
  const active: string[] = []

  const resolveDependency = (
    owner: RawToken,
    reference: TokenReference,
    suffix: string,
  ): { target: ResolvedToken; value: unknown } => {
    const targetRaw = tokens.get(reference.path)
    if (!targetRaw) {
      sourceError(owner.sourcePath, `${owner.pointer}${suffix}`, `unknown token reference "${reference.path}"`)
    }
    layerReferenceError(owner, targetRaw, suffix)
    if (active.includes(reference.path)) {
      sourceError(
        owner.sourcePath,
        `${owner.pointer}${suffix}`,
        `circular token reference: ${[...active, reference.path].join(' -> ')}`,
      )
    }
    const target = resolveToken(targetRaw)
    return {
      target,
      value: nestedValue(target.value, reference.remainder, owner, suffix),
    }
  }

  const resolveValue = (
    owner: RawToken,
    value: unknown,
    suffix: string,
    references: Set<string>,
  ): unknown => {
    if (typeof value === 'string') {
      const path = curlyReference(value)
      if (!path) return value
      const dependency = resolveDependency(owner, { path, remainder: [] }, suffix)
      references.add(path)
      return dependency.value
    }
    if (Array.isArray(value)) {
      return value.map((entry, index) => resolveValue(owner, entry, `${suffix}/${index}`, references))
    }
    if (!isObject(value)) return value
    if (Object.keys(value).length === 1 && typeof value.$ref === 'string') {
      const reference = pointerReference(value.$ref, owner, `${suffix}/$ref`, tokens)
      const dependency = resolveDependency(owner, reference, `${suffix}/$ref`)
      references.add(reference.path)
      return dependency.value
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveValue(owner, entry, `${suffix}/${pointerSegment(key)}`, references),
      ]),
    )
  }

  const resolveToken = (token: RawToken): ResolvedToken => {
    const cached = resolved.get(token.path)
    if (cached) return cached
    active.push(token.path)
    try {
      const references = new Set<string>()
      const declared = token.declaredType ?? token.inheritedType
      let type: TokenType
      let value: unknown
      let aliasTarget: ResolvedToken | undefined

      if (token.ref !== undefined) {
        const reference = pointerReference(token.ref, token, '/$ref', tokens)
        const dependency = resolveDependency(token, reference, '/$ref')
        references.add(reference.path)
        aliasTarget = dependency.target
        value = dependency.value
      } else if (typeof token.value === 'string' && curlyReference(token.value)) {
        const path = curlyReference(token.value) as string
        const dependency = resolveDependency(token, { path, remainder: [] }, '/$value')
        references.add(path)
        aliasTarget = dependency.target
        value = dependency.value
      } else {
        if (token.layer === 'semantic') {
          sourceError(
            token.sourcePath,
            `${token.pointer}/$value`,
            'public semantic tokens must alias reference or semantic tokens; raw values are internal',
          )
        }
        if (token.layer === 'component') {
          sourceError(
            token.sourcePath,
            `${token.pointer}/$value`,
            'component tokens must alias semantic or component tokens',
          )
        }
        value = resolveValue(token, token.value, '/$value', references)
      }

      if (aliasTarget) {
        if (declared && declared !== aliasTarget.type) {
          sourceError(
            token.sourcePath,
            `${token.pointer}/$type`,
            `declared type "${declared}" does not match referenced type "${aliasTarget.type}"`,
          )
        }
        type = declared ?? aliasTarget.type
      } else {
        if (!declared) {
          sourceError(
            token.sourcePath,
            token.pointer,
            'token type is required unless it can be inherited from a group or whole-token alias',
          )
        }
        type = declared
      }
      validateTypeValue(token, type, value)
      const result: ResolvedToken = {
        path: token.path,
        layer: token.layer,
        visibility: token.layer === 'semantic' ? 'public' : 'internal',
        type,
        ...(token.description ? { description: token.description } : {}),
        source: `${token.sourcePath}${token.pointer}`,
        references: [...references].sort(),
        value: sortJson(value),
      }
      resolved.set(token.path, result)
      return result
    } finally {
      active.pop()
    }
  }

  return [...tokens.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(resolveToken)
}

export function compileTokenSources(sources: readonly TokenSourceFile[]): TokenManifest {
  const byLayer = new Map<TokenLayer, TokenSourceFile>()
  for (const source of sources) {
    if (byLayer.has(source.layer)) throw new Error(`duplicate token source layer "${source.layer}"`)
    byLayer.set(source.layer, source)
  }
  for (const layer of TOKEN_LAYERS) {
    if (!byLayer.has(layer)) throw new Error(`missing token source layer "${layer}"`)
  }

  const tokens = new Map<string, RawToken>()
  const metadata = TOKEN_LAYERS.map((layer) => flattenSource(byLayer.get(layer) as TokenSourceFile, tokens))
  const sourceStatus = metadata.every((entry) => entry.status === 'approved') ? 'approved' : 'candidate'
  const resolved = resolveTokens(tokens)
  const count = (layer: TokenLayer): number => resolved.filter((token) => token.layer === layer).length
  return {
    schemaVersion: 1,
    format: 'DTCG 2025.10',
    generatedBy: 'bun run ui:tokens:generate',
    sourceStatus,
    layers: {
      reference: { visibility: 'internal', tokens: count('reference') },
      semantic: { visibility: 'public', tokens: count('semantic') },
      component: { visibility: 'internal', tokens: count('component') },
    },
    tokens: resolved,
  }
}

export function renderTokenManifest(sources: readonly TokenSourceFile[]): string {
  return `${JSON.stringify(compileTokenSources(sources), null, 2)}\n`
}

export function loadTokenSources(root = REPO_ROOT): TokenSourceFile[] {
  return TOKEN_LAYERS.map((layer) => {
    const relativePath = TOKEN_SOURCE_FILES[layer]
    const path = join(root, relativePath)
    if (!existsSync(path)) throw new Error(`missing ${relativePath}`)
    try {
      const document = JSON.parse(readFileSync(path, 'utf-8'))
      if (!isObject(document)) throw new Error('root must be an object')
      return { path: relativePath, layer, document }
    } catch (error) {
      throw new Error(`${relativePath}#/: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

function summary(manifest: TokenManifest): { tokens: number; publicTokens: number } {
  return {
    tokens: manifest.tokens.length,
    publicTokens: manifest.tokens.filter((token) => token.visibility === 'public').length,
  }
}

export function generateTokenArtifacts(root = REPO_ROOT): { tokens: number; publicTokens: number } {
  const sources = loadTokenSources(root)
  const rendered = renderTokenManifest(sources)
  const output = join(root, TOKEN_OUTPUT_PATH)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, rendered)
  return summary(compileTokenSources(sources))
}

export function checkTokenArtifacts(root = REPO_ROOT): { tokens: number; publicTokens: number } {
  const sources = loadTokenSources(root)
  const expected = renderTokenManifest(sources)
  const repeated = renderTokenManifest(sources)
  if (expected !== repeated) throw new Error('token generation is nondeterministic for the current sources')
  const output = join(root, TOKEN_OUTPUT_PATH)
  if (!existsSync(output)) throw new Error(`missing ${TOKEN_OUTPUT_PATH}; run bun run ui:tokens:generate`)
  if (readFileSync(output, 'utf-8') !== expected) {
    throw new Error(`${TOKEN_OUTPUT_PATH} is stale; run bun run ui:tokens:generate`)
  }
  return summary(compileTokenSources(sources))
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (process.argv.length !== 3 || (command !== 'generate' && command !== 'check')) {
    throw new Error('Usage: bun run scripts/ui/generate-tokens.ts <generate|check>')
  }
  const result = command === 'generate' ? generateTokenArtifacts() : checkTokenArtifacts()
  console.log(
    `${command === 'generate' ? 'Generated' : 'Validated'} ${TOKEN_OUTPUT_PATH}: `
    + `${result.tokens} tokens (${result.publicTokens} public semantic tokens)`,
  )
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
