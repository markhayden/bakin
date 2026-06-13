/**
 * Curated catalog of popular models + providers.
 *
 * Bakin-maintained metadata overlay. The actual list of available models
 * comes from the runtime adapter; this file adds display metadata
 * (descriptions, cost ranges, tiers, brand icons) that enriches what
 * the runtime returns. Models not in this catalog render with the runtime's
 * raw name + id — no fake entries, no fallbacks.
 *
 * Maintenance: PR new entries here as popular models get configured in
 * the wild. Remove entries when a model is permanently deprecated. No
 * migration logic required — consumers read this on every request.
 */

/**
 * Structured token pricing for an LLM, in whole US dollars per 1M tokens.
 * Hand-maintained — providers expose no pricing API and OpenClaw's model
 * list carries only modality. Used to turn per-turn token usage into a
 * dollar estimate; the display string is derived via `formatCostRange`.
 * Models with no entry record tokens but no cost ("$ unavailable").
 */
export interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
  /** Cached-input read price, when the provider discounts it. Display-only
   *  for now — trajectory usage doesn't break out cached tokens (#464). */
  cachedReadPer1M?: number
  /** When this price was last verified (YYYY-MM), surfaced for staleness. */
  updatedAt: string
}

export interface KnownModel {
  /** Match against the runtime-sourced id. Use the canonical base id; the
   *  lookup helper also tries with any trailing date suffix stripped. */
  id: string
  /** Display name; overrides what the runtime returns in `name`. */
  name: string
  description?: string
  /** Short purpose hint; rendered as a badge next to the model name. */
  bestFor?: string
  tier?: 'budget' | 'standard' | 'premium'
  /** Display-only, e.g. '200K', '1M'. */
  contextWindow?: string
  /** Structured token pricing for cloud LLMs — the cost source of truth; the
   *  display string is derived from it. */
  pricing?: ModelPricing
  /** Literal display cost for non-token-priced models (image/video/local),
   *  e.g. '$0.055 per image', 'Local (no API cost)'. For token-priced LLMs,
   *  leave unset and let `pricing` drive the derived display. */
  costRange?: string
  kind: 'llm' | 'image' | 'video'
  /** simple-icons slug (e.g. 'openai', 'anthropic'). Falls through to the
   *  provider's icon at render time when omitted. */
  brandIconSlug?: string
}

export interface KnownProvider {
  /** Matches `providerFromId(modelId)` — the first path segment of the id. */
  id: string
  label: string
  brandIconSlug?: string
  /** Hex color for the first-letter-chip fallback tint. */
  brandColor?: string
}

// ─── Providers ─────────────────────────────────────────────────────────────

export const KNOWN_PROVIDERS: readonly KnownProvider[] = [
  { id: 'anthropic',         label: 'Anthropic',          brandIconSlug: 'anthropic',        brandColor: '#D97757' },
  { id: 'openai',            label: 'OpenAI',             brandIconSlug: 'openai',           brandColor: '#10A37F' },
  { id: 'openai-codex',      label: 'OpenAI (Codex)',     brandIconSlug: 'openai',           brandColor: '#10A37F' },
  { id: 'google',            label: 'Google',             brandIconSlug: 'google',           brandColor: '#4285F4' },
  { id: 'ollama',            label: 'Ollama',             brandIconSlug: 'ollama',           brandColor: '#0B0B0B' },
  { id: 'bytedance',         label: 'ByteDance',          brandIconSlug: 'bytedance',        brandColor: '#000000' },
  { id: 'kuaishou',          label: 'Kuaishou',           brandIconSlug: 'kuaishou',         brandColor: '#FF4906' },
  { id: 'runway',            label: 'Runway',             brandIconSlug: 'runway',           brandColor: '#E0F60A' },
  { id: 'black-forest-labs', label: 'Black Forest Labs',  brandIconSlug: 'blackforestlabs',  brandColor: '#000000' },
  { id: 'stability',         label: 'Stability AI',       brandIconSlug: 'stability',        brandColor: '#0050FF' },
  { id: 'midjourney',        label: 'Midjourney',         brandIconSlug: 'midjourney',       brandColor: '#131415' },
]

