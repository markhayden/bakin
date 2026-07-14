/**
 * images.* — codex-native primary, direct-provider shim fallback.
 *
 * PRIMARY: the existing openai-codex OAuth drives the ChatGPT backend's
 * hosted image_generation tool (gpt-image-2) — generation AND edits with
 * input images, zero API keys (codex-images.ts). providers() reports it
 * configured so the images plugin routes servedBy 'runtime'.
 *
 * FALLBACK: requests explicitly routed to a direct provider (openai,
 * google) with a Bakin-side key ride the SHARED core shim — generation,
 * edits, and multi-reference composition (the shim takes input images
 * since pi-ecosystem WS3).
 *
 * The images plugin owns idempotency/billing and asset persistence.
 */
import {
  generateDirectImage,
  isDirectImageProvider,
  resolveProviderApiKeySource,
} from '@bakin/core/media'
import type {
  RuntimeImageEditInput,
  RuntimeImageGenerateInput,
  RuntimeImageGenerationResult,
  RuntimeImageProvider,
} from '@bakin/core/adapters/runtime'
import { RuntimeError } from '@bakin/core/adapters/runtime'
import {
  CODEX_IMAGE_MODEL,
  CODEX_IMAGE_PROVIDER,
  codexImageAuth,
  generateViaCodex,
  type CodexImageOptions,
} from './codex-images'

type PiImagesSurface = {
  providers(): Promise<RuntimeImageProvider[]>
  generate(input: RuntimeImageGenerateInput): Promise<RuntimeImageGenerationResult>
  edit(input: RuntimeImageEditInput): Promise<RuntimeImageGenerationResult>
}

function qualityFromMetadata(metadata: Record<string, unknown> | undefined): 'draft' | 'standard' | 'premium' {
  const quality = metadata?.quality
  return quality === 'draft' || quality === 'premium' ? quality : 'standard'
}

/** The keyed shim path for explicit direct-provider routes. */
async function generateViaShim(
  input: RuntimeImageGenerateInput,
  inputImages: string[] = [],
): Promise<RuntimeImageGenerationResult> {
  const provider = input.provider as string
  if (!isDirectImageProvider(provider)) {
    throw new RuntimeError(
      `adapter-pi: image provider "${provider}" is neither codex-served nor a direct provider (openai, google)`,
      { kind: 'runtime_failed' },
    )
  }
  const resolved = resolveProviderApiKeySource(provider)
  if (!resolved) {
    throw new RuntimeError(
      `adapter-pi: no Bakin-side key for image provider "${provider}" — the codex route needs no key (leave provider unset or use ${CODEX_IMAGE_PROVIDER}); for ${provider} directly, set ${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} or store providers.${provider}.apiKey`,
      { kind: 'runtime_failed' },
    )
  }
  const model = input.model ?? ''
  const result = await generateDirectImage({
    provider,
    model,
    prompt: input.prompt,
    width: input.width ?? 1024,
    height: input.height ?? 1024,
    quality: qualityFromMetadata(input.metadata),
    apiKey: resolved.apiKey,
    ...(input.count !== undefined ? { count: input.count } : {}),
    ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
    ...(input.background !== undefined ? { background: input.background } : {}),
    ...(input.outputFormat !== undefined ? { outputFormat: input.outputFormat } : {}),
    ...(input.size !== undefined ? { size: input.size } : {}),
    ...(inputImages.length > 0 ? { inputImages } : {}),
  })
  return {
    images: [{ filePath: result.filePath, mimeType: result.mimeType, width: result.width, height: result.height, provider, ...(model ? { model } : {}) }],
    provider,
    ...(model ? { model } : {}),
    ...(result.providerText ? { providerText: result.providerText } : {}),
    metadata: {
      source: 'bakin.direct-image-provider',
      servedBy: 'shim',
      credentialSource: resolved.source === 'env' ? 'bakin-env' : 'bakin-store',
    },
  }
}

/** Codex serves any request not explicitly routed to a DIFFERENT direct provider. */
function isCodexRoute(provider: string | undefined): boolean {
  return !provider || provider === CODEX_IMAGE_PROVIDER || provider === CODEX_IMAGE_MODEL
}

export function createImagesSurface(codexOptions: CodexImageOptions = {}): PiImagesSurface {
  return {
    async providers(): Promise<RuntimeImageProvider[]> {
      const auth = await codexImageAuth()
      const rows: RuntimeImageProvider[] = [{
        id: CODEX_IMAGE_PROVIDER,
        label: 'OpenAI Codex (ChatGPT login)',
        defaultModel: CODEX_IMAGE_MODEL,
        models: [CODEX_IMAGE_MODEL],
        available: auth !== null,
        configured: auth !== null,
        selected: auth !== null,
        capabilities: {
          generate: { maxCount: 1 },
          edit: { enabled: true, maxCount: 1 },
          output: { formats: ['png', 'jpeg', 'webp'] },
        },
      }]
      // Key-based direct providers (metered lane): advertised whenever a
      // Bakin-side key resolves, so the images plugin's routing engine can
      // route to them. Model ids mirror the plugin catalog; the shim passes
      // them verbatim to the provider API.
      const DIRECT_ROWS: Array<{ id: 'openai' | 'google'; label: string; defaultModel: string; models: string[] }> = [
        { id: 'openai', label: 'OpenAI (API key)', defaultModel: 'gpt-image-1', models: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'] },
        { id: 'google', label: 'Google Gemini (API key)', defaultModel: 'gemini-3.1-flash-image-preview', models: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'] },
      ]
      for (const row of DIRECT_ROWS) {
        const keyed = resolveProviderApiKeySource(row.id) !== null
        rows.push({
          id: row.id,
          label: row.label,
          defaultModel: row.defaultModel,
          models: row.models,
          available: keyed,
          configured: keyed,
          selected: false,
          capabilities: {
            generate: { maxCount: 1 },
            edit: { enabled: true, maxCount: 1 },
            output: { formats: ['png'] },
          },
        })
      }
      return rows
    },

    async generate(input: RuntimeImageGenerateInput): Promise<RuntimeImageGenerationResult> {
      if (isCodexRoute(input.provider)) {
        return generateViaCodex(input, input.referenceImages ?? [], codexOptions)
      }
      // References on a direct provider ride the shim's input-image path
      // (edit-style invocation, #418 semantics).
      return generateViaShim(input, input.referenceImages ?? [])
    },

    async edit(input: RuntimeImageEditInput): Promise<RuntimeImageGenerationResult> {
      // `files` carries base asset + references, per the contract. Codex
      // serves unrouted edits; direct providers edit through the shim.
      if (isCodexRoute(input.provider)) {
        return generateViaCodex(input, input.files, codexOptions)
      }
      return generateViaShim(input, input.files)
    },
  }
}
