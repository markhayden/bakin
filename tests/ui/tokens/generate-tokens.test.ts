import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  checkTokenArtifacts,
  compileTokenSources,
  generateTokenArtifacts,
  renderTokenManifest,
  TOKEN_OUTPUT_PATH,
  TOKEN_SOURCE_FILES,
  type TokenLayer,
  type TokenSourceFile,
} from '../../../scripts/ui/generate-tokens'

const fixtureRoots: string[] = []

function source(layer: TokenLayer, document: Record<string, unknown>): TokenSourceFile {
  return { path: `${layer}.tokens.json`, layer, document }
}

function layerDocument(layer: TokenLayer, contents: Record<string, unknown>): Record<string, unknown> {
  return {
    $extensions: {
      'dev.bakin.tokens': {
        layer,
        status: 'candidate',
      },
    },
    [layer]: contents,
  }
}

function reverseObjectOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectOrder)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, entry]) => [key, reverseObjectOrder(entry)]),
  )
}

function validSources(): TokenSourceFile[] {
  return [
    source('reference', layerDocument('reference', {
      color: {
        $type: 'color',
        ink: {
          $value: {
            colorSpace: 'srgb',
            components: [0.058824, 0.054902, 0.054902],
            hex: '#0f0e0e',
          },
        },
      },
      space: {
        $type: 'dimension',
        compact: { $value: { value: 0.5, unit: 'rem' } },
      },
    })),
    source('semantic', layerDocument('semantic', {
      canvas: {
        $type: 'color',
        $description: 'The application canvas.',
        $value: '{reference.color.ink}',
      },
      controlGap: {
        $ref: '#/reference/space/compact',
      },
    })),
    source('component', layerDocument('component', {
      button: {
        background: { $value: '{semantic.canvas}' },
        gap: { $ref: '#/semantic/controlGap' },
      },
    })),
  ]
}

