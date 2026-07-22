import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import postcss, { list, type AtRule, type Node, type Rule } from 'postcss'
import { PLUGIN_ID_RE } from '@bakin/core/plugins/manifest'

const PLUGIN_OWNER_ATTRIBUTE = 'data-bakin-plugin'
const KEYFRAME_NAME = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/
const DOCUMENT_SELECTOR = /(^|[\s>+~,(])(?:html|body)(?=$|[\s>+~.#:[,)])/i
const CROSS_PLUGIN_ASSET = /\/api\/plugins\/([a-z][a-z0-9-]{0,39})\/assets\//g

export interface TransformPluginCssInput {
  pluginId: string
  css: string
  from: string
  sourceMap?: string
  /** Base directory Bun used when writing source labels into bundled CSS. */
  sourceRoot?: string
}

export interface TransformPluginCssResult {
  css: string
}

export interface ProcessBuiltPluginCssInput {
  pluginId: string
  distDir: string
  /** Plugin source directory; used to resolve Bun's retained CSS source labels. */
  sourceRoot?: string
}

export interface ProcessBuiltPluginCssResult {
  processed: boolean
}

export interface PluginCssDiagnostic {
  code:
    | 'cross-plugin-asset'
    | 'cross-plugin-selector'
    | 'document-selector'
    | 'font-declaration'
    | 'global-import'
    | 'invalid-keyframes'
    | 'reserved-property'
  file: string
  line: number
  column: number
  message: string
  suggestion: string
}

export class PluginCssValidationError extends Error {
  readonly pluginId: string
  readonly diagnostics: readonly PluginCssDiagnostic[]

  constructor(pluginId: string, diagnostics: readonly PluginCssDiagnostic[]) {
    super([
      `Plugin CSS validation failed for "${pluginId}":`,
      ...diagnostics.map((diagnostic) => (
        `- [${diagnostic.code}] ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ` +
        `${diagnostic.message} ${diagnostic.suggestion}`
      )),
    ].join('\n'))
    this.name = 'PluginCssValidationError'
    this.pluginId = pluginId
    this.diagnostics = diagnostics
  }
}

function ownerSelector(pluginId: string): string {
  return `:where([${PLUGIN_OWNER_ATTRIBUTE}="${pluginId}"])`
}

function diagnostic(
  node: Node,
  code: PluginCssDiagnostic['code'],
  message: string,
  suggestion: string,
  sourceRoot?: string,
): PluginCssDiagnostic {
  const start = node.source?.start ?? { line: 1, column: 1 }
  const input = node.source?.input
  const origin = input?.origin(start.line, start.column) || undefined
  const bundledOrigin = origin ? undefined : bunBundledOrigin(node, sourceRoot)
  return {
    code,
    file: origin?.file ?? bundledOrigin?.file ?? input?.file ?? input?.from ?? '<plugin-css>',
    line: origin?.line ?? bundledOrigin?.line ?? start.line,
    column: origin ? Math.max(1, origin.column) : (bundledOrigin?.column ?? start.column),
    message,
    suggestion,
  }
}

/**
 * Bun currently emits source maps for client.js but not for extracted
 * client.css. It does retain a source comment before every bundled CSS
 * section, though, so recover the author-facing file and section-relative
 * location from that marker. If Bun adds CSS maps, PostCSS's `origin()` path
 * above takes precedence automatically.
 */
function bunBundledOrigin(
  node: Node,
  sourceRoot?: string,
): { file: string; line: number; column: number } | undefined {
  if (!sourceRoot) return undefined

  let section: Node = node
  while (section.parent && section.parent.type !== 'root') section = section.parent
  const siblings = section.parent?.nodes
  if (!siblings) return undefined

  const sectionIndex = siblings.findIndex((candidate) => candidate === section)
  for (let index = sectionIndex - 1; index >= 0; index -= 1) {
    const candidate = siblings[index]
    if (candidate.type !== 'comment') continue
    const label = candidate.text.trim()
    if (!/\.css(?:\?.*)?$/i.test(label)) continue

    const candidates = isAbsolute(label)
      ? [label]
      : [resolve(sourceRoot, label), resolve(process.cwd(), label)]
    const file = candidates.find((path) => existsSync(path)) ?? candidates[0]
    const markerEndLine = candidate.source?.end?.line ?? candidate.source?.start?.line ?? 0
    return {
      file,
      line: Math.max(1, startLine(node) - markerEndLine),
      column: Math.max(1, node.source?.start?.column ?? 1),
    }
  }
  return undefined
}

function startLine(node: Node): number {
  return node.source?.start?.line ?? 1
}

function ownerReferences(selector: string): {
  hasOwnerAttribute: boolean
  hasUnqualifiedOwnerAttribute: boolean
  owners: string[]
} {
  const ownerAttributeCount = selector.match(/\[\s*data-bakin-plugin\b/gi)?.length ?? 0
  const owners: string[] = []
  const exactOwner = /\[\s*data-bakin-plugin\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\]\s]+))\s*\]/g
  for (const match of selector.matchAll(exactOwner)) {
    owners.push(match[1] ?? match[2] ?? match[3])
  }
  return {
    hasOwnerAttribute: ownerAttributeCount > 0,
    hasUnqualifiedOwnerAttribute: ownerAttributeCount !== owners.length,
    owners,
  }
}

