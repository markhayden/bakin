import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('public asset, model, and color picker patterns', () => {
  it('publishes controlled presentation contracts from the focused patterns entrypoint', () => {
    const patterns = read('packages/sdk/src/patterns/index.ts')
    const pickers = read('packages/sdk/src/patterns/picker-patterns.tsx')

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
    expect(pickers).not.toMatch(/(?:bg|text|border)-(?:red|yellow|green|blue|gray|zinc|slate)-/)
  })

  it('retains endpoints, upload mechanics, and catalog compatibility only in root adapters', () => {
    const asset = read('src/components/asset-picker.tsx')
    const model = read('src/components/model-select.tsx')
    const color = read('src/components/color-picker.tsx')

    expect(asset).toContain("from '@makinbakin/sdk/patterns'")
    expect(asset).toContain("fetch('/api/plugins/assets/versioned')")
    expect(asset).toContain("fetch('/api/plugins/assets/upload'")
    expect(asset).toContain('useFileDrop')
    expect(model).toContain("from '@makinbakin/sdk/patterns'")
    expect(model).toContain('AvailableModel')
    expect(color).toContain("from '@makinbakin/sdk/patterns'")
  })
})
