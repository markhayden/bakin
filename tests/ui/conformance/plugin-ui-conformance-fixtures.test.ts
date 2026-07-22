import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const fixture = (name: string, file: string) => resolve(
  ROOT,
  'tests/fixtures/plugin-ui-conformance',
  name,
  file,
)

describe('plugin UI conformance teeth fixtures', () => {
  it('keeps one clean external-style fixture and one seed per promised rule family', () => {
    expect(existsSync(fixture('pass', 'bakin.ui-test.ts'))).toBe(true)
    expect(readFileSync(fixture('pass', 'fixture.tsx'), 'utf8'))
      .toContain("import '@makinbakin/sdk/styles.css'")
    expect(readFileSync(fixture('pass', 'fixture.tsx'), 'utf8'))
      .toContain('role="tab" aria-selected="false" tabIndex={-1}')

    expect(readFileSync(fixture('fail-css', 'plugin.css'), 'utf8')).toContain('body')
    expect(readFileSync(fixture('fail-stylesheet', 'fixture.tsx'), 'utf8'))
      .not.toContain('@makinbakin/sdk/styles.css')
    expect(readFileSync(fixture('fail-stylesheet-duplicate', 'fixture.tsx'), 'utf8')
      .match(/@makinbakin\/sdk\/styles\.css/g)).toHaveLength(2)
    expect(readFileSync(fixture('fail-stylesheet-duplicate', 'plugin.css'), 'utf8'))
      .toContain('--bakin-color-canvas-default')

    const browserSource = readFileSync(fixture('fail-browser', 'fixture.tsx'), 'utf8')
    const browserCss = readFileSync(fixture('fail-browser', 'plugin.css'), 'utf8')
    expect(browserSource).toContain('console.error')
    expect(browserSource).toContain('tabIndex={-1}>Keyboard-locked action')
    expect(browserSource).toContain('<button')
    expect(browserCss).toContain('200vw')
  })
})
