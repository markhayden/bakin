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
   *
   * `api_url` and `multimodal` are optional pass-throughs to antfly's
   * EmbedderConfig: `api_url` routes that embedder's calls over HTTP to the
   * named inference endpoint (e.g. the private instance's own /ai/v1)
   * instead of the in-process runtime; `multimodal` declares non-text
   * content support for models outside antfly's built-in registry. Both are
   * documented antfly fields forwarded verbatim — unset entries omit them.
   */
  embedders: Record<string, {
    provider: string
    model: string
    dimension: number
    api_url?: string
    multimodal?: boolean
  }>
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
      // Still disabled at v0.2.0-rc.9, but for a NEW reason. The rc.2 mxbai
      // SIGABRT (bakin#456) IS fixed — the reranker no longer crashes the server
      // and ranks correctly (live-verified: relevant doc 0.998 vs 0.0006). It
      // stays OFF because it's throughput-bound: ~200ms per candidate on Metal
      // (linear — 5 docs ~1.3s, 20 ~4s, 100 ~28s), it serializes (one Metal
      // queue, so concurrent reranked queries back up), and it only loads on an
      // explicit TERMITE_PREFERRED_BACKEND=metal (auto-select picks the onnx
      // variant -> MissingWeight). Default-on across Bakin's multi-table fan-out
      // is too slow, but a bounded top-K rerank (5-10 candidates ~1-2s) is a fine
      // per-query opt-in (rerankField) on a Metal host. Revisit default-on if
      // upstream gets the reranker onto a faster path.
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
