import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as PrivateUi from '@bakin/ui'
import * as Layout from '@makinbakin/sdk/layout'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf8')

describe('public layout ownership', () => {
  it('owns PageShell, Stack, and Inline in the private presentation package', () => {
    const files = [
      'packages/ui/src/layout/page-shell.tsx',
      'packages/ui/src/layout/flow.tsx',
    ]
    for (const file of files) expect(existsSync(resolve(REPO_ROOT, file))).toBe(true)

    const source = files.map(read).join('\n')
    expect(source).not.toMatch(/from ['"]@\//)
    expect(source).not.toMatch(/src\/components|sdk\/(?:charts|conversation|patterns)/)
    expect(source).not.toMatch(/lucide|window\.|document\./)
  })

  it('publishes one implementation only through the focused layout entrypoint', () => {
    expect(Layout.PageShell).toBeTypeOf('function')
    expect(Layout.Stack).toBeTypeOf('function')
    expect(Layout.Inline).toBeTypeOf('function')
    expect(Layout.PageShell).toBe(PrivateUi.PageShell)
    expect(Layout.Stack).toBe(PrivateUi.Stack)
    expect(Layout.Inline).toBe(PrivateUi.Inline)

    const layoutIndex = read('packages/sdk/src/layout/index.ts')
    expect(layoutIndex).not.toContain('export *')
    expect(layoutIndex).toContain("from '@bakin/ui/layout'")
    expect(layoutIndex).not.toMatch(/from '@bakin\/ui'/)
    expect(read('packages/ui/package.json')).toContain('"./layout": "./src/layout/index.ts"')
    expect(read('packages/sdk/src/components/index.ts')).not.toMatch(/export\s+\{[^}]*\b(?:PageShell|Stack|Inline)\b/)
  })

  it('keeps layout choices finite instead of exposing arbitrary style values', () => {
    const source = [
      read('packages/ui/src/layout/page-shell.tsx'),
      read('packages/ui/src/layout/flow.tsx'),
    ].join('\n')

    expect(source).toContain("'dense' | 'item' | 'section' | 'page'")
    expect(source).toContain("'content' | 'wide' | 'full'")
    expect(source).not.toMatch(/gap\??:\s*(?:string|number)/)
    expect(source).not.toMatch(/width\??:\s*(?:string|number)/)
    expect(source).not.toMatch(/style=\{\{[^}]+(?:gap|width|padding)/)
  })
})
