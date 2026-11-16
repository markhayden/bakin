/**
 * Entity links are built from the owning plugin's manifest declaration
 * (`entityHref`), never written out by hand.
 *
 * The banned shapes are derived from what the core plugins declare: a
 * template or concatenation that starts with a declared href's prefix and
 * puts an id straight after it (`\`/tasks?taskId=\${id}\``,
 * `'/assets/' + id`). A different route that shares the prefix is not an
 * entity link and is allowed (`/workflows/\${id}/edit`, `/team/teams/\${id}`).
 * A declared route with several placeholders is matched whole. Known limits:
 * a link assembled from a base variable, `.concat` or `.join` is not seen.
 * The ESLint block "no hand-built entity links" in eslint.config.mjs mirrors
 * this for in-editor feedback; keep the two in step.
 *
 * Pure scanner: imports no app modules.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../..')
const SCAN = ['plugins', 'packages/host/src', 'packages/sdk/src', 'packages/ui/src', 'src']
/** Route tables name routes by pattern; they are definitions, not links. */
const EXEMPT = [/\/routes\//, /route-shadow\.ts$/, /\/dist\//, /\/tests\//, /\/node_modules\//, /\/public\//]

/** Every href template the core plugins declare. */
function declaredHrefs(): string[] {
  const hrefs: string[] = []
  for (const pluginId of readdirSync(join(ROOT, 'plugins'))) {
    const manifestPath = join(ROOT, 'plugins', pluginId, 'bakin-plugin.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { contributes?: { entities?: Array<{ href: string }> } }
    for (const entity of manifest.contributes?.entities ?? []) hrefs.push(entity.href)
  }
  return hrefs
}

/** `/tasks?taskId={id}` → `/tasks?taskId=` — the text an id is appended to. */
function declaredPrefixes(): string[] {
  const prefixes = new Set<string>()
  for (const pluginId of readdirSync(join(ROOT, 'plugins'))) {
    const manifestPath = join(ROOT, 'plugins', pluginId, 'bakin-plugin.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { contributes?: { entities?: Array<{ href: string }> } }
    for (const entity of manifest.contributes?.entities ?? []) prefixes.add(entity.href.slice(0, entity.href.indexOf('{')))
  }
  return [...prefixes]
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * A declared route with more than one placeholder (`/brands/{brandId}/docs/{kind}/{name}`)
 * as a template-literal pattern: each placeholder is one `${…}`. The prefix
 * check alone lets these through, because the text after the first id looks
 * like a sub-route.
 */
function compoundPatterns(hrefs: readonly string[]): RegExp[] {
  return hrefs
    .filter((href) => (href.match(/\{/g) ?? []).length > 1)
    .map((href) => new RegExp('`' + href.split(/\{[A-Za-z][A-Za-z0-9]*\}/).map(escape).join('\\$\\{[^`]*?\\}') + '[^`]*`', 'g'))
}

export function findHandBuiltEntityHrefs(source: string, prefixes: readonly string[], hrefs: readonly string[] = []): string[] {
  const found: string[] = []
  for (const pattern of compoundPatterns(hrefs)) {
    for (const match of source.matchAll(pattern)) found.push(match[0])
  }
  for (const prefix of prefixes) {
    // `/prefix${expr}` in a template — unless the route continues past the id.
    const template = new RegExp(`\`${escape(prefix)}\\$\\{[^\`]*\``, 'g')
    for (const match of source.matchAll(template)) {
      const afterId = match[0].slice(match[0].indexOf('}', prefix.length) + 1)
      if (/^\/[a-z]/.test(afterId)) continue // a sub-route such as /edit
      found.push(match[0])
    }
    // '/prefix' + expr
    const concat = new RegExp(`['"]${escape(prefix)}['"]\\s*\\+`, 'g')
    for (const match of source.matchAll(concat)) found.push(match[0])
  }
  return found
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (EXEMPT.some((pattern) => pattern.test(`${path}/`) || pattern.test(path))) return []
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('no hand-built entity links', () => {
  const prefixes = declaredPrefixes()
  const hrefs = declaredHrefs()

  test('the declared kinds give the scanner something to look for', () => {
    expect(prefixes).toEqual(expect.arrayContaining(['/tasks?taskId=', '/assets/', '/schedule?jobId=', '/workflows/', '/brands/', '/chat/', '/team/']))
  })

  test('the scanner catches templates and concatenations, and lets sub-routes through', () => {
    const sample = [
      'router.push(`/tasks?taskId=${encodeURIComponent(id)}`)',
      "const href = '/assets/' + assetId",
      'to={`/team/${agent.id}?tab=diagnostics`}',
      'router.push(`/workflows/${id}/edit`)',
      'router.push(`/team/teams/${teamId}`)',
      "router.push('/tasks')",
      'const path = `/brands/${brandId}/docs/${kind}/${name}`',
    ].join('\n')
    expect(findHandBuiltEntityHrefs(sample, prefixes, hrefs).sort()).toEqual([
      "'/assets/' +",
      '`/brands/${brandId}/docs/${kind}/${name}`',
      '`/tasks?taskId=${encodeURIComponent(id)}`',
      '`/team/${agent.id}?tab=diagnostics`',
    ])
  })

  test('no source file builds an entity link by hand', () => {
    const offenders: string[] = []
    for (const dir of SCAN) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        for (const hit of findHandBuiltEntityHrefs(readFileSync(file, 'utf8'), prefixes, hrefs)) {
          offenders.push(`${file.slice(ROOT.length + 1)}: ${hit}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
