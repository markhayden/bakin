/**
 * Shared response schemas for the team plugin's route modules.
 *
 * Mirrors the workflows plugin's `lib/route-schemas.ts` — one home for the
 * passthrough/error Zod shapes every team route declares.
 */
import { z } from 'zod'

export const passthroughTeam = z.object({}).passthrough()
export const errorResponseTeam = z.object({ error: z.string() }).passthrough()
