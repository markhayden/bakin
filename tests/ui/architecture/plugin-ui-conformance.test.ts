import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('public plugin UI conformance architecture', () => {
  it('publishes a focused API and executable without pulling it into browser production entrypoints', () => {
    const sdkPackage = JSON.parse(read('packages/sdk/package.json')) as {
      exports: Record<string, string>
      bin: Record<string, string>
      peerDependenciesMeta: Record<string, { optional?: boolean }>
    }
    const rootPackage = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    const browserHarness = read('packages/sdk/src/testing/ui/index.ts')
    const conformance = read('packages/sdk/src/testing/ui/conformance/index.ts')

    expect(sdkPackage.exports['./testing/ui/conformance'])
      .toBe('./src/testing/ui/conformance/index.ts')
    expect(sdkPackage.bin['bakin-plugin-test-ui'])
      .toBe('./src/testing/ui/conformance/cli.ts')
    expect(sdkPackage.peerDependenciesMeta.playwright.optional).toBe(true)
    expect(sdkPackage.peerDependenciesMeta['axe-core'].optional).toBe(true)
    expect(rootPackage.scripts['ui:test:conformance'])
      .toBe('bun run scripts/ui/verify-plugin-conformance.ts')
    expect(browserHarness).not.toContain("from './conformance'")
    expect(conformance).toContain("await import('./runner')")
  })

  it('uses the exact packaging CSS validator and pins its isolated authoring id contract', () => {
    const manifest = read('packages/core/src/plugins/manifest.ts')
    const validator = read('packages/sdk/src/testing/ui/conformance/plugin-css.ts')
    const contracts = read('packages/sdk/src/testing/ui/conformance/contracts.ts')
    const pluginId = read('packages/sdk/src/testing/ui/conformance/plugin-id.ts')
    const adapter = read('src/core/whiskit/plugin-css.ts')
    const manifestRegex = manifest.match(/PLUGIN_ID_RE = (\/\^.*?\/)/)?.[1]
    const authoringRegex = pluginId.match(/PUBLISHED_PLUGIN_ID_PATTERN = (\/\^.*?\/)/)?.[1]

    expect(authoringRegex).toBe(manifestRegex)
    expect(pluginId).toContain("AUTHOR_TEMPLATE_PLUGIN_ID = '_template'")
    expect(validator).toContain("from './plugin-id'")
    expect(contracts).toContain("from './plugin-id'")
    expect(adapter).toContain("from '@makinbakin/sdk/testing/ui/conformance'")
    expect(adapter).not.toContain('postcss')
  })

  it('makes plugin fixture verification part of full conformance and CI evidence', () => {
    const conformance = read('scripts/ui/conformance.ts')
    const workflow = read('.github/workflows/ui-visual.yml')
    const skill = read('.claude/skills/bakin-ui-conformance/SKILL.md')
    const reference = read('.claude/skills/bakin-ui-conformance/references/conformance-contract.md')

    expect(conformance).toContain("['bun', 'run', 'ui:test:conformance']")
    expect(workflow).toContain('run: bun run ui:test:conformance')
    expect(workflow).toContain('test-results/plugin-ui-conformance')
    expect(skill).toContain('run its `bun run test:ui` fixture')
    expect(reference).toContain("Run the plugin's `bun run test:ui` fixture")
  })

  it('does not let outline-none neutralize SDK keyboard focus rings', () => {
    const offenders = [
      ...sourceFiles(resolve(ROOT, 'packages/ui/src')),
      ...sourceFiles(resolve(ROOT, 'src/components')),
    ].flatMap((file) => readFileSync(file, 'utf8').split('\n').flatMap((line, index) => (
      /focus-visible:outline-[12]/.test(line) && !line.includes('focus-visible:outline-solid')
        ? [`${file}:${index + 1}`]
        : []
    )))

    expect(offenders).toEqual([])
  })
})
