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
  // 127.0.0.1, NOT localhost: the server binds IPv4-only, and `localhost`
  // can resolve to ::1 or be intercepted by proxy env vars — anything
  // answering there with non-JSON makes the client fail while the server
  // is perfectly healthy. Dial exactly what we bind.
  url: 'http://127.0.0.1:3738',
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

  // Normalize the localhost spelling of the private-instance URL to the
  // canonical 127.0.0.1 form so every consumer (client baseUrl, readiness
  // probes) dials exactly what the server binds. Settings written before
  // the dial-what-we-bind fix carry the localhost form.
  if (input.url === 'http://localhost:3738') {
    input.url = DEFAULT_SETTINGS.url
  }

  // Per-embedder entries deep-merge over their defaults so a partial
  // override (e.g. a legacy settings.json carrying only provider+model)
  // keeps the default `dimension` — dropping it would make every table
  // create fail, since the v0.2 server requires declared dims.
  const embedders: AntflySettings['embedders'] = { ...DEFAULT_SETTINGS.embedders }
  for (const [name, cfg] of Object.entries(input.embedders ?? {})) {
    embedders[name] = { ...DEFAULT_SETTINGS.embedders[name], ...cfg }
  }

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
    embedders,
    chunking: {
      ...DEFAULT_SETTINGS.chunking,
      ...(input.chunking ?? {}),
    },
  }
}
