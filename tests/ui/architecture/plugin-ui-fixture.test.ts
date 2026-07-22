import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('public plugin UI fixture host contract', () => {
  it('publishes a browser-only testing subpath without mixing it into the Node harness', () => {
    const manifest = JSON.parse(read('packages/sdk/package.json')) as { exports: Record<string, string> }
    const packageBuilder = read('scripts/build-sdk-package.ts')
    const nodeHarness = read('packages/sdk/src/testing/index.ts')
    const browserHarness = read('packages/sdk/src/testing/ui/index.ts')

    expect(manifest.exports['./testing/ui']).toBe('./src/testing/ui/index.ts')
    expect(packageBuilder).toContain("exportPath: './testing/ui'")
    expect(nodeHarness).not.toContain("from './ui'")
    expect(browserHarness).not.toMatch(/from ['"]node:/)
  })

  it('reuses production registration, routing, slot, and ownership contracts', () => {
    const host = read('packages/sdk/src/testing/ui/plugin-ui-fixture-host.tsx')
    const navigation = read('packages/sdk/src/navigation/search-params.ts')
    const hostSearchAdapter = read('packages/host/src/lib/search-params.ts')

    expect(host).toContain("from '../../register'")
    expect(host).toContain("from '../../slots'")
    expect(host).toContain("from '../../internal/plugin-ownership'")
    expect(host).toContain("from '../../navigation/search-params'")
    expect(navigation).toContain('export function parseSearchPlain')
    expect(navigation).toContain('export function stringifySearchPlain')
    expect(hostSearchAdapter).toContain("from '@makinbakin/sdk/internal'")
  })

  it('keeps testing UI out of production plugin externals and the host import map', () => {
    const externals = read('src/core/whiskit/externals.ts')
    const hostHtml = read('packages/host/public/index.html')

    expect(externals).not.toContain("'@makinbakin/sdk/testing/ui'")
    expect(hostHtml).not.toContain('sdk-testing-ui')
  })
})
