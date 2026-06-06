export interface AntflySettings {
  enabled: boolean
  url: string
  auth?: { username: string; password: string }
  search: {
    strategy: 'rrf' | 'semantic_only' | 'full_text_only'
    defaultLimit: number
    reranker: {
      enabled: boolean
      provider: string
      model: string
    }
  }
  /**
   * `dimension` is required for dense embeddings indexes: the v0.2 server
   * demands declared dims at table-create time (no auto-probe at this RC).
   */
  embedders: Record<string, { provider: string; model: string; dimension: number }>
  chunking: {
    defaultTargetTokens: number
    defaultOverlapTokens: number
  }
}

export const DEFAULT_SETTINGS: AntflySettings = {
  enabled: true,
  // Bakin's private antfly instance — 3737 (bakin) + 1. The SDK owns the
  // /db/v1 path prefix; the base URL must not carry a path suffix.
  url: 'http://localhost:3738',
  search: {
    strategy: 'rrf',
    defaultLimit: 20,
    reranker: {
      // Disabled at v0.2.0-rc.2: invoking the mxbai reranker SIGABRTs the
      // server on both the Metal AND onnx backends (bakin#456). All rerank
      // plumbing stays wired — flip to true when upstream stabilizes.
      enabled: false,
      provider: 'antfly',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
    },
  },
  embedders: {
    default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5', dimension: 384 },
    // Xenova mirror: the openai/ HF repo has no ONNX exports (bakin#456).
    visual: { provider: 'antfly', model: 'Xenova/clip-vit-base-patch32', dimension: 512 },
  },
  chunking: {
    defaultTargetTokens: 200,
    defaultOverlapTokens: 25,
  },
}

export function mergeSettings(raw: Record<string, unknown> | undefined): AntflySettings {
  const input = (raw ?? {}) as Partial<AntflySettings>
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    search: {
      ...DEFAULT_SETTINGS.search,
      ...(input.search ?? {}),
      reranker: {
        ...DEFAULT_SETTINGS.search.reranker,
        ...(input.search?.reranker ?? {}),
      },
    },
    embedders: {
      ...DEFAULT_SETTINGS.embedders,
      ...(input.embedders ?? {}),
    },
    chunking: {
      ...DEFAULT_SETTINGS.chunking,
      ...(input.chunking ?? {}),
    },
  }
}
