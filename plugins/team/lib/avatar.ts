/**
 * Writing an agent's avatar: the ONE place it happens, behind both the
 * browser's upload route and the agent tool that applies a saved asset.
 */
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { detectImageExtension, isValidAgentId } from '@bakin/core/agents/avatar'
import { removeInstalledBy } from '@bakin/core/agent-packages/markers'
import { atomicWriteBytes } from '@bakin/core/storage/atomic-write'
import { getBakinPaths } from '../../../packages/core/src/content-dir'

/** An avatar larger than this is refused: it is a face, not a poster. */
export const MAX_AVATAR_BYTES = 12 * 1024 * 1024

export type WriteAvatarResult =
  | { ok: true; ext: string }
  | { ok: false; error: string }

/** Store `image` as the agent's avatar, replacing whatever it had. */
export function writeAgentAvatar(agentId: string, image: Uint8Array): WriteAvatarResult {
  if (!isValidAgentId(agentId)) return { ok: false, error: 'Invalid agent id' }
  if (image.length === 0) return { ok: false, error: 'Empty file' }
  if (image.length > MAX_AVATAR_BYTES) return { ok: false, error: 'Image is too large for an avatar (12 MB at most)' }
  const ext = detectImageExtension(image)
  if (!ext) return { ok: false, error: 'Unsupported image format' }

  const agentDir = join(getBakinPaths().agents, agentId)
  if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true })
  // Atomic: a browser fetching the avatar mid-write never gets half a picture.
  const target = join(agentDir, `avatar.${ext}`)
  atomicWriteBytes(target, image)

  // Keep exactly one canonical avatar: drop any other-format siblings
  // (and their package `.installedBy` sidecars) so the new one always wins.
  for (const other of ['webp', 'png', 'jpg']) {
    if (other === ext) continue
    const sibling = join(agentDir, `avatar.${other}`)
    if (existsSync(sibling)) {
      unlinkSync(sibling)
      removeInstalledBy(sibling)
    }
  }
  return { ok: true, ext }
}
