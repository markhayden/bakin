const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i
const CANONICAL_ASSET_FILENAME_RE = /^(\d{4})(\d{2})(\d{2})-.+\..+$/

function hasValidDatePrefix(filename: string): boolean {
  const match = CANONICAL_ASSET_FILENAME_RE.exec(filename)
  if (!match) return false

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)

  return year >= 1970 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

export function isRenderableAssetImageFilename(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return false
  return IMAGE_EXT_RE.test(value) && hasValidDatePrefix(value)
}
