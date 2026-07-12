/**
 * OpenClaw image inference — provider/model arg formatting, output-path setup,
 * and the parsers that turn `openclaw image` CLI output into typed
 * RuntimeImageProvider[] / RuntimeImageGenerationResult shapes. The class's
 * image methods own the exec + provider cache and import these helpers; this
 * module is pure formatting/parsing over the CLI's JSON.
 */
import { existsSync, mkdirSync, mkdtempSync } from 'fs'
import { join } from 'path'
import type {
  RuntimeImageGenerateInput,
  RuntimeImageGenerationResult,
  RuntimeImageProvider,
  RuntimeMetadata,
} from '@bakin/core/adapters/runtime'
import { getOpenClawPath } from './home'
import { firstString, isRecord, parseJsonValue } from './runtime-utils'

export function defaultOpenClawImageOutputPath(format?: string): string {
  const normalized = normalizeOpenClawOutputFormat(format)
  const ext = normalized === 'jpeg' ? 'jpg' : normalized
  // Under the OPENCLAW HOME, never the OS temp dir: when the CLI is a shim
  // into a container (the dev rig), the openclaw home is the one path both
  // sides share — a host /var/folders/... output path EACCESed inside the
  // container (2026-07-12 pumpkin incident). Works identically when the CLI
  // runs directly on the host.
  const root = getOpenClawPath('tmp', 'bakin-images')
  mkdirSync(root, { recursive: true })
  return join(mkdtempSync(join(root, 'image-')), `image.${ext}`)
}

export function normalizeOpenClawOutputFormat(format?: string): string {
  if (format === 'jpg') return 'jpeg'
  if (format === 'jpeg' || format === 'webp' || format === 'png') return format
  return 'png'
}

export function openClawImageModelArg(input: Pick<RuntimeImageGenerateInput, 'provider' | 'model'>): string | undefined {
  if (!input.model) return undefined
  if (input.model.includes('/') || !input.provider) return input.model
  return `${input.provider}/${input.model}`
}

export function providerFromImageModel(model: string | undefined): string | undefined {
  if (!model?.includes('/')) return undefined
  return model.split('/')[0] || undefined
}

export function modelNameFromImageModel(model: string | undefined): string | undefined {
  if (!model) return undefined
  const [, ...modelParts] = model.split('/')
  return modelParts.length > 0 ? modelParts.join('/') : model
}

export function parseOpenClawImageProviders(raw: string): RuntimeImageProvider[] {
  const parsed = parseJsonValue(raw)
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.providers)
      ? parsed.providers
      : []
  return rows
    .filter(isRecord)
    .map((row): RuntimeImageProvider | null => {
      const id = firstString(row.id)
      if (!id) return null
      const provider: RuntimeImageProvider = { id }
      const label = firstString(row.label)
      if (label) provider.label = label
      const defaultModel = firstString(row.defaultModel)
      if (defaultModel) provider.defaultModel = defaultModel
      if (Array.isArray(row.models)) provider.models = row.models.filter((model): model is string => typeof model === 'string')
      if (typeof row.available === 'boolean') provider.available = row.available
      if (typeof row.configured === 'boolean') provider.configured = row.configured
      if (typeof row.selected === 'boolean') provider.selected = row.selected
      if (isRecord(row.capabilities)) provider.capabilities = row.capabilities as RuntimeImageProvider['capabilities']
      return provider
    })
    .filter((provider): provider is RuntimeImageProvider => provider !== null)
}

export function imageQualityFromMetadata(metadata: RuntimeMetadata | undefined): 'draft' | 'standard' | 'premium' {
  const quality = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).quality : undefined
  return quality === 'draft' || quality === 'premium' ? quality : 'standard'
}

/** Tag a natively-served result for operator diagnostics. The shim path sets
 * its own servedBy/credentialSource inline (it knows env vs store). */
export function tagRuntimeServed(result: RuntimeImageGenerationResult): RuntimeImageGenerationResult {
  return {
    ...result,
    metadata: { ...(result.metadata ?? {}), servedBy: 'runtime', credentialSource: 'runtime' },
  }
}

export function parseOpenClawImageResult(
  raw: string,
  opts: { input: RuntimeImageGenerateInput; outputPath: string },
): RuntimeImageGenerationResult {
  const parsed = parseJsonValue(raw)
  const files = collectOpenClawImageFiles(parsed)
  if (files.length === 0 && existsSync(opts.outputPath)) {
    files.push({ filePath: opts.outputPath, mimeType: imageMimeTypeForPath(opts.outputPath) })
  }
  if (files.length === 0) {
    throw new Error('OpenClaw image inference did not return a saved image file')
  }

  const modelArg = openClawImageModelArg(opts.input)
  const provider = opts.input.provider ?? providerFromImageModel(modelArg)
  const model = modelNameFromImageModel(modelArg)
  const providerText = openClawImageProviderText(parsed)
  return {
    images: files.map(file => ({
      ...file,
      provider: file.provider ?? provider,
      model: file.model ?? model,
    })),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(providerText ? { providerText } : {}),
    metadata: { source: 'openclaw.infer.image' },
  }
}

export function collectOpenClawImageFiles(value: unknown): Array<{ filePath: string; mimeType?: string; width?: number; height?: number; provider?: string; model?: string; metadata?: RuntimeMetadata }> {
  const out: Array<{ filePath: string; mimeType?: string; width?: number; height?: number; provider?: string; model?: string; metadata?: RuntimeMetadata }> = []
  const seen = new Set<string>()

  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    if (!isRecord(current)) return

    const candidate = openClawImageFileCandidate(current)
    if (candidate && !seen.has(candidate.filePath)) {
      seen.add(candidate.filePath)
      out.push(candidate)
    }

    for (const key of ['images', 'files', 'outputs', 'output', 'saved', 'result']) {
      if (key in current) visit(current[key])
    }
  }

  visit(value)
  return out
}

export function openClawImageFileCandidate(record: Record<string, unknown>): { filePath: string; mimeType?: string; width?: number; height?: number; provider?: string; model?: string; metadata?: RuntimeMetadata } | null {
  const filePath = firstString(record.filePath, record.path, record.outputPath, record.filename)
  if (!filePath || !existsSync(filePath)) return null
  const out: { filePath: string; mimeType?: string; width?: number; height?: number; provider?: string; model?: string; metadata?: RuntimeMetadata } = {
    filePath,
    mimeType: firstString(record.mimeType, record.mime_type, record.contentType) ?? imageMimeTypeForPath(filePath),
  }
  if (typeof record.width === 'number') out.width = record.width
  if (typeof record.height === 'number') out.height = record.height
  const provider = firstString(record.provider)
  if (provider) out.provider = provider
  const model = firstString(record.model)
  if (model) out.model = modelNameFromImageModel(model)
  if (isRecord(record.metadata)) out.metadata = record.metadata as RuntimeMetadata
  return out
}

export function imageMimeTypeForPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

export function openClawImageProviderText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return firstString(value.providerText, value.text, value.message, value.revisedPrompt, value.revised_prompt)
}
