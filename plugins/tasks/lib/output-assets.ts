const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i
// A versioned assetId: YYYYMMDD-<slug>-<8 hex>, no extension.
const ASSET_ID_TAIL_RE = /-[0-9a-f]{8}$/i

function hasValidDatePrefix(value: string): boolean {
  const match = /^(\d{4})(\d{2})(\d{2})-/.exec(value)
  if (!match) return false
  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  return year >= 1970 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/**
 * True when a step-output string is a renderable asset reference — either a
 * legacy date-prefixed image filename (e.g. 20260115-hero-a1b2c3d4.png) or a
 * versioned assetId (e.g. 20260115-hero-a1b2c3d4, no extension). Both render
 * via /api/assets/<value>; a non-image assetId falls back gracefully (the
 * <img> onError hides itself).
 */
export function isRenderableAssetRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return false
  if (!hasValidDatePrefix(value)) return false
  return (IMAGE_EXT_RE.test(value) && value.includes('.')) || ASSET_ID_TAIL_RE.test(value)
}