function leadingOwnerRemainder(selector: string, pluginId: string): string | undefined {
  const escapedPluginId = pluginId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const attribute = `\\[\\s*${PLUGIN_OWNER_ATTRIBUTE}\\s*=\\s*(?:"${escapedPluginId}"|'${escapedPluginId}'|${escapedPluginId})\\s*\\]`
  const match = selector.match(new RegExp(`^(?:${attribute}|:where\\(\\s*${attribute}\\s*\\))`, 'i'))
  return match ? selector.slice(match[0].length).trimStart() : undefined
}

function scopeSelector(
  rule: Rule,
  selector: string,
  pluginId: string,
  diagnostics: PluginCssDiagnostic[],
  sourceRoot?: string,
): string {
  const trimmed = selector.trim()
  const owner = ownerSelector(pluginId)
  const references = ownerReferences(trimmed)

  if (references.hasUnqualifiedOwnerAttribute) {
    diagnostics.push(diagnostic(
      rule,
      'cross-plugin-selector',
      `Selector "${trimmed}" contains a generic or complex ownership selector.`,
      `Remove the ownership selector; Bakin scopes the rule to "${pluginId}" automatically.`,
      sourceRoot,
    ))
    return trimmed
  }

  const foreignOwner = references.owners.find((candidate) => candidate !== pluginId)
  if (foreignOwner) {
    diagnostics.push(diagnostic(
      rule,
      'cross-plugin-selector',
      `Selector "${trimmed}" targets plugin "${foreignOwner}" from plugin "${pluginId}".`,
      'Plugins may style only their own ownership root.',
      sourceRoot,
    ))
    return trimmed
  }

  if (references.hasOwnerAttribute) {
    const remainder = leadingOwnerRemainder(trimmed, pluginId)
    if (remainder === undefined || /^[+~]|^\|\|/.test(remainder)) {
      diagnostics.push(diagnostic(
        rule,
        'cross-plugin-selector',
        `Selector "${trimmed}" does not use its ownership selector as a safe containment anchor.`,
        `Remove the ownership selector; Bakin scopes the rule to "${pluginId}" automatically.`,
        sourceRoot,
      ))
      return trimmed
    }
    return trimmed
  }

  if (DOCUMENT_SELECTOR.test(trimmed) || /:(?:host|global)\b/i.test(trimmed)) {
    const documentMatch = trimmed.match(/\b(?:html|body)\b|:(?:host|global)\b/i)?.[0] ?? trimmed
    diagnostics.push(diagnostic(
      rule,
      'document-selector',
      `Plugin CSS contains document selector "${documentMatch}" in "${trimmed}".`,
      'Target plugin-owned content instead; document and host selectors escape plugin containment.',
      sourceRoot,
    ))
    return trimmed
  }

  if (trimmed === ':root') return owner
  if (trimmed.startsWith(':root ')) return `${owner}${trimmed.slice(':root'.length)}`
  if (trimmed.includes(':root')) {
    diagnostics.push(diagnostic(
      rule,
      'document-selector',
      `Plugin CSS contains unsupported root selector "${trimmed}".`,
      'Declare plugin variables on a standalone :root rule or target plugin-owned content.',
      sourceRoot,
    ))
    return trimmed
  }

  return `${owner} ${trimmed}`
}

function insideKeyframes(rule: Rule): boolean {
  let parent: Node | undefined = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && 'name' in parent && /^(?:-webkit-)?keyframes$/i.test(String(parent.name))) return true
    parent = parent.parent
  }
  return false
}

function replaceIdentifier(value: string, current: string, next: string): string {
  const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return value.replace(
    new RegExp(`(^|[^-_a-zA-Z0-9])${escaped}(?=$|[^-_a-zA-Z0-9])`, 'g'),
    (_match, prefix: string) => `${prefix}${next}`,
  )
}

function validSourceMap(sourceMap: string | undefined): string | undefined {
  if (!sourceMap) return undefined
  try {
    const parsed = JSON.parse(sourceMap) as { mappings?: unknown; sources?: unknown }
    return typeof parsed.mappings === 'string' && Array.isArray(parsed.sources) ? sourceMap : undefined
  } catch {
    return undefined
  }
}

