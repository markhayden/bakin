/**
 * Brand content fingerprint (#419, spec §3.3).
 *
 * sha256 over the raw bytes of brand.json plus every guidelines/ and
 * lessons/ markdown file (sorted by kind/name). Recorded on brand-conditioned
 * image generations and injection records — the V2 staleness hook. The file
 * content IS the brand definition, so raw bytes (not canonicalized JSON) are
 * the honest input: any edit, including manifest formatting, is a new
 * fingerprint.
 */
import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { getBakinPaths } from '../../../src/core/content-dir'

const KINDS = ['guidelines', 'lessons'] as const

/** Returns `sha256:<hex>` for an existing brand, or null when the brand doesn't exist. */
export function computeBrandFingerprint(brandId: string): string | null {
  const dir = join(getBakinPaths().brands, brandId)
  const manifest = join(dir, 'brand.json')
  if (!existsSync(manifest)) return null

  const hash = createHash('sha256')
  hash.update('brand.json\0')
  hash.update(readFileSync(manifest))
  hash.update('\0')
  for (const kind of KINDS) {
    const kindDir = join(dir, kind)
    if (!existsSync(kindDir)) continue
    for (const name of readdirSync(kindDir).sort()) {
      if (!name.endsWith('.md')) continue
      hash.update(`${kind}/${name}\0`)
      hash.update(readFileSync(join(kindDir, name)))
      hash.update('\0')
    }
  }
  return `sha256:${hash.digest('hex')}`
}