// ─── Models ────────────────────────────────────────────────────────────────

/** When the LLM token prices below were last verified. Bump on any edit. */
const PRICING_AS_OF = '2026-06'

export const KNOWN_MODELS: readonly KnownModel[] = [
  // ─── LLMs (Anthropic) ────────────────────────────────────────────────────
  {
    id: 'anthropic/claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    description: 'Fast, inexpensive Anthropic model tuned for short interactions.',
    bestFor: 'Simple tasks, heartbeat, routing',
    tier: 'budget',
    contextWindow: '200K',
    pricing: { inputPer1M: 1, outputPer1M: 5, updatedAt: PRICING_AS_OF },
    kind: 'llm',
    brandIconSlug: 'anthropic',
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    description: 'Balanced Anthropic model — strong reasoning, fast enough for production.',
    bestFor: 'Content creation, reasoning',
    tier: 'standard',
    contextWindow: '200K',
    pricing: { inputPer1M: 3, outputPer1M: 15, updatedAt: PRICING_AS_OF },
    kind: 'llm',
    brandIconSlug: 'anthropic',
  },
  {
    id: 'anthropic/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    description: 'Current Anthropic flagship for general-purpose work.',
    bestFor: 'General purpose, current default',
    tier: 'standard',
    contextWindow: '200K',
    pricing: { inputPer1M: 3, outputPer1M: 15, updatedAt: PRICING_AS_OF },
    kind: 'llm',
    brandIconSlug: 'anthropic',
  },
  {
    id: 'anthropic/claude-opus-4-6',
    name: 'Claude Opus 4.6',
    description: 'Anthropic\'s most capable model — deepest reasoning, highest cost.',
    bestFor: 'Complex coding, planning, analysis',
    tier: 'premium',
    contextWindow: '200K',
    pricing: { inputPer1M: 15, outputPer1M: 75, updatedAt: PRICING_AS_OF },
    kind: 'llm',
    brandIconSlug: 'anthropic',
  },

  // ─── LLMs (OpenAI) ────────────────────────────────────────────────────────
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4',
    description: 'OpenAI\'s current flagship — strong reasoning + code.',
    bestFor: 'Reasoning, code',
    tier: 'premium',
    contextWindow: '200K',
    pricing: { inputPer1M: 5, outputPer1M: 20, updatedAt: PRICING_AS_OF },
    kind: 'llm',
    brandIconSlug: 'openai',
  },
  {
    id: 'openai/gpt-5',
    name: 'GPT-5',
    description: 'Frontier reasoning model, broad general-purpose capability.',
    bestFor: 'Frontier reasoning',
    tier: 'premium',
    contextWindow: '200K',
    pricing: { inputPer1M: 5, outputPer1M: 15, updatedAt: PRICING_AS_OF },
    kind: 'llm',
    brandIconSlug: 'openai',
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'Multimodal OpenAI model — text + vision + audio.',
    bestFor: 'Multimodal general-purpose',
    tier: 'standard',
    contextWindow: '128K',
    pricing: { inputPer1M: 2.5, outputPer1M: 10, updatedAt: PRICING_AS_OF },
    kind: 'llm',
    brandIconSlug: 'openai',
  },

  // ─── LLMs (Google) ────────────────────────────────────────────────────────
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Google\'s flagship — very long context, strong reasoning.',
    bestFor: 'Long-context reasoning, code',
    tier: 'premium',
    contextWindow: '2M',
    pricing: { inputPer1M: 1.25, outputPer1M: 10, updatedAt: PRICING_AS_OF },
    kind: 'llm',
    brandIconSlug: 'google',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast Google model for high-throughput multimodal tasks.',
    bestFor: 'Fast multimodal tasks',
    tier: 'budget',
    contextWindow: '1M',
    pricing: { inputPer1M: 0.3, outputPer1M: 2.5, updatedAt: PRICING_AS_OF },
    kind: 'llm',
    brandIconSlug: 'google',
  },

  // ─── LLMs (Local — Ollama-served OSS) ─────────────────────────────────────
  {
    id: 'ollama/llama-3.3',
    name: 'Llama 3.3',
    description: 'Meta\'s open-weights model — runs locally via Ollama.',
    bestFor: 'Local large-model, privacy-sensitive work',
    tier: 'budget',
    contextWindow: '128K',
    costRange: 'Local (no API cost)',
    kind: 'llm',
    brandIconSlug: 'ollama',
  },
  {
    id: 'ollama/qwen-2.5',
    name: 'Qwen 2.5',
    description: 'Alibaba\'s open-weights general-purpose model.',
    bestFor: 'Local general-purpose',
    tier: 'budget',
    contextWindow: '128K',
    costRange: 'Local (no API cost)',
    kind: 'llm',
    brandIconSlug: 'ollama',
  },

  // ─── Image generation ────────────────────────────────────────────────────
  {
    id: 'openai/gpt-image-2',
    name: 'GPT Image 2',
    description: 'OpenAI image model used by the core images plugin.',
    bestFor: 'General image generation and text rendering',
    tier: 'standard',
    costRange: 'Provider-priced per image',
    kind: 'image',
    brandIconSlug: 'openai',
  },
  {
    id: 'openai/gpt-5.5',
    name: 'GPT-5.5 Image Generation Tool',
    description: 'OpenAI multimodal route exposed through the Responses image-generation tool.',
    bestFor: 'Premium prompt-following and text-heavy image work',
    tier: 'premium',
    costRange: 'Provider-priced per image',
    kind: 'image',
    brandIconSlug: 'openai',
  },
  {
    id: 'google/gemini-3.1-flash-image',
    name: 'Gemini 3.1 Flash Image',
    description: 'Google Gemini image model used by the core images plugin.',
    bestFor: 'Fast brand and photographic image generation',
    tier: 'budget',
    costRange: 'Provider-priced per image',
    kind: 'image',
    brandIconSlug: 'google',
  },
  {
    id: 'google/gemini-3-pro-image',
    name: 'Gemini 3 Pro Image',
    description: 'Google Gemini premium image model used by the core images plugin.',
    bestFor: 'Premium brand and photographic image generation',
    tier: 'premium',
    costRange: 'Provider-priced per image',
    kind: 'image',
    brandIconSlug: 'google',
  },
  {
    id: 'google/gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image',
    description: 'Google Gemini image model kept as a routable lower-cost option.',
    bestFor: 'Budget image generation and drafts',
    tier: 'budget',
    costRange: 'Provider-priced per image',
    kind: 'image',
    brandIconSlug: 'google',
  },
  {
    id: 'black-forest-labs/flux-pro',
    name: 'Flux Pro',
    description: 'Black Forest Labs\' premium image model — excellent detail and photography.',
    bestFor: 'Detailed photographic output',
    tier: 'standard',
    costRange: '$0.055 per image',
    kind: 'image',
    brandIconSlug: 'blackforestlabs',
  },
  {
    id: 'stability/sdxl',
    name: 'Stable Diffusion XL',
    description: 'Open-weights image generator — runs locally or via Stability API.',
    bestFor: 'Open-weights image generation',
    tier: 'budget',
    costRange: '$0.01 – $0.04 per image',
    kind: 'image',
    brandIconSlug: 'stability',
  },
  {
    id: 'midjourney/v6.1',
    name: 'Midjourney v6.1',
    description: 'Highly stylized artistic image generation.',
    bestFor: 'Stylized artistic generation',
    tier: 'premium',
    costRange: '$10 – $60 / month (subscription)',
    kind: 'image',
    brandIconSlug: 'midjourney',
  },

  // ─── Video generation ────────────────────────────────────────────────────
  {
    id: 'bytedance/seedance',
    name: 'Seedance',
    description: 'ByteDance\'s text-to-video model with strong motion fidelity.',
    bestFor: 'Text-to-video',
    tier: 'premium',
    costRange: '~$0.20 – $1 per video (varies by length)',
    kind: 'video',
    brandIconSlug: 'bytedance',
  },
  {
    id: 'kuaishou/kling-1.6',
    name: 'Kling 1.6',
    description: 'Kuaishou text-to-video with camera-control support.',
    bestFor: 'Text-to-video with camera control',
    tier: 'standard',
    costRange: '~$0.35 – $1 per video',
    kind: 'video',
    brandIconSlug: 'kuaishou',
  },
  {
    id: 'runway/gen-3-alpha',
    name: 'Gen-3 Alpha',
    description: 'Runway\'s high-fidelity text-to-video model.',
    bestFor: 'High-fidelity text-to-video',
    tier: 'premium',
    costRange: '$0.05 per second',
    kind: 'video',
    brandIconSlug: 'runway',
  },
  {
    id: 'openai/sora',
    name: 'Sora',
    description: 'OpenAI\'s long-form text-to-video — extended sequences with coherence.',
    bestFor: 'Long-form text-to-video',
    tier: 'premium',
    costRange: 'Included with ChatGPT Pro',
    kind: 'video',
    brandIconSlug: 'openai',
  },
  {
    id: 'google/veo-2',
    name: 'Veo 2',
    description: 'Google\'s text-to-video model with strong physics understanding.',
    bestFor: 'Text-to-video with physics understanding',
    tier: 'premium',
    costRange: '$0.35 per second',
    kind: 'video',
    brandIconSlug: 'google',
  },
]

