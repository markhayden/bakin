export interface AntflySettings {
  enabled: boolean
  url: string
  auth?: { username: string; password: string }
  search: {
    strategy: 'rrf' | 'semantic_only' | 'full_text_only'
    /** Hybrid fusion algorithm — upstream main supports both; tuned in T21. */
    fusionStrategy: 'rrf' | 'rsf'
    defaultLimit: number
    /** Per-table cooperative query deadline (ms); see core settings. */
    queryBudgetMs?: number
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
   * Bakin's embedders always run IN-PROCESS in the local antfly node — we
   * deliberately never carry an inference `url`/`api_url`, because a non-empty
   * value flips antfly onto an external HTTP inference path whose cold/dead-
   * endpoint failures (ConnectionRefused/Timeout) wedge the enrichment backfill
   * (bakin#456). `multimodal` is the one optional pass-through, declaring
   * non-text support for models OUTSIDE antfly's built-in registry; it stays
   * unset for registry models like clipclap.
   */
  embedders: Record<string, {
    provider: string
    model: string
    dimension: number
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
    // RSF over RRF: measured on the golden set (search-tuning.md) —
    // hit@1 83% vs 72% at equal weights, identical latency. RSF's
    // score-preserving normalization keeps a strong single-leg signal
    // (exact caption or visual match) from being diluted by rank-only fusion.
    fusionStrategy: 'rsf',
    defaultLimit: 20,
    queryBudgetMs: 2000,
    reranker: {
      // DEFAULT-ON since antfly 0.2.2 (#846, 2026-09-19 benchmark on the M4,
      // tasks/evidence-reranker-846.md): the rc-era ~200ms/candidate path is
      // gone — top-10 rerank costs Δp95 +28ms warm, and metal AUTO-selects
      // the pinned safetensors (no TERMITE_PREFERRED_BACKEND needed). Applies
      // to SINGLE-TABLE queries with a rerankField when the caller leaves
      // rerank unset (translate.ts); explicit rerank:false wins. The global
      // multi-table fan-out NEVER reranks per-table (10-way concurrency gets
      // 502'd by engine admission control — measured) — cross-table search
      // reranks its MERGED top-K once via the adapter's standalone rerank().
      enabled: true,
      provider: 'antfly',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
    },
  },
  embedders: {
    default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5', dimension: 384 },
    // antfly's native multimodal CLIP (image+text shared space, Metal GGUF) and
    // a built-in registry model. Replaces the Xenova ONNX mirror — same 512 dims.
    visual: { provider: 'antfly', model: 'antflydb/clipclap', dimension: 512 },
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
