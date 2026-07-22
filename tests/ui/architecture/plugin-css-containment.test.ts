import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postcss from 'postcss'

import {
  PluginCssValidationError,
  processBuiltPluginCss,
  transformPluginCss,
} from '../../../src/core/whiskit/plugin-css'

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('transformPluginCss', () => {
  it('rejects an invalid plugin id before interpolating it into CSS', () => {
    expect(() => transformPluginCss({
      pluginId: 'demo"] body',
      from: '/plugins/demo/dist/client.css',
      css: '.card{display:grid}',
    })).toThrow(/Invalid plugin id/)
  })

  it('scopes every selector to the owning plugin root and localizes root variables', () => {
    const result = transformPluginCss({
      pluginId: 'demo',
      from: '/plugins/demo/dist/client.css',
      css: ':root{--demo-gap:1rem}.card,.toolbar:hover{display:grid}',
    })

    expect(result.css).toContain(':where([data-bakin-plugin="demo"]){--demo-gap:1rem}')
    expect(result.css).toContain(':where([data-bakin-plugin="demo"]) .card')
    expect(result.css).toContain(':where([data-bakin-plugin="demo"]) .toolbar:hover')
  })

  it('preserves an explicitly correct owner selector without double-prefixing it', () => {
    const result = transformPluginCss({
      pluginId: 'demo',
      from: '/plugins/demo/dist/client.css',
      css: '[data-bakin-plugin="demo"] .card{display:grid}',
    })

    expect(result.css).toBe('[data-bakin-plugin="demo"] .card{display:grid}')
  })

  it('is idempotent when a fresh cached artifact is validated again', () => {
    const input = {
      pluginId: 'demo',
      from: '/plugins/demo/dist/client.css',
      css: '@keyframes pulse{to{opacity:1}}.card{animation:pulse 1s}',
    }
    const once = transformPluginCss(input)
    const twice = transformPluginCss({ ...input, css: once.css })

    expect(twice.css).toBe(once.css)
  })

  it.each([
    [
      'ownership hidden in a selector branch',
      ':is([data-bakin-plugin="demo"],.outside){display:grid}',
    ],
    [
      'ownership followed by a sibling escape',
      '[data-bakin-plugin="demo"] + .outside{display:grid}',
    ],
    [
      'mixed exact and generic ownership selectors',
      '[data-bakin-plugin="demo"] [data-bakin-plugin] .card{display:grid}',
    ],
  ])('rejects %s instead of trusting any owner-attribute mention', (_label, css) => {
    expect(() => transformPluginCss({
      pluginId: 'demo',
      from: '/plugins/demo/dist/client.css',
      css,
    })).toThrow(/ownership selector/)
  })

  it('namespaces keyframes and rewrites animation references', () => {
    const result = transformPluginCss({
      pluginId: 'demo',
      from: '/plugins/demo/dist/client.css',
      css: '@keyframes dashdraw{to{opacity:1}}.edge{animation:dashdraw .5s linear;animation-name:dashdraw}',
    })

    expect(result.css).toContain('@keyframes bakin-plugin-demo-dashdraw')
    expect(result.css).toContain('animation:bakin-plugin-demo-dashdraw .5s linear')
    expect(result.css).toContain('animation-name:bakin-plugin-demo-dashdraw')
  })

  it.each([
    ['document selector', 'body .card{display:block}', /document selector "body"/],
    ['generic ownership selector', '[data-bakin-plugin] .card{display:block}', /generic or complex ownership selector/],
    ['cross-plugin selector', '[data-bakin-plugin="other"] .card{display:block}', /targets plugin "other"/],
    ['font declaration', '@font-face{font-family:Demo;src:url(demo.woff2)}', /must not declare global fonts/],
    ['global import', '@import url("https://example.com/theme.css");', /must not retain @import/],
    ['copied SDK token definition', ':root{--bakin-canvas:red}', /must not declare reserved design-system property/],
    ['cross-plugin asset', '.card{background:url("/api/plugins/other/assets/texture.png")}', /asset owned by plugin "other"/],
  ])('rejects an unsafe %s with actionable guidance', (_label, css, expected) => {
    expect(() => transformPluginCss({
      pluginId: 'demo',
      from: '/plugins/demo/dist/client.css',
      css,
    })).toThrow(expected)
  })

  it('maps diagnostics back to the original CSS source', async () => {
    const sourcePath = '/plugins/demo/styles/domain.css'
    const builtPath = '/plugins/demo/dist/client.css'
    const compiled = await postcss().process('body .card { display: block }', {
      from: sourcePath,
      to: builtPath,
      map: { annotation: false, inline: false },
    })

    try {
      transformPluginCss({
        pluginId: 'demo',
        from: builtPath,
        css: compiled.css,
        sourceMap: compiled.map.toString(),
      })
      throw new Error('expected CSS validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(PluginCssValidationError)
      expect((error as Error).message).toContain(`${sourcePath}:1:1`)
    }
  })

  it('recovers author source locations from Bun CSS section comments', () => {
    const root = mkdtempSync(join(tmpdir(), 'bakin-plugin-css-source-'))
    fixtureRoots.push(root)
    const sourcePath = join(root, 'domain.css')
    writeFileSync(sourcePath, 'body .card{display:block}')

    expect(() => transformPluginCss({
      pluginId: 'demo',
      from: join(root, 'dist', 'client.css'),
      sourceRoot: root,
      css: '/* domain.css */\nbody .card {\n  display: block;\n}',
    })).toThrow(`${sourcePath}:1:1`)
  })
})

describe('processBuiltPluginCss', () => {
  it('rewrites the emitted stylesheet and removes transient build maps', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakin-plugin-css-'))
    fixtureRoots.push(root)
    const distDir = join(root, 'dist')
    mkdirSync(distDir, { recursive: true })
    writeFileSync(join(distDir, 'client.css'), '.card{display:grid}')
    writeFileSync(join(distDir, 'client.css.map'), '{}')
    writeFileSync(join(distDir, 'client.js.map'), '{}')

    const result = await processBuiltPluginCss({ pluginId: 'demo', distDir })

    expect(result.processed).toBe(true)
    expect(readFileSync(join(distDir, 'client.css'), 'utf-8')).toContain(
      ':where([data-bakin-plugin="demo"]) .card',
    )
    expect(existsSync(join(distDir, 'client.css.map'))).toBe(false)
    expect(existsSync(join(distDir, 'client.js.map'))).toBe(false)
  })

  it('is a no-op for plugins without emitted CSS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakin-plugin-css-'))
    fixtureRoots.push(root)

    await expect(processBuiltPluginCss({ pluginId: 'demo', distDir: root })).resolves.toEqual({
      processed: false,
    })
  })
})
