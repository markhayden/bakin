/**
 * images.* — Pi serves nothing natively; generation routes to Bakin's
 * SHARED direct-provider shim (@bakin/core/media), the same code path
 * OpenClaw falls back to when its native route isn't configured. Keys
 * resolve env → secret store (OPENAI_API_KEY / providers.<id>.apiKey);
 * Pi's own auth.json is never touched (codex chat credential ≠ images
 * API credential).
 *
 * The images plugin owns idempotency/billing and asset persistence — this
 * surface only performs the provider call and returns the temp file path.
 * Edit stays unsupported: the shim is generate-only (no input images).
 */
import {
  generateDirectImage,
  isDirectImageProvider,
  resolveProviderApiKeySource,
} from '@bakin/core/media'
import type {
  RuntimeImageGenerateInput,
  RuntimeImageGenerationResult,
} from '@bakin/core/adapters/runtime'
import { RuntimeError } from '@bakin/core/adapters/runtime'

type PiImagesSurface = {
  providers(): Promise<never[]>
  generate(input: RuntimeImageGenerateInput): Promise<RuntimeImageGenerationResult>
  edit(): Promise<RuntimeImageGenerationResult>
}

function qualityFromMetadata(metadata: Record<string, unknown> | undefined): 'draft' | 'standard' | 'premium' {
  const quality = metadata?.quality
  return quality === 'draft' || quality === 'premium' ? quality : 'standard'
}

export function createImagesSurface(): PiImagesSurface {
  return {
    // Nothing served natively — the images plugin derives shim availability
    // from Bakin-side keys itself; an empty native roster is the honest one.
    async providers() {
      return []
    },

    async generate(input: RuntimeImageGenerateInput): Promise<RuntimeImageGenerationResult> {
      const provider = input.provider
      if (!provider || !isDirectImageProvider(provider)) {
        throw new RuntimeError(
          `adapter-pi: image provider "${provider ?? '(none)'}" is not shim-servable — the pi runtime generates images only via Bakin's direct providers (openai, google)`,
          { kind: 'runtime_failed' },
        )
      }
      const resolved = resolveProviderApiKeySource(provider)
      if (!resolved) {
        throw new RuntimeError(
          `adapter-pi: no Bakin-side key for image provider "${provider}" — set ${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} or store providers.${provider}.apiKey in the secret store`,
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
        // Forward the full option surface so the shim's guardrail rejects
        // what it can't honor BEFORE the billed call (#379 discipline).
        ...(input.count !== undefined ? { count: input.count } : {}),
        ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        ...(input.background !== undefined ? { background: input.background } : {}),
        ...(input.outputFormat !== undefined ? { outputFormat: input.outputFormat } : {}),
        ...(input.size !== undefined ? { size: input.size } : {}),
      })
      return {
        images: [{
          filePath: result.filePath,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
          provider,
          ...(model ? { model } : {}),
        }],
        provider,
        ...(model ? { model } : {}),
        ...(result.providerText ? { providerText: result.providerText } : {}),
        metadata: {
          source: 'bakin.direct-image-provider',
          servedBy: 'shim',
          credentialSource: resolved.source === 'env' ? 'bakin-env' : 'bakin-store',
        },
      }
    },

    async edit(): Promise<RuntimeImageGenerationResult> {
      throw new RuntimeError(
        'adapter-pi: image editing with input files is not supported by the pi runtime (the direct-provider shim is generate-only)',
        { kind: 'runtime_failed' },
      )
    },
  }
}
