import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as PrivatePatterns from '@bakin/ui/patterns'
import * as Patterns from '@makinbakin/sdk/patterns'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('public asset, model, and color picker patterns', () => {
  it('owns controlled picker presentation and its color helper in the private kit', () => {
    const patterns = read('packages/sdk/src/patterns/index.ts')
    for (const file of ['picker-patterns.tsx', 'presentation-color.ts']) {
      expect(existsSync(join(root, `packages/ui/src/patterns/${file}`))).toBe(true)
      expect(existsSync(join(root, `packages/sdk/src/patterns/${file}`))).toBe(false)
    }
    const pickers = read('packages/ui/src/patterns/picker-patterns.tsx')

    for (const symbol of [
      'AssetPicker',
      'ModelSelect',
      'ColorPicker',
      'DEFAULT_MODEL_VALUE',
      'AssetPickerAsset',
      'AssetPickerCollection',
      'ColorPickerOption',
      'ModelSelectOption',
    ]) expect(patterns).toContain(symbol)

    expect(pickers).not.toMatch(/@\/|@makinbakin\/sdk|lucide-react|fetch\(|\/api\/|Date\.now|window\.|document\./)
    expect(pickers).not.toMatch(/from ['"]@bakin\/ui(?:\/patterns)?['"]/)
    expect(pickers).not.toMatch(/(?:bg|text|border)-(?:red|yellow|green|blue|gray|zinc|slate)-/)
  })

  it('publishes the same picker implementations without exposing the internal color helper', () => {
    for (const name of ['AssetPicker', 'ColorPicker', 'DEFAULT_MODEL_VALUE', 'ModelSelect'] as const) {
      expect(Patterns[name]).toBeDefined()
      expect(Patterns[name]).toBe(PrivatePatterns[name])
    }
    expect('safePresentationColor' in Patterns).toBe(false)
    expect('safePresentationColor' in PrivatePatterns).toBe(false)
  })

  it('publishes the library-connected adapter as AssetLibraryPicker (kit-additions batch)', () => {
    const patterns = read('packages/sdk/src/patterns/index.ts')
    const adapter = read('packages/sdk/src/patterns/asset-library-picker.tsx')

    // The data wiring has ONE home: the documented focused export. It
    // composes the presentation AssetPicker and owns the default endpoints.
    expect(patterns).toContain('AssetLibraryPicker')
    expect(adapter).toContain("fetch('/api/plugins/assets/versioned')")
    expect(adapter).toContain("fetch('/api/plugins/assets/upload'")
    expect(adapter).toContain("from '@bakin/ui/patterns'")
    expect(adapter).not.toContain("from './picker-patterns'")
    // Overridable sources keep stories/tests endpoint-free.
    expect(adapter).toContain('loadAssets')
    expect(adapter).toContain('uploadAsset')
  })

  it('the barrel-era picker compatibility adapters stay deleted (P-final)', () => {
    for (const file of ['asset-picker.tsx', 'model-select.tsx', 'color-picker.tsx']) {
      expect(existsSync(join(root, `src/components/${file}`))).toBe(false)
    }
  })
})
