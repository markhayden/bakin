/**
 * The conversation card for an image tool's result: the asset it created or
 * versioned. Images depends on Assets, so its tools may report `assets:asset`
 * (see `.claude/knowledge/entity-links.md`).
 */
import type { ExecToolResult } from '@bakin/core/plugin-types'

const TITLE_MAX = 80

/** First line of a prompt, clipped: what the image is, for the card. */
export function imageCardTitle(text: string | undefined, fallback = 'Image'): string {
  const line = (text ?? '').trim().split('\n')[0]?.trim() ?? ''
  if (!line) return fallback
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

/** Attach the asset card to a successful result that names an asset; anything else passes through. */
export function withAssetCard(result: ExecToolResult, title: string): ExecToolResult {
  if (!result.ok || typeof result.assetId !== 'string') return result
  return {
    ...result,
    entities: [{ kind: 'assets:asset', id: result.assetId, title, action: result.version === 1 ? 'created' : 'updated' }],
  }
}
