import { homedir } from 'os'
import { join } from 'path'

/**
 * Antfly-owned filesystem locations (NOT Bakin's content dir).
 *
 * The binary and the inference models live under the antfly home so they are
 * shared with any other antfly install on the machine — models are immutable
 * multi-GB downloads and the binary is version-checked against Bakin's pin.
 * Bakin's *data* dir is deliberately NOT here: the private instance keeps its
 * data under `getBakinPaths().antfly` so Bakin never cohabits a data dir with
 * another project's tables.
 *
 * `ANTFLY_HOME` matches the env var the antfly CLI itself honors, and doubles
 * as the test-isolation seam (set it to a temp dir before imports).
 */
export function antflyHome(): string {
  return process.env.ANTFLY_HOME || join(homedir(), '.antfly')
}

export function antflyBinaryPath(): string {
  return join(antflyHome(), 'bin', 'antfly')
}

export function inferenceModelsRoot(): string {
  return join(antflyHome(), 'inference', 'models')
}

/** The engine Bakin manages itself (anything else is a guest endpoint someone else runs). */
export function isLocalDefaultUrl(url: string): boolean {
  const origin = new URL(url).origin
  return origin === 'http://127.0.0.1:3738' || origin === 'http://localhost:3738'
}
