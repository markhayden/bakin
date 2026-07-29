/**
 * Runtime-shaped model catalog returned by Imitation Crab's OpenClaw CLI shim.
 *
 * Keep this larger than one UI page so the Available Models surface exercises
 * provider filters, pagination, configured/default states, local models, and
 * catalog enrichment during manual development.
 */
export interface ImitationCrabModel {
  key: string
  name: string
  available: true
  input: string
  contextWindow?: number
  local?: boolean
  tags?: string[]
}

export const IMITATION_CRAB_MODELS: readonly ImitationCrabModel[] = [
  {
    key: 'anthropic/claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    available: true,
    input: 'text+image',
    contextWindow: 200_000,
    tags: ['configured'],
  },
  {
    key: 'anthropic/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    available: true,
    input: 'text+image',
    contextWindow: 200_000,
    tags: ['configured'],
  },
  {
    key: 'anthropic/claude-opus-4-6',
    name: 'Claude Opus 4.6',
    available: true,
    input: 'text+image',
    contextWindow: 200_000,
  },
  {
    key: 'anthropic/claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    available: true,
    input: 'text+image',
    contextWindow: 200_000,
    tags: ['configured'],
  },
  {
    key: 'openai/gpt-5.4',
    name: 'GPT-5.4',
    available: true,
    input: 'text+image',
    contextWindow: 200_000,
    tags: ['configured'],
  },
  {
    key: 'openai/gpt-5',
    name: 'GPT-5',
    available: true,
    input: 'text+image',
    contextWindow: 200_000,
  },
  {
    key: 'openai/gpt-4o',
    name: 'GPT-4o',
    available: true,
    input: 'text+image+audio',
    contextWindow: 128_000,
  },
  {
    key: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    available: true,
    input: 'text+image',
    contextWindow: 2_000_000,
    tags: ['configured'],
  },
  {
    key: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    available: true,
    input: 'text+image',
    contextWindow: 1_000_000,
  },
  {
    key: 'ollama/llama-3.3',
    name: 'Llama 3.3',
    available: true,
    input: 'text',
    contextWindow: 128_000,
    local: true,
    tags: ['local'],
  },
  {
    key: 'ollama/qwen-2.5',
    name: 'Qwen 2.5',
    available: true,
    input: 'text',
    contextWindow: 128_000,
    local: true,
    tags: ['local'],
  },
  {
    key: 'openai/gpt-image-2',
    name: 'GPT Image 2',
    available: true,
    input: 'text+image',
  },
] as const