function writeSourceTree(root: string, sources = validSources()): void {
  for (const entry of sources) {
    const relativePath = TOKEN_SOURCE_FILES[entry.layer]
    const target = join(root, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${JSON.stringify(entry.document, null, 2)}\n`)
  }
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('compileTokenSources', () => {
  it('resolves DTCG aliases across three mechanically distinct layers', () => {
    const manifest = compileTokenSources(validSources())

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      format: 'DTCG 2025.10',
      generatedBy: 'bun run ui:tokens:generate',
    })
    expect(manifest.tokens.map((token) => ({
      path: token.path,
      layer: token.layer,
      visibility: token.visibility,
      type: token.type,
    }))).toEqual([
      { path: 'component.button.background', layer: 'component', visibility: 'internal', type: 'color' },
      { path: 'component.button.gap', layer: 'component', visibility: 'internal', type: 'dimension' },
      { path: 'reference.color.ink', layer: 'reference', visibility: 'internal', type: 'color' },
      { path: 'reference.space.compact', layer: 'reference', visibility: 'internal', type: 'dimension' },
      { path: 'semantic.canvas', layer: 'semantic', visibility: 'public', type: 'color' },
      { path: 'semantic.controlGap', layer: 'semantic', visibility: 'public', type: 'dimension' },
    ])

    const canvas = manifest.tokens.find((token) => token.path === 'semantic.canvas')
    expect(canvas).toMatchObject({
      source: 'semantic.tokens.json#/semantic/canvas',
      description: 'The application canvas.',
      references: ['reference.color.ink'],
      value: {
        colorSpace: 'srgb',
        components: [0.058824, 0.054902, 0.054902],
        hex: '#0f0e0e',
      },
    })
  })

  it('emits the same bytes regardless of source and object insertion order', () => {
    const forwards = validSources()
    const backwards = [...validSources()].reverse().map((entry) => ({
      ...entry,
      document: reverseObjectOrder(entry.document) as Record<string, unknown>,
    }))

    expect(renderTokenManifest(forwards)).toBe(renderTokenManifest(backwards))
  })

  it('validates the planned DTCG typography and shadow composite types', () => {
    const sources = validSources()
    sources[0] = source('reference', layerDocument('reference', {
      color: {
        $type: 'color',
        shadow: { $value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.25 } },
      },
      font: {
        family: { $type: 'fontFamily', sans: { $value: ['Inter', 'sans-serif'] } },
        size: { $type: 'dimension', body: { $value: { value: 1, unit: 'rem' } } },
        weight: { $type: 'fontWeight', strong: { $value: 600 } },
      },
      text: {
        $type: 'typography',
        body: {
          $value: {
            fontFamily: { $ref: '#/reference/font/family/sans/$value' },
            fontSize: { $ref: '#/reference/font/size/body/$value' },
            fontWeight: '{reference.font.weight.strong}',
            letterSpacing: { value: 0, unit: 'px' },
            lineHeight: 1.5,
          },
        },
      },
      shadow: {
        $type: 'shadow',
        raised: {
          $value: {
            color: { $ref: '#/reference/color/shadow/$value' },
            offsetX: { value: 0, unit: 'px' },
            offsetY: { value: 0.25, unit: 'rem' },
            blur: { value: 0.5, unit: 'rem' },
            spread: { value: 0, unit: 'px' },
            inset: false,
          },
        },
      },
    }))
    sources[1] = source('semantic', layerDocument('semantic', {}))
    sources[2] = source('component', layerDocument('component', {}))

    const manifest = compileTokenSources(sources)
    expect(manifest.tokens.find((token) => token.path === 'reference.text.body')?.type).toBe('typography')
    expect(manifest.tokens.find((token) => token.path === 'reference.shadow.raised')?.type).toBe('shadow')

    const invalidInset = structuredClone(sources)
    const shadow = invalidInset[0].document.reference as Record<string, unknown>
    const raised = (shadow.shadow as Record<string, unknown>).raised as Record<string, unknown>
    ;(raised.$value as Record<string, unknown>).inset = 'false'
    expect(() => compileTokenSources(invalidInset)).toThrow(
      'reference.tokens.json#/reference/shadow/raised/$value: shadow inset must be a boolean when present',
    )
  })

  it('rejects missing aliases and cycles with source pointers', () => {
    const missing = validSources()
    missing[1] = source('semantic', layerDocument('semantic', {
      canvas: { $type: 'color', $value: '{reference.color.missing}' },
    }))
    expect(() => compileTokenSources(missing)).toThrow(
      'semantic.tokens.json#/semantic/canvas/$value: unknown token reference "reference.color.missing"',
    )

    const cyclic = validSources()
    cyclic[1] = source('semantic', layerDocument('semantic', {
      first: { $type: 'color', $value: '{semantic.second}' },
      second: { $type: 'color', $value: '{semantic.first}' },
    }))
    cyclic[2] = source('component', layerDocument('component', {}))
    expect(() => compileTokenSources(cyclic)).toThrow(
      'semantic.tokens.json#/semantic/second/$value: circular token reference: semantic.first -> semantic.second -> semantic.first',
    )
  })

  it('rejects values and aliases whose resolved type is wrong', () => {
    const wrongValue = validSources()
    wrongValue[0] = source('reference', layerDocument('reference', {
      space: { $type: 'dimension', compact: { $value: '0.5rem' } },
    }))
    wrongValue[1] = source('semantic', layerDocument('semantic', {
      controlGap: { $value: '{reference.space.compact}' },
    }))
    wrongValue[2] = source('component', layerDocument('component', {}))
    expect(() => compileTokenSources(wrongValue)).toThrow(
      'reference.tokens.json#/reference/space/compact/$value: dimension must be an object with finite value and unit "px" or "rem"',
    )

    const wrongAlias = validSources()
    wrongAlias[1] = source('semantic', layerDocument('semantic', {
      canvas: { $type: 'dimension', $value: '{reference.color.ink}' },
    }))
    wrongAlias[2] = source('component', layerDocument('component', {}))
    expect(() => compileTokenSources(wrongAlias)).toThrow(
      'semantic.tokens.json#/semantic/canvas/$type: declared type "dimension" does not match referenced type "color"',
    )
  })

  it('blocks public raw values and cross-layer escapes', () => {
    const rawPublic = validSources()
    rawPublic[1] = source('semantic', layerDocument('semantic', {
      canvas: {
        $type: 'color',
        $value: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' },
      },
    }))
    rawPublic[2] = source('component', layerDocument('component', {}))
    expect(() => compileTokenSources(rawPublic)).toThrow(
      'semantic.tokens.json#/semantic/canvas/$value: public semantic tokens must alias reference or semantic tokens; raw values are internal',
    )

    const componentLeak = validSources()
    componentLeak[2] = source('component', layerDocument('component', {
      button: { background: { $value: '{reference.color.ink}' } },
    }))
    expect(() => compileTokenSources(componentLeak)).toThrow(
      'component.tokens.json#/component/button/background/$value: component tokens may reference only semantic or component tokens; received reference.color.ink',
    )

    const referenceLeak = validSources()
    referenceLeak[0] = source('reference', layerDocument('reference', {
      color: {
        $type: 'color',
        ink: {
          $value: {
            colorSpace: 'srgb',
            components: [0.058824, 0.054902, 0.054902],
            hex: '#0f0e0e',
          },
        },
      },
      space: {
        $type: 'dimension',
        compact: { $value: { value: 0.5, unit: 'rem' } },
      },
      leaked: { $type: 'color', $value: '{semantic.canvas}' },
    }))
    expect(() => compileTokenSources(referenceLeak)).toThrow(
      'reference.tokens.json#/reference/leaked/$value: reference tokens may reference only reference tokens; received semantic.canvas',
    )
  })

  it('rejects a file whose declared layer and root group do not match', () => {
    const sources = validSources()
    sources[1] = source('semantic', layerDocument('reference', {}))

    expect(() => compileTokenSources(sources)).toThrow(
      'semantic.tokens.json#/$extensions/dev.bakin.tokens/layer: expected layer "semantic", received "reference"',
    )
  })

  it('validates document-root DTCG properties instead of silently ignoring them', () => {
    const sources = validSources()
    sources[0].document.$description = false

    expect(() => compileTokenSources(sources)).toThrow(
      'reference.tokens.json#/$description: $description must be a string',
    )

    sources[0].document.$description = 'Reference values.'
    sources[0].document.$unknown = true
    expect(() => compileTokenSources(sources)).toThrow(
      'reference.tokens.json#/$unknown: unknown group property "$unknown"',
    )
  })
})

describe('token artifact generation', () => {
  it('detects missing and stale output without changing the working tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'bakin-token-generator-'))
    fixtureRoots.push(root)
    writeSourceTree(root)

    expect(() => checkTokenArtifacts(root)).toThrow(`missing ${TOKEN_OUTPUT_PATH}`)
    generateTokenArtifacts(root)
    expect(checkTokenArtifacts(root)).toEqual({ tokens: 6, publicTokens: 2 })

    const output = join(root, TOKEN_OUTPUT_PATH)
    const generated = readFileSync(output, 'utf-8')
    writeFileSync(output, generated.replace('DTCG 2025.10', 'stale'))
    expect(() => checkTokenArtifacts(root)).toThrow(
      `${TOKEN_OUTPUT_PATH} is stale; run bun run ui:tokens:generate`,
    )
  })
})
