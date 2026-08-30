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
export const TOKEN_RUNTIME_CSS_OUTPUT_PATH = 'packages/ui/src/styles/tokens.generated.css'
export const TOKEN_TAILWIND_OUTPUT_PATH = 'packages/ui/src/styles/tailwind.generated.css'
export const TOKEN_METADATA_OUTPUT_PATH = 'packages/ui/src/tokens.generated.ts'
export const TOKEN_STORY_OUTPUT_PATH = 'storybook/public/tokens/tokens.generated.stories.tsx'
export const TOKEN_STORY_DATA_OUTPUT_PATH = 'storybook/support/tokens.data.ts'
export const TOKEN_DOCS_OUTPUT_PATH = 'docs/src/content/docs/reference/generated/ui-tokens.md'

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
  extensions?: JsonObject
  value?: unknown
  ref?: string
}

export type TokenContrastRole = 'normal-text' | 'non-text' | 'reference'

export interface TokenContrast {
  against: string
  role: TokenContrastRole
  ratio: number
  minimum: number | null
  standard: string
  status: 'pass' | 'reference'
}

export interface ResolvedToken {
  path: string
  layer: TokenLayer
  visibility: 'internal' | 'public'
  type: TokenType
  description?: string
  source: string
  references: string[]
  value: unknown
  contrast?: TokenContrast
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
    ...(isObject(node.$extensions) ? { extensions: node.$extensions } : {}),
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

function cssSlug(segments: readonly string[]): string {
  return segments.map((segment) => segment
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()).join('-')
}

function semanticSlug(token: ResolvedToken): string {
  return cssSlug(token.path.split('.').slice(1))
}

function semanticCssVariable(token: ResolvedToken): string {
  return `--bakin-${semanticSlug(token)}`
}

function colorCssValue(value: unknown): string {
  if (!isObject(value) || !Array.isArray(value.components)) throw new Error('resolved color is invalid')
  const alpha = value.alpha === undefined ? 1 : value.alpha
  if (
    typeof value.hex === 'string'
    && (value.hex.length === 9 || alpha === 1)
  ) return value.hex.toLowerCase()
  const alphaSuffix = alpha === 1 ? '' : ` / ${alpha}`
  return `color(srgb ${value.components.join(' ')}${alphaSuffix})`
}

function dimensionCssValue(value: unknown): string {
  if (!isObject(value)) throw new Error('resolved dimension is invalid')
  return `${value.value}${value.unit}`
}

function fontFamilyCssValue(value: unknown): string {
  const families = Array.isArray(value) ? value : [value]
  return families.map((family) => {
    if (typeof family !== 'string') throw new Error('resolved font family is invalid')
    return /\s/.test(family) ? JSON.stringify(family) : family
  }).join(', ')
}

function shadowCssValue(value: unknown): string {
  const shadows = Array.isArray(value) ? value : [value]
  return shadows.map((shadow) => {
    if (!isObject(shadow)) throw new Error('resolved shadow is invalid')
    return [
      shadow.inset === true ? 'inset' : '',
      dimensionCssValue(shadow.offsetX),
      dimensionCssValue(shadow.offsetY),
      dimensionCssValue(shadow.blur),
      dimensionCssValue(shadow.spread),
      colorCssValue(shadow.color),
    ].filter(Boolean).join(' ')
  }).join(', ')
}

function tokenCssValue(token: ResolvedToken): string {
  switch (token.type) {
    case 'color': return colorCssValue(token.value)
    case 'dimension': return dimensionCssValue(token.value)
    case 'duration': return dimensionCssValue(token.value)
    case 'cubicBezier': return `cubic-bezier(${(token.value as number[]).join(', ')})`
    case 'number': return String(token.value)
    case 'fontFamily': return fontFamilyCssValue(token.value)
    case 'fontWeight': return String(token.value)
    case 'shadow': return shadowCssValue(token.value)
    case 'typography':
      throw new Error(`${token.source}: public typography composites must be expanded into property-specific semantic tokens`)
  }
}

function tailwindVariable(token: ResolvedToken): string | undefined {
  const segments = token.path.split('.').slice(1)
  const withoutTypeGroup = segments[0] === 'color' ? segments.slice(1) : segments
  if (token.type === 'color') return `--color-bakin-${cssSlug(withoutTypeGroup)}`
  if (token.type === 'dimension' && segments[0] === 'layout' && segments[1] === 'space') {
    return `--spacing-bakin-${cssSlug(segments.slice(2))}`
  }
  if (token.type === 'dimension' && segments[0] === 'radius') {
    return `--radius-bakin-${cssSlug(segments.slice(1))}`
  }
  if (token.type === 'dimension' && segments[0] === 'typography' && segments[1] === 'size') {
    return `--text-bakin-${cssSlug(segments)}`
  }
  if (token.type === 'cubicBezier' && segments[0] === 'motion' && segments[1] === 'easing') {
    return `--ease-bakin-${cssSlug(segments.slice(2))}`
  }
  if (token.type === 'fontFamily') return `--font-bakin-${cssSlug(segments)}`
  if (token.type === 'fontWeight') return `--font-weight-bakin-${cssSlug(segments)}`
  if (token.type === 'shadow') return `--shadow-bakin-${cssSlug(segments)}`
  return undefined
}

function publicSemanticTokens(manifest: TokenManifest): ResolvedToken[] {
  return manifest.tokens.filter((token) => token.visibility === 'public')
}

function assertNoGeneratedNameCollisions(manifest: TokenManifest): void {
  const seen = new Map<string, ResolvedToken>()
  const tokens = [...publicSemanticTokens(manifest)]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  for (const token of tokens) {
    const variables = [semanticCssVariable(token), tailwindVariable(token)].filter(Boolean) as string[]
    for (const variable of variables) {
      const existing = seen.get(variable)
      if (existing) {
        throw new Error(
          `${token.source}: generated CSS variable "${variable}" collides with ${existing.path}`,
        )
      }
      seen.set(variable, token)
    }
  }
}

function renderRuntimeCss(manifest: TokenManifest): string {
  const declarations = publicSemanticTokens(manifest)
    .map((token) => `  ${semanticCssVariable(token)}: ${tokenCssValue(token)};`)
  return [
    '/* Generated by bun run ui:tokens:generate. Do not edit. */',
    ':root {',
    ...declarations,
    '}',
    '',
  ].join('\n')
}

function renderTailwindCss(manifest: TokenManifest): string {
  const mappings = publicSemanticTokens(manifest)
    .flatMap((token) => {
      const variable = tailwindVariable(token)
      return variable ? [`  ${variable}: var(${semanticCssVariable(token)});`] : []
    })
  return [
    '/* Generated internal Tailwind mappings. These utility names are not a public SDK contract. */',
    '@theme inline {',
    ...mappings,
    '}',
    '',
  ].join('\n')
}

function tokenFamily(token: ResolvedToken): string {
  const segments = token.path.split('.')
  if (segments[1] === 'color') return 'Color'
  if (segments[1] === 'layout' && segments[2] === 'space') return 'Layout space'
  if (segments[1] === 'motion') return 'Motion'
  if (segments[1] === 'radius') return 'Radius'
  if (segments[1] === 'state') return 'State'
  if (segments[1] === 'typography') return 'Typography'
  if (segments[1] === 'elevation') return 'Elevation'
  return segments[1]?.replace(/(^|-)([a-z])/g, (_match, prefix: string, letter: string) => (
    `${prefix ? ' ' : ''}${letter.toUpperCase()}`
  )) ?? 'Other'
}

function publicTokenMetadata(manifest: TokenManifest) {
  const byPath = new Map(manifest.tokens.map((token) => [token.path, token]))
  return publicSemanticTokens(manifest).map((token) => {
    const [sourcePath, pointer = ''] = token.source.split('#')
    const contrastTarget = token.contrast ? byPath.get(token.contrast.against) : undefined
    return {
      name: token.path,
      family: tokenFamily(token),
      type: token.type,
      visibility: token.visibility,
      cssVariable: semanticCssVariable(token),
      cssValue: tokenCssValue(token),
      tailwindVariable: tailwindVariable(token) ?? null,
      description: token.description ?? 'Intent not yet documented.',
      contrast: token.contrast && contrastTarget
        ? {
            ...token.contrast,
            againstCssVariable: semanticCssVariable(contrastTarget),
          }
        : null,
      source: token.source,
      sourceUrl: `https://github.com/markhayden/bakin/blob/main/${sourcePath}`,
      sourcePointer: `#${pointer}`,
    }
  })
}

function renderTokenMetadata(manifest: TokenManifest): string {
  const metadata = publicTokenMetadata(manifest)
  return [
    '// Generated by bun run ui:tokens:generate. Do not edit.',
    `export const BAKIN_SEMANTIC_TOKENS = ${JSON.stringify(metadata, null, 2)} as const`,
    '',
    "export type BakinSemanticTokenName = typeof BAKIN_SEMANTIC_TOKENS[number]['name']",
    "export type BakinSemanticCssVariable = typeof BAKIN_SEMANTIC_TOKENS[number]['cssVariable']",
    '',
  ].join('\n')
}

const TOKEN_CATALOG_CSS = `
.bakin-token-catalog {
  min-height: 100vh;
  background: var(--bakin-color-canvas-default);
  color: var(--bakin-color-text-primary);
  padding: var(--bakin-layout-space-8);
  font-family: var(--bakin-typography-family-ui);
}
.bakin-token-catalog * { box-sizing: border-box; }
.bakin-token-catalog__content { width: min(100%, 76rem); margin: 0 auto; }
.bakin-token-catalog__eyebrow {
  margin: 0 0 var(--bakin-layout-space-2);
  color: var(--bakin-color-signal-accent);
  font-size: .75rem;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.bakin-token-catalog h1 {
  margin: 0;
  font-size: clamp(2rem, 6vw, 3.75rem);
  line-height: 1;
  letter-spacing: -.045em;
}
.bakin-token-catalog__lede {
  max-width: 46rem;
  margin: var(--bakin-layout-space-3) 0 0;
  color: var(--bakin-color-text-muted);
  font-size: 1rem;
  line-height: 1.65;
}
.bakin-token-catalog__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bakin-layout-space-2);
  margin: var(--bakin-layout-space-6) 0 var(--bakin-layout-space-8);
}
.bakin-token-catalog__summary span,
.bakin-token-catalog__status {
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--bakin-radius-pill);
  padding: var(--bakin-layout-space-1) var(--bakin-layout-space-3);
  background: var(--bakin-color-surface-default);
  color: var(--bakin-color-text-muted);
  font-size: .75rem;
  font-weight: 600;
}
.bakin-token-family { margin-top: var(--bakin-layout-space-8); }
.bakin-token-family h2 {
  margin: 0 0 var(--bakin-layout-space-3);
  font-size: 1.125rem;
  letter-spacing: -.015em;
}
.bakin-token-family__rows { border-top: 1px solid var(--bakin-color-border-subtle); }
.bakin-token-row {
  display: grid;
  grid-template-columns: minmax(17rem, 1.15fr) minmax(18rem, .85fr);
  gap: var(--bakin-layout-space-6);
  align-items: center;
  border-bottom: 1px solid var(--bakin-color-border-subtle);
  padding: var(--bakin-layout-space-4) 0;
}
.bakin-token-row > *, .bakin-token-row__identity > * { min-width: 0; }
.bakin-token-row__identity {
  display: grid;
  grid-template-columns: 3rem minmax(0, 1fr);
  gap: var(--bakin-layout-space-3);
  align-items: center;
}
.bakin-token-row code,
.bakin-token-row__value {
  font-family: var(--bakin-typography-family-mono);
  font-size: .78rem;
  overflow-wrap: anywhere;
}
.bakin-token-row__label { display: block; font-size: .9375rem; font-weight: 600; line-height: 1.25; }
.bakin-token-row__name { display: block; color: var(--bakin-color-text-primary); }
.bakin-token-row__intent {
  margin: var(--bakin-layout-space-1) 0 0;
  color: var(--bakin-color-text-muted);
  font-size: .82rem;
  line-height: 1.5;
}
.bakin-token-row__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--bakin-layout-space-1) var(--bakin-layout-space-3);
  margin: 0;
  font-size: .75rem;
  line-height: 1.45;
  min-width: 0;
}
.bakin-token-row__facts dt { color: var(--bakin-color-text-muted); }
.bakin-token-row__facts dd { min-width: 0; margin: 0; }
.bakin-token-row__facts a { color: var(--bakin-color-action-primary-background); }
.bakin-token-row__facts dd, .bakin-token-row__facts a, .bakin-token-row__facts code { overflow-wrap: anywhere; }
.bakin-token-row__facts a:focus-visible {
  outline: 2px solid var(--bakin-color-focus-ring);
  outline-offset: 3px;
  border-radius: var(--bakin-radius-control);
}
.bakin-token-preview {
  --token-value: initial;
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--bakin-radius-control);
  background: var(--bakin-color-surface-default);
}
.bakin-token-preview--color { background: var(--token-value); }
.bakin-token-preview--space span { display: block; width: max(2px, var(--token-value)); height: .5rem; background: var(--bakin-color-signal-highlight); }
.bakin-token-preview--radius span { width: 2rem; height: 2rem; border: 2px solid var(--bakin-color-signal-accent); border-radius: var(--token-value); }
.bakin-token-preview--opacity span { width: 2rem; height: 2rem; border-radius: var(--bakin-radius-control); background: var(--bakin-color-action-primary-background); opacity: var(--token-value); }
.bakin-token-preview--value { color: var(--bakin-color-text-muted); font-family: var(--bakin-typography-family-mono); font-size: .65rem; text-align: center; }
.bakin-token-group { margin-top: var(--bakin-layout-space-4); }
.bakin-token-group h3 {
  margin: 0 0 var(--bakin-layout-space-2);
  color: var(--bakin-color-text-muted);
  font-size: .72rem;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.bakin-token-swatch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
  gap: var(--bakin-layout-space-3);
}
.bakin-token-swatch { display: grid; gap: var(--bakin-layout-space-1); align-content: start; min-width: 0; }
.bakin-token-swatch__chip {
  height: 3.25rem;
  border-radius: var(--bakin-radius-control);
  background: var(--token-value);
  box-shadow: inset 0 0 0 1px var(--bakin-color-border-subtle);
}
.bakin-token-swatch__name {
  font-family: var(--bakin-typography-family-mono);
  font-size: .7rem;
  color: var(--bakin-color-text-primary);
  overflow-wrap: anywhere;
}
.bakin-token-swatch__value {
  font-family: var(--bakin-typography-family-mono);
  font-size: .66rem;
  color: var(--bakin-color-text-muted);
  overflow-wrap: anywhere;
}
.bakin-type-specimen {
  display: grid;
  grid-template-columns: minmax(11rem, 15rem) minmax(0, 1fr);
  gap: var(--bakin-layout-space-6);
  align-items: baseline;
  border-bottom: 1px solid var(--bakin-color-border-subtle);
  padding: var(--bakin-layout-space-3) 0;
}
.bakin-type-specimen__meta { display: grid; gap: var(--bakin-layout-space-1); min-width: 0; }
.bakin-type-specimen__meta code {
  font-family: var(--bakin-typography-family-mono);
  font-size: .78rem;
  color: var(--bakin-color-text-primary);
  overflow-wrap: anywhere;
}
.bakin-type-specimen__meta span {
  font-family: var(--bakin-typography-family-mono);
  font-size: .68rem;
  color: var(--bakin-color-text-muted);
  overflow-wrap: anywhere;
}
.bakin-type-specimen__sample { margin: 0; font-size: 1rem; line-height: 1.3; overflow-wrap: anywhere; }
.bakin-token-specs { margin-top: var(--bakin-layout-space-4); }
.bakin-token-specs > summary {
  display: inline-block;
  cursor: pointer;
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--bakin-radius-pill);
  padding: var(--bakin-layout-space-1) var(--bakin-layout-space-3);
  background: var(--bakin-color-surface-default);
  color: var(--bakin-color-text-muted);
  font-size: .75rem;
  font-weight: 600;
}
.bakin-token-specs > summary:focus-visible {
  outline: 2px solid var(--bakin-color-focus-ring);
  outline-offset: 3px;
}
.bakin-token-specs[open] > summary { margin-bottom: var(--bakin-layout-space-2); }
@media (max-width: 44rem) {
  .bakin-token-catalog { padding: var(--bakin-layout-space-4); }
  .bakin-token-row { grid-template-columns: 1fr; gap: var(--bakin-layout-space-3); }
  .bakin-token-row__facts { padding-left: 0; }
  .bakin-type-specimen { grid-template-columns: 1fr; gap: var(--bakin-layout-space-2); }
}
@media (prefers-reduced-motion: reduce) {
  .bakin-token-catalog *, .bakin-token-catalog *::before, .bakin-token-catalog *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
`.trim()

function renderTokenStory(manifest: TokenManifest): string {
  const metadata = publicTokenMetadata(manifest)
  const familyCount = new Set(metadata.map((token) => token.family)).size
  return `// Generated by bun run ui:tokens:generate. Do not edit.
import type { CSSProperties } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

const TOKENS = ${JSON.stringify(metadata, null, 2)} as const
const CATALOG_CSS = ${JSON.stringify(TOKEN_CATALOG_CSS)}
const FAMILIES: string[] = [...new Set(TOKENS.map((token) => token.family))]

type Token = (typeof TOKENS)[number]

const LEAD_FAMILIES = ['Color', 'Typography']
const ORDERED_FAMILIES = [
  ...LEAD_FAMILIES.filter((family) => FAMILIES.includes(family)),
  ...FAMILIES.filter((family) => !LEAD_FAMILIES.includes(family)),
]

const COLOR_TOKENS = TOKENS.filter((token) => token.family === 'Color')
const COLOR_GROUP_ORDER = ['Canvas', 'Surface', 'Border', 'Text', 'Action', 'Signal', 'Focus', 'Data series', 'Data status']

function colorShortName(token: Token): string {
  return token.name.replace('semantic.color.', '')
}

function tokenLabel(path: string): string {
  const segments = path.replace('semantic.', '').split('.')
  const tail = segments.slice(-2).join(' ')
  return tail.charAt(0).toUpperCase() + tail.slice(1)
}

function colorGroupName(token: Token): string {
  const segments = token.name.split('.')
  const head = segments[2] ?? 'color'
  if (head === 'data') return segments[3] === 'status' ? 'Data status' : 'Data series'
  return head.charAt(0).toUpperCase() + head.slice(1)
}

const COLOR_GROUPS = [
  ...COLOR_GROUP_ORDER,
  ...COLOR_TOKENS.map(colorGroupName).filter((group) => !COLOR_GROUP_ORDER.includes(group)),
]
  .filter((group, index, groups) => groups.indexOf(group) === index)
  .map((group) => ({ group, tokens: COLOR_TOKENS.filter((token) => colorGroupName(token) === group) }))
  .filter((entry) => entry.tokens.length > 0)

function byName(left: Token, right: Token): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

const SIZE_TOKENS = TOKENS.filter((token) => token.name.startsWith('semantic.typography.size.'))
  .sort((left, right) => Number.parseFloat(right.cssValue) - Number.parseFloat(left.cssValue) || byName(left, right))
const WEIGHT_TOKENS = TOKENS.filter((token) => token.name.startsWith('semantic.typography.weight.'))
  .sort((left, right) => Number.parseFloat(left.cssValue) - Number.parseFloat(right.cssValue) || byName(left, right))
const FAMILY_TOKENS = TOKENS.filter((token) => token.name.startsWith('semantic.typography.family.'))

const SPECIMEN_TEXT = 'The quick brown fox jumps over the lazy dog.'

function typographyShortName(token: Token): string {
  return token.name.replace('semantic.typography.', '')
}

function specimenSample(token: Token): string {
  return token.name.split('.').pop() + '. ' + SPECIMEN_TEXT
}

function specimenDetail(token: Token): string {
  if (!token.cssValue.endsWith('rem')) return token.cssValue
  const px = Math.round(Number.parseFloat(token.cssValue) * 1600) / 100
  return token.cssValue + ' · ' + px + 'px'
}

function TokenPreview({ token }: { token: Token }) {
  const style = { '--token-value': 'var(' + token.cssVariable + ')' } as CSSProperties
  if (token.type === 'color') return <span className="bakin-token-preview bakin-token-preview--color" style={style} aria-hidden="true" />
  if (token.family === 'Layout space') return <span className="bakin-token-preview bakin-token-preview--space" style={style} aria-hidden="true"><span /></span>
  if (token.family === 'Radius') return <span className="bakin-token-preview bakin-token-preview--radius" style={style} aria-hidden="true"><span /></span>
  if (token.name === 'semantic.state.opacity.disabled') return <span className="bakin-token-preview bakin-token-preview--opacity" style={style} aria-hidden="true"><span /></span>
  return <span className="bakin-token-preview bakin-token-preview--value" aria-hidden="true">{token.cssValue}</span>
}

function contrastText(token: Token): string {
  if (!token.contrast) return 'Not applicable'
  const threshold = token.contrast.minimum === null
    ? 'reference only'
    : token.contrast.standard + ' ≥ ' + token.contrast.minimum + ':1 · pass'
  return token.contrast.ratio + ':1 vs ' + token.contrast.againstCssVariable + ' · ' + threshold
}

function TokenSpecRow({ token }: { token: Token }) {
  return (
    <article className="bakin-token-row" aria-label={token.name}>
      <div className="bakin-token-row__identity">
        <TokenPreview token={token} />
        <div>
          <strong className="bakin-token-row__label">{tokenLabel(token.name)}</strong>
          <code className="bakin-token-row__name">{token.name}</code>
          <p className="bakin-token-row__intent">{token.description}</p>
        </div>
      </div>
      <dl className="bakin-token-row__facts">
        <dt>Value</dt><dd className="bakin-token-row__value">{token.cssValue}</dd>
        <dt>Property</dt><dd><code>{token.cssVariable}</code></dd>
        <dt>Status</dt><dd><span className="bakin-token-catalog__status">Public semantic</span></dd>
        <dt>Contrast</dt><dd>{contrastText(token)}</dd>
        <dt>Source</dt><dd><a href={token.sourceUrl} target="_blank" rel="noreferrer">semantic.tokens.json{token.sourcePointer}</a></dd>
      </dl>
    </article>
  )
}

function FamilySpec({ family, tokens }: { family: string; tokens: Token[] }) {
  return (
    <details className="bakin-token-specs">
      <summary>{'View full spec — ' + family}</summary>
      <div className="bakin-token-family__rows">
        {tokens.map((token) => <TokenSpecRow token={token} key={token.name} />)}
      </div>
    </details>
  )
}

function SpecimenRow({ token, detail, sampleStyle }: { token: Token; detail: string; sampleStyle: CSSProperties }) {
  return (
    <div className="bakin-type-specimen">
      <div className="bakin-type-specimen__meta">
        <code>{typographyShortName(token)}</code>
        <span>{detail}</span>
      </div>
      <p className="bakin-type-specimen__sample" style={sampleStyle}>{specimenSample(token)}</p>
    </div>
  )
}

function ColorSection({ id, tokens }: { id: string; tokens: Token[] }) {
  return (
    <section className="bakin-token-family" aria-labelledby={id}>
      <h2 id={id}>Color</h2>
      {COLOR_GROUPS.map((entry) => (
        <div className="bakin-token-group" key={entry.group}>
          <h3>{entry.group}</h3>
          <div className="bakin-token-swatch-grid">
            {entry.tokens.map((token) => (
              <div className="bakin-token-swatch" key={token.name}>
                <span className="bakin-token-swatch__chip" style={{ '--token-value': 'var(' + token.cssVariable + ')' } as CSSProperties} aria-hidden="true" />
                <code className="bakin-token-swatch__name">{colorShortName(token)}</code>
                <span className="bakin-token-swatch__value">{token.cssValue}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <FamilySpec family="Color" tokens={tokens} />
    </section>
  )
}

function TypographySection({ id, tokens }: { id: string; tokens: Token[] }) {
  return (
    <section className="bakin-token-family" aria-labelledby={id}>
      <h2 id={id}>Typography</h2>
      <div className="bakin-token-group">
        <h3>Type scale</h3>
        <div>
          {SIZE_TOKENS.map((token) => (
            <SpecimenRow token={token} detail={specimenDetail(token)} sampleStyle={{ fontSize: 'var(' + token.cssVariable + ')' }} key={token.name} />
          ))}
        </div>
      </div>
      <div className="bakin-token-group">
        <h3>Weights</h3>
        <div>
          {WEIGHT_TOKENS.map((token) => (
            <SpecimenRow token={token} detail={token.cssValue} sampleStyle={{ fontWeight: 'var(' + token.cssVariable + ')' } as CSSProperties} key={token.name} />
          ))}
        </div>
      </div>
      <div className="bakin-token-group">
        <h3>Families</h3>
        <div>
          {FAMILY_TOKENS.map((token) => (
            <SpecimenRow token={token} detail={token.cssValue} sampleStyle={{ fontFamily: 'var(' + token.cssVariable + ')' }} key={token.name} />
          ))}
        </div>
      </div>
      <FamilySpec family="Typography" tokens={tokens} />
    </section>
  )
}

function SpecFamilySection({ id, family, tokens }: { id: string; family: string; tokens: Token[] }) {
  return (
    <section className="bakin-token-family" aria-labelledby={id}>
      <h2 id={id}>{family}</h2>
      <div className="bakin-token-family__rows">
        {tokens.map((token) => <TokenSpecRow token={token} key={token.name} />)}
      </div>
    </section>
  )
}

function SemanticTokenCatalog() {
  return (
    <main className="bakin-token-catalog" aria-labelledby="semantic-token-catalog-title">
      <style>{CATALOG_CSS}</style>
      <div className="bakin-token-catalog__content">
        <header>
          <p className="bakin-token-catalog__eyebrow">Foundation / public contract</p>
          <h1 id="semantic-token-catalog-title">Token reference</h1>
          <p className="bakin-token-catalog__lede">Namespaced properties for plugin and product UI. Internal reference values and component aliases are intentionally excluded from the author contract.</p>
          <div className="bakin-token-catalog__summary" aria-label="Catalog summary">
            <span>{TOKENS.length} public tokens</span>
            <span>{FAMILIES.length} semantic families</span>
            <span>Generated from DTCG JSON</span>
          </div>
        </header>
        {ORDERED_FAMILIES.map((family) => {
          const familyId = 'token-family-' + family.toLowerCase().replaceAll(' ', '-')
          const familyTokens = TOKENS.filter((token) => token.family === family)
          if (family === 'Color') return <ColorSection id={familyId} tokens={familyTokens} key={family} />
          if (family === 'Typography') return <TypographySection id={familyId} tokens={familyTokens} key={family} />
          return <SpecFamilySection id={familyId} family={family} tokens={familyTokens} key={family} />
        })}
      </div>
    </main>
  )
}

const meta = {
  title: 'Tokens/Reference',
  component: SemanticTokenCatalog,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'The generated public semantic token contract as a browsable style guide: ${metadata.length} tokens across ${familyCount} families. Color leads with labeled swatch grids grouped by semantic role and Typography renders every type token as a specimen at its real size, weight, and family; both keep their complete spec rows — value, namespaced CSS custom property, status, contrast evidence, and DTCG source pointer — under a View full spec disclosure, while every other family documents the same spec rows inline. Internal reference values and component aliases are excluded. Regenerated by bun run ui:tokens:generate from packages/ui/tokens/semantic.tokens.json — edit the source tokens, never this file.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'reduced-motion'],
  },
} satisfies Meta<typeof SemanticTokenCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const Catalog: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('heading', { name: 'Token reference' })).toBeVisible()
    await expect(canvas.getByText(colorShortName(COLOR_TOKENS[0]))).toBeVisible()
    await expect(canvas.getByText(specimenSample(SIZE_TOKENS[0]))).toBeVisible()
    await userEvent.click(canvas.getByText('View full spec — Color'))
    await expect(canvas.getByRole('article', { name: COLOR_TOKENS[0].name })).toBeVisible()
    await expect(canvas.getByText(COLOR_TOKENS[0].cssVariable)).toBeVisible()
  },
}
`
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ').trim()
}

function renderTokenDocs(manifest: TokenManifest): string {
  const metadata = publicTokenMetadata(manifest)
  const families = [...new Set(metadata.map((token) => token.family))]
  const foundationStatus = manifest.sourceStatus === 'approved'
    ? 'The approved foundation contains'
    : 'The current candidate contains'
  const sections = families.flatMap((family) => {
    const rows = metadata.filter((token) => token.family === family).map((token) => {
      const contrast = token.contrast
        ? `${token.contrast.ratio}:1 vs \`${token.contrast.againstCssVariable}\`; ${token.contrast.minimum === null ? 'reference comparison' : `${token.contrast.standard} ≥ ${token.contrast.minimum}:1; pass`}`
        : 'Not applicable'
      const source = `[semantic.tokens.json](${token.sourceUrl}) \`${token.sourcePointer}\``
      return `| \`${token.name}\` | ${escapeMarkdownCell(token.description)} | \`${token.cssValue}\` | \`${token.cssVariable}\` | Public semantic | ${contrast} | ${source} |`
    })
    return [
      `## ${family}`,
      '',
      '| Token | Intent | Value | CSS property | Status | Contrast | Source |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...rows,
      '',
    ]
  })
  return [
    '---',
    'title: Semantic UI Tokens',
    'description: Generated public semantic token contract for Bakin product and plugin interfaces.',
    '---',
    '',
    'This reference is generated from the DTCG token source. Use the namespaced CSS properties through [`@makinbakin/sdk/styles.css`](/docs/extending/ui/overview/); internal reference values, component aliases, and Tailwind mappings are not plugin-author contracts.',
    '',
    `${foundationStatus} **${metadata.length} public tokens** across **${families.length} semantic families**. Contrast ratios are calculated during generation. A declared WCAG role below its threshold fails generation and CI.`,
    '',
    ...sections,
  ].join('\n')
}

const CONTRAST_ROLES: Record<TokenContrastRole, { minimum: number | null; standard: string }> = {
  'normal-text': { minimum: 4.5, standard: 'WCAG AA normal text' },
  'non-text': { minimum: 3, standard: 'WCAG AA non-text UI' },
  reference: { minimum: null, standard: 'Reference comparison' },
}

function colorComponents(token: ResolvedToken): [number, number, number] {
  if (!isObject(token.value) || !Array.isArray(token.value.components) || token.value.components.length !== 3) {
    throw new Error(`${token.source}: resolved color is invalid`)
  }
  if (token.value.alpha !== undefined && token.value.alpha !== 1) {
    throw new Error(`${token.source}: contrast specimens require opaque color tokens`)
  }
  return token.value.components as [number, number, number]
}

function relativeLuminance(token: ResolvedToken): number {
  const [red, green, blue] = colorComponents(token).map((component) => (
    component <= 0.04045
      ? component / 12.92
      : ((component + 0.055) / 1.055) ** 2.4
  )) as [number, number, number]
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function colorContrastRatio(left: ResolvedToken, right: ResolvedToken): number {
  const leftLuminance = relativeLuminance(left)
  const rightLuminance = relativeLuminance(right)
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05)
}

function attachContrastMetadata(
  rawTokens: ReadonlyMap<string, RawToken>,
  resolvedTokens: ResolvedToken[],
): void {
  const resolvedByPath = new Map(resolvedTokens.map((token) => [token.path, token]))
  for (const token of resolvedTokens) {
    const raw = rawTokens.get(token.path) as RawToken
    const extensionValue = raw.extensions?.[LAYER_EXTENSION]
    if (extensionValue === undefined) continue
    if (!isObject(extensionValue)) {
      sourceError(
        raw.sourcePath,
        `${raw.pointer}/$extensions/${pointerSegment(LAYER_EXTENSION)}`,
        `${LAYER_EXTENSION} token metadata must be an object`,
      )
    }
    const hasContrastAgainst = Object.hasOwn(extensionValue, 'contrastAgainst')
    const hasContrastRole = Object.hasOwn(extensionValue, 'contrastRole')
    if (!hasContrastAgainst && !hasContrastRole) continue
    if (token.type !== 'color') {
      sourceError(
        raw.sourcePath,
        `${raw.pointer}/$extensions/${pointerSegment(LAYER_EXTENSION)}`,
        'contrast metadata is valid only on color tokens',
      )
    }
    if (typeof extensionValue.contrastAgainst !== 'string' || extensionValue.contrastAgainst.length === 0) {
      sourceError(
        raw.sourcePath,
        `${raw.pointer}/$extensions/${pointerSegment(LAYER_EXTENSION)}/contrastAgainst`,
        'contrastAgainst must name a public semantic color token',
      )
    }
    if (
      typeof extensionValue.contrastRole !== 'string'
      || !Object.hasOwn(CONTRAST_ROLES, extensionValue.contrastRole)
    ) {
      sourceError(
        raw.sourcePath,
        `${raw.pointer}/$extensions/${pointerSegment(LAYER_EXTENSION)}/contrastRole`,
        'contrastRole must be "normal-text", "non-text", or "reference"',
      )
    }
    const target = resolvedByPath.get(extensionValue.contrastAgainst)
    if (!target || target.visibility !== 'public' || target.type !== 'color') {
      sourceError(
        raw.sourcePath,
        `${raw.pointer}/$extensions/${pointerSegment(LAYER_EXTENSION)}/contrastAgainst`,
        `contrast target "${extensionValue.contrastAgainst}" must be a public semantic color token`,
      )
    }
    if (target.path === token.path) {
      sourceError(
        raw.sourcePath,
        `${raw.pointer}/$extensions/${pointerSegment(LAYER_EXTENSION)}/contrastAgainst`,
        'a color token cannot contrast against itself',
      )
    }
    const role = extensionValue.contrastRole as TokenContrastRole
    const contract = CONTRAST_ROLES[role]
    const rawRatio = colorContrastRatio(token, target)
    const ratio = Math.round(rawRatio * 100) / 100
    if (contract.minimum !== null && rawRatio < contract.minimum) {
      sourceError(
        raw.sourcePath,
        `${raw.pointer}/$extensions/${pointerSegment(LAYER_EXTENSION)}/contrastRole`,
        `${ratio}:1 contrast against ${target.path} does not meet the ${contract.standard} minimum of ${contract.minimum}:1`,
      )
    }
    token.contrast = {
      against: target.path,
      role,
      ratio,
      minimum: contract.minimum,
      standard: contract.standard,
      status: contract.minimum === null ? 'reference' : 'pass',
    }
  }
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

  const results = [...tokens.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(resolveToken)
  attachContrastMetadata(tokens, results)
  return results
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

interface RenderedTokenArtifacts {
  manifest: TokenManifest
  files: Array<{ path: string; content: string }>
}

function renderTokenArtifacts(sources: readonly TokenSourceFile[]): RenderedTokenArtifacts {

/**
 * Token data for the hand-written Tokens/* specimen stories. The public
 * Storybook catalog may only import from storybook/{public,fixtures,support},
 * so the generated token records are mirrored here; ui:tokens:check keeps
 * this file from drifting like every other generated artifact.
 */
function renderTokenStoryData(manifest: TokenManifest): string {
  const header = '// Generated by bun run ui:tokens:generate -- do not edit.'
  const iface = [
    'export interface GeneratedStoryToken {',
    '  path: string',
    '  layer: string',
    '  visibility: string',
    '  type: string',
    '  value: unknown',
    '  source: string',
    '  references: readonly string[]',
    '  description?: string',
    '  contrast?: { ratio: number; status: string; standard: string; [extra: string]: unknown }',
    '}',
  ].join('\n')
  const rows = JSON.stringify(manifest.tokens, null, 2)
  return `${header}\n\n${iface}\n\nexport const GENERATED_TOKENS: readonly GeneratedStoryToken[] = ${rows}\n`
}

  const manifest = compileTokenSources(sources)
  assertNoGeneratedNameCollisions(manifest)
  return {
    manifest,
    files: [
      { path: TOKEN_OUTPUT_PATH, content: `${JSON.stringify(manifest, null, 2)}\n` },
      { path: TOKEN_RUNTIME_CSS_OUTPUT_PATH, content: renderRuntimeCss(manifest) },
      { path: TOKEN_TAILWIND_OUTPUT_PATH, content: renderTailwindCss(manifest) },
      { path: TOKEN_METADATA_OUTPUT_PATH, content: renderTokenMetadata(manifest) },
      { path: TOKEN_STORY_OUTPUT_PATH, content: renderTokenStory(manifest) },
      { path: TOKEN_STORY_DATA_OUTPUT_PATH, content: renderTokenStoryData(manifest) },
      { path: TOKEN_DOCS_OUTPUT_PATH, content: renderTokenDocs(manifest) },
    ],
  }
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
  const rendered = renderTokenArtifacts(sources)
  for (const file of rendered.files) {
    const output = join(root, file.path)
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, file.content)
  }
  return summary(rendered.manifest)
}

export function checkTokenArtifacts(root = REPO_ROOT): { tokens: number; publicTokens: number } {
  const sources = loadTokenSources(root)
  const expected = renderTokenArtifacts(sources)
  const repeated = renderTokenArtifacts(sources)
  for (let index = 0; index < expected.files.length; index++) {
    const file = expected.files[index]
    const repeatedFile = repeated.files[index]
    if (file.path !== repeatedFile?.path || file.content !== repeatedFile.content) {
      throw new Error('token generation is nondeterministic for the current sources')
    }
    const output = join(root, file.path)
    if (!existsSync(output)) throw new Error(`missing ${file.path}; run bun run ui:tokens:generate`)
    if (readFileSync(output, 'utf-8') !== file.content) {
      throw new Error(`${file.path} is stale; run bun run ui:tokens:generate`)
    }
  }
  return summary(expected.manifest)
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
