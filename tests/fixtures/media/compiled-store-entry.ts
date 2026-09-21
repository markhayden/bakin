/**
 * Compile-and-run fixture (#889): the REAL media machinery inside a compiled
 * binary. Installs the store via installMediaStore (stage seam fed from a
 * pre-staged node_modules the TEST builds from the repo's own packages — no
 * network), with the REAL in-binary Bun.build bundle + REAL probe resize,
 * then loads sharp through the REAL loader fallback and resizes an image.
 *
 * Compiled WITH `--external sharp`, mirroring scripts/build-binary.ts.
 * Env: BAKIN_HOME (temp), STAGED_NODE_MODULES (source layout).
 */
import { cpSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { installMediaStore } from '../../../packages/core/src/media/installer'
import { loadSharp } from '../../../packages/core/src/media/sharp-loader'

const PROBE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

try {
  const staged = process.env.STAGED_NODE_MODULES
  if (!staged) throw new Error('STAGED_NODE_MODULES not set')

  const result = await installMediaStore({
    stage: async (nodeModulesDir) => {
      cpSync(staged, nodeModulesDir, { recursive: true })
    },
  })
  console.log(`STORE INSTALL OK: ${result.storeDir}`)

  const sharp = await loadSharp()
  if (!sharp) throw new Error('loadSharp returned null after store install')
  console.log('LOADER OK')

  const workDir = join(process.env.BAKIN_HOME!, 'fixture-work')
  mkdirSync(workDir, { recursive: true })
  const input = join(workDir, 'input.png')
  writeFileSync(input, Buffer.from(PROBE_PNG_BASE64, 'base64'))
  const meta = await sharp(input).metadata()
  console.log(`METADATA: ${meta.width}x${meta.height} ${meta.format}`)
  const out = join(workDir, 'out.jpg')
  await sharp(input).rotate().resize(64, 64, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(out)
  console.log(`RESIZED OK: ${statSync(out).size} bytes`)
} catch (err) {
  console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
