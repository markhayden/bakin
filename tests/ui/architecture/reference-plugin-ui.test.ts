import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const PLUGIN_ROOT = resolve(ROOT, 'examples/reference-plugin')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === 'test-results') return []
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('reference plugin UI exemplar', () => {
  it('uses focused SDK UI and canonical controls without host styling access', () => {
    const production = sourceFiles(PLUGIN_ROOT)
      .filter((path) => !path.includes(`${join('tests', '')}`) && !path.endsWith('bakin.ui-test.ts'))
      .map((path) => ({ path: relative(ROOT, path), source: readFileSync(path, 'utf8') }))
    const browser = production.filter(({ path }) => path.endsWith('.tsx') || path.endsWith('/styles.css'))

    expect(browser.some(({ source }) => source.includes("from '@makinbakin/sdk/layout'"))).toBe(true)
    expect(browser.some(({ source }) => source.includes("from '@makinbakin/sdk/patterns'"))).toBe(true)
    expect(browser.some(({ source }) => source.includes("from '@makinbakin/sdk/ui'"))).toBe(true)
    expect(browser.some(({ source }) => source.includes("from '@makinbakin/sdk/conversation'"))).toBe(true)

    const violations = browser.flatMap(({ path, source }) => {
      const findings: string[] = []
      if (source.includes('@makinbakin/sdk/components')) findings.push(`${path}: legacy components barrel`)
      if (/<(?:button|details|input|select|summary|textarea)\b/.test(source)) findings.push(`${path}: raw standard control`)
      if (/@bakin\/|@\/|(?:^|\/)packages\/(?:host|core)/m.test(source)) findings.push(`${path}: private import`)
      if (/className=["'][^"']*(?:\b(?:p|m|gap|space|text|bg|border|rounded|flex|grid|w|h|min|max)-)/.test(source)) {
        findings.push(`${path}: host utility styling`)
      }
      return findings
    })

    expect(violations).toEqual([])
  })

  it('mounts the real page and slot registration in a deterministic conformance fixture', () => {
    const registration = read('examples/reference-plugin/client-registration.tsx')
    const client = read('examples/reference-plugin/client.tsx')
    const fixture = read('examples/reference-plugin/tests/ui.fixture.tsx')
    const config = read('examples/reference-plugin/bakin.ui-test.ts')
    const repositoryGate = read('scripts/ui/verify-plugin-conformance.ts')
    const manifest = JSON.parse(read('examples/reference-plugin/bakin-plugin.json')) as {
      contributes: {
        clientRoutes?: Array<{ path?: string }>
        routes?: Array<{ path?: string }>
        slots?: string[]
      }
    }
    const pkg = JSON.parse(read('examples/reference-plugin/package.json')) as {
      scripts?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(registration).toContain("routes: { '/reference-bookmarks': BookmarksPage }")
    expect(registration).toContain("'home-widget': BookmarksWidget")
    expect(client).toContain('registerPlugin(referenceBookmarksRegistration)')
    expect(fixture).toContain('registrations={[referenceBookmarksRegistration]}')
    expect(fixture).toContain("slots={[{ name: 'home-widget'")
    expect(fixture.match(/@makinbakin\/sdk\/styles\.css/g)).toHaveLength(1)
    expect(productionCanonicalStylesheetImports()).toBe(0)
    expect(config).toContain("fixtureEntry: './tests/ui.fixture.tsx'")
    expect(repositoryGate).toContain("fixtureEntry: 'examples/reference-plugin/tests/ui.fixture.tsx'")
    expect(manifest.contributes.routes).toContainEqual(expect.objectContaining({ path: '/reference-bookmarks' }))
    expect(manifest.contributes.clientRoutes).toContainEqual(expect.objectContaining({ path: '/reference-bookmarks' }))
    expect(manifest.contributes.slots).toContain('home-widget')
    expect(pkg.scripts?.['test:ui']).toBe('bakin-plugin-test-ui')
    expect(pkg.devDependencies?.['axe-core']).toBeDefined()
    expect(pkg.devDependencies?.playwright).toBeDefined()
  })

  it('documents the Storybook-first path and explicit deviation rule for copy-paste consumers', () => {
    const readme = read('examples/reference-plugin/README.md')

    expect(readme).toContain('bun run test:ui')
    expect(readme).toContain('Recipes/List and detail pages')
    expect(readme).toContain('Forms/Field and form composition')
    expect(readme).toContain('States/System feedback')
    expect(readme).toContain('human-readable explanation')
  })
})

function productionCanonicalStylesheetImports(): number {
  return sourceFiles(PLUGIN_ROOT)
    .filter((path) => !path.includes(`${join('tests', '')}`))
    .reduce((count, path) => count + (readFileSync(path, 'utf8').match(/@makinbakin\/sdk\/styles\.css/g)?.length ?? 0), 0)
}
