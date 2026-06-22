/**
 * Shared Zod response/body schemas for workflow routes.
 *
 * Extracted so the per-group route modules (routes/definitions, routes/gates,
 * routes/instances) and the activate-body route registrations share one copy.
 */
import { z } from 'zod'

export const passthroughWf = z.object({}).passthrough()
export const errorResponseWf = z.object({ error: z.string() }).passthrough()
export const htmlResponseWf = { contentType: 'text/html' as const }
export const repairSkillBodyWf = z.object({ confirmKnownOld: z.boolean().optional() }).optional()
