/**
 * Turn attachments → OpenClaw gateway `agent` RPC payload
 * (spec: enrichment-runtime-fallback; wire shapes verified in
 * tasks/evidence-enrichment-runtime.md §2).
 *
 * Gateway facts this module encodes:
 *   - the `agent` entrypoint accepts ONLY image/* attachments;
 *   - images ≤ 2,000,000 bytes take the guaranteed-inline path (pixels in
 *     the model turn);
 *   - 2–6 MB images silently degrade upstream to a `media://inbound/` note
 *     the model cannot see — we REFUSE those loudly instead of letting a
 *     caller believe the model saw the image;
 *   - > 6 MB errors upstream anyway.
 */
import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import type { MessageAttachment } from '@bakin/core/adapters/runtime'

/** Gateway OFFLOAD_THRESHOLD_BYTES — the guaranteed-inline ceiling. */
export const OPENCLAW_INLINE_IMAGE_MAX_BYTES = 2_000_000

export interface OpenClawRpcAttachment {
  mimeType: string
  fileName: string
  content: string
}

export function buildOpenClawAttachments(attachments: MessageAttachment[]): OpenClawRpcAttachment[] {
  return attachments.map((attachment) => {
    if (!attachment.mimeType.toLowerCase().startsWith('image/')) {
      throw new Error(
        `attachment ${attachment.path}: the OpenClaw agent entrypoint accepts only image/* attachments (got ${attachment.mimeType})`,
      )
    }
    let size: number
    try {
      size = statSync(attachment.path).size
    } catch {
      throw new Error(`attachment ${attachment.path}: file not found or unreadable`)
    }
    if (size > OPENCLAW_INLINE_IMAGE_MAX_BYTES) {
      throw new Error(
        `attachment ${attachment.path}: ${size} bytes exceeds the ${OPENCLAW_INLINE_IMAGE_MAX_BYTES}-byte inline limit — `
        + 'larger images silently degrade to a media:// note upstream (the model never sees the pixels). '
        + 'Downscale/re-encode below 2 MB before sending.',
      )
    }
    return {
      mimeType: attachment.mimeType,
      fileName: basename(attachment.path),
      content: readFileSync(attachment.path).toString('base64'),
    }
  })
}