// ─── Lookup helpers ────────────────────────────────────────────────────────

const modelsById = new Map<string, KnownModel>()
for (const m of KNOWN_MODELS) modelsById.set(m.id, m)

const providersById = new Map<string, KnownProvider>()
for (const p of KNOWN_PROVIDERS) providersById.set(p.id, p)

/**
 * Look up a model by id. Tries the exact id first; on miss, strips any
 * trailing `-YYYYMMDD` date suffix (some runtimes tag ids with release
 * dates) and retries. Returns `undefined` for unknown ids so callers can
 * render plain rows.
 */
export function getKnownModel(id: string): KnownModel | undefined {
  const exact = modelsById.get(id)
  if (exact) return exact
  // Strip trailing `-YYYYMMDD`
  const stripped = id.replace(/-\d{8}$/, '')
  if (stripped !== id) return modelsById.get(stripped)
  return undefined
}

/** Look up a provider by id (first path segment of a model id). */
export function getKnownProvider(id: string): KnownProvider | undefined {
  return providersById.get(id)
}

/** Format a per-1M dollar amount: whole numbers bare ($3), fractions to 2dp ($0.30). */
function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`
}

/** Render the human display string for structured pricing, matching the
 *  legacy literal format ('$3 in / $15 out per 1M'). */
export function formatCostRange(pricing: ModelPricing): string {
  return `${formatUsd(pricing.inputPer1M)} in / ${formatUsd(pricing.outputPer1M)} out per 1M`
}

/**
 * Estimated turn cost in micro-dollars (integer; avoids float drift in the
 * ledger). Returns null when pricing is unknown or usage carries no token
 * counts — callers record tokens-only and surface "$ unavailable" rather
 * than fabricating a zero cost. Cached-token discounts aren't modeled
 * (trajectory usage doesn't break them out), so this reads slightly high
 * when prompt caching is active — it's an estimate, not an invoice.
 */
export function computeCostUsdMicros(
  usage: { input?: number; output?: number; total?: number },
  pricing: ModelPricing | undefined,
): number | null {
  if (!pricing) return null
  const input = usage.input ?? 0
  const output = usage.output ?? 0
  // Pricing needs the input/output split (different per-1M rates). A usage
  // block carrying only a combined `total` can't be priced accurately, so we
  // return null (unmetered) rather than guess — input/output is always
  // present in practice; this is the honest fallback for the degenerate case.
  if (input === 0 && output === 0) return null
  const dollars = (input / 1_000_000) * pricing.inputPer1M + (output / 1_000_000) * pricing.outputPer1M
  return Math.round(dollars * 1_000_000)
}
