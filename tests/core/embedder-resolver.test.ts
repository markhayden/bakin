import { describe, it, expect } from 'vitest'
import { resolveEmbedder, embeddersHash } from '../../src/core/embedder-resolver'
import type { BakinSettings } from '../../packages/core/src/settings'

function makeSettings(embedders: Record<string, { provider: string; model: string }>): BakinSettings {
  return {
    antfly: {
      embedders,
    },
  } as unknown as BakinSettings
}

describe('embedder-resolver', () => {
  describe('resolveEmbedder', () => {
    it('resolves the default ref', () => {
      const settings = makeSettings({
        default: { provider: 'antfly', model: 'bge-small-en-v1.5' },
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
      })

      expect(resolveEmbedder('default', settings)).toEqual({
        provider: 'antfly',
        model: 'bge-small-en-v1.5',
      })
    })

    it('resolves the visual ref', () => {
      const settings = makeSettings({
        default: { provider: 'antfly', model: 'bge-small-en-v1.5' },
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
      })

      expect(resolveEmbedder('visual', settings)).toEqual({
        provider: 'antfly',
        model: 'clip-vit-base-patch32',
      })
    })

    it('resolves a custom ref when one is defined', () => {
      const settings = makeSettings({
        default: { provider: 'antfly', model: 'bge-small-en-v1.5' },
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
        highres: { provider: 'vertex', model: 'multimodalembedding@001' },
      })

      expect(resolveEmbedder('highres', settings)).toEqual({
        provider: 'vertex',
        model: 'multimodalembedding@001',
      })
    })

    it('throws on unknown refs with a message listing available refs', () => {
      const settings = makeSettings({
        default: { provider: 'antfly', model: 'a' },
        visual: { provider: 'antfly', model: 'b' },
      })

      expect(() => resolveEmbedder('nonsense', settings)).toThrow(/Unknown embedder ref "nonsense"/)
      expect(() => resolveEmbedder('nonsense', settings)).toThrow(/default/)
      expect(() => resolveEmbedder('nonsense', settings)).toThrow(/visual/)
    })

    it('returns a new object on each call (defensive copy)', () => {
      const settings = makeSettings({
        default: { provider: 'antfly', model: 'bge-small-en-v1.5' },
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
      })

      const a = resolveEmbedder('default', settings)
      a.model = 'tampered'
      const b = resolveEmbedder('default', settings)
      expect(b.model).toBe('bge-small-en-v1.5')
    })
  })

  describe('embeddersHash', () => {
    it('produces a stable hash regardless of key order', () => {
      const a = makeSettings({
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
        default: { provider: 'antfly', model: 'bge-small-en-v1.5' },
      })
      const b = makeSettings({
        default: { provider: 'antfly', model: 'bge-small-en-v1.5' },
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
      })

      expect(embeddersHash(a)).toBe(embeddersHash(b))
    })

    it('changes when any embedder changes', () => {
      const base = makeSettings({
        default: { provider: 'antfly', model: 'bge-small-en-v1.5' },
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
      })
      const changedDefault = makeSettings({
        default: { provider: 'antfly', model: 'all-MiniLM-L6-v2' },
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
      })
      const changedVisual = makeSettings({
        default: { provider: 'antfly', model: 'bge-small-en-v1.5' },
        visual: { provider: 'vertex', model: 'multimodalembedding@001' },
      })

      expect(embeddersHash(base)).not.toBe(embeddersHash(changedDefault))
      expect(embeddersHash(base)).not.toBe(embeddersHash(changedVisual))
    })

    it('changes when a new embedder is added', () => {
      const before = makeSettings({
        default: { provider: 'antfly', model: 'bge-small-en-v1.5' },
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
      })
      const after = makeSettings({
        default: { provider: 'antfly', model: 'bge-small-en-v1.5' },
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
        highres: { provider: 'vertex', model: 'multimodalembedding@001' },
      })

      expect(embeddersHash(before)).not.toBe(embeddersHash(after))
    })
  })
})