/** Validate global CSS hazards and scope safe rules to one plugin ownership root. */
export function transformPluginCss(input: TransformPluginCssInput): TransformPluginCssResult {
  if (!PLUGIN_ID_RE.test(input.pluginId)) {
    throw new Error(`Invalid plugin id "${input.pluginId}" - must match ${PLUGIN_ID_RE}`)
  }
  const sourceMap = validSourceMap(input.sourceMap)
  const root = postcss.parse(input.css, {
    from: input.from,
    ...(sourceMap ? { map: { prev: sourceMap } } : {}),
  })
  const diagnostics: PluginCssDiagnostic[] = []
  const keyframes = new Map<string, string>()

  root.walkAtRules((atRule: AtRule) => {
    if (/^(?:-webkit-)?keyframes$/i.test(atRule.name)) {
      const current = atRule.params.trim()
      if (!KEYFRAME_NAME.test(current)) {
        diagnostics.push(diagnostic(
          atRule,
          'invalid-keyframes',
          `Keyframe name "${current}" is not a supported CSS identifier.`,
          'Use a plain identifier so Bakin can namespace it safely.',
          input.sourceRoot,
        ))
        return
      }
      const prefix = `bakin-plugin-${input.pluginId}-`
      const next = current.startsWith(prefix) ? current : `${prefix}${current}`
      keyframes.set(current, next)
      atRule.params = next
      return
    }
    if (atRule.name.toLowerCase() === 'font-face') {
      diagnostics.push(diagnostic(
        atRule,
        'font-declaration',
        'Plugin CSS must not declare global fonts with @font-face.',
        'Use the product typography tokens or request a reviewed shared-font contract.',
        input.sourceRoot,
      ))
      return
    }
    if (atRule.name.toLowerCase() === 'import') {
      diagnostics.push(diagnostic(
        atRule,
        'global-import',
        'Built plugin CSS must not retain @import.',
        'Bundle local domain CSS through the plugin client entry and use the host-provided SDK stylesheet.',
        input.sourceRoot,
      ))
    }
  })

  root.walkRules((rule) => {
    if (insideKeyframes(rule)) return
    rule.selectors = list.comma(rule.selector).map((selector) => (
      scopeSelector(rule, selector, input.pluginId, diagnostics, input.sourceRoot)
    ))
  })

  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith('--bakin-')) {
      diagnostics.push(diagnostic(
        declaration,
        'reserved-property',
        `Plugin CSS must not declare reserved design-system property "${declaration.prop}".`,
        'Consume @makinbakin/sdk/styles.css from the host and use a plugin-prefixed custom property for domain values.',
        input.sourceRoot,
      ))
    }

    for (const match of declaration.value.matchAll(CROSS_PLUGIN_ASSET)) {
      const referencedPlugin = match[1]
      if (referencedPlugin === input.pluginId) continue
      diagnostics.push(diagnostic(
        declaration,
        'cross-plugin-asset',
        `Plugin CSS references an asset owned by plugin "${referencedPlugin}".`,
        'Package the asset with the owning plugin or consume it through a documented SDK contract.',
        input.sourceRoot,
      ))
    }

    if (!/^(?:-webkit-)?animation(?:-name)?$/i.test(declaration.prop)) return
    for (const [current, next] of keyframes) {
      declaration.value = replaceIdentifier(declaration.value, current, next)
    }
  })

  if (diagnostics.length > 0) throw new PluginCssValidationError(input.pluginId, diagnostics)
  return { css: root.toString() }
}

/** Process Bun's emitted client.css in place and discard build-only source maps. */
export async function processBuiltPluginCss(
  input: ProcessBuiltPluginCssInput,
): Promise<ProcessBuiltPluginCssResult> {
  const cssPath = join(input.distDir, 'client.css')
  const cssMapPath = join(input.distDir, 'client.css.map')
  const jsMapPath = join(input.distDir, 'client.js.map')
  if (!existsSync(cssPath)) {
    rmSync(cssMapPath, { force: true })
    rmSync(jsMapPath, { force: true })
    return { processed: false }
  }

  const sourceMap = existsSync(cssMapPath) ? readFileSync(cssMapPath, 'utf-8') : undefined
  try {
    const result = transformPluginCss({
      pluginId: input.pluginId,
      from: cssPath,
      css: readFileSync(cssPath, 'utf-8'),
      sourceMap,
      sourceRoot: input.sourceRoot,
    })
    writeFileSync(cssPath, result.css)
    return { processed: true }
  } catch (error) {
    rmSync(cssPath, { force: true })
    throw error
  } finally {
    rmSync(cssMapPath, { force: true })
    rmSync(jsMapPath, { force: true })
  }
}
