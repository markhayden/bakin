/**
 * REST boundary schema for POST /api/runtime/switch. STRICT + boolean-only:
 * a type-confused body (`dryRun: "true"`, a typo'd key) must 400 — the
 * preview flag failing open into a REAL switch is the one mistake this
 * endpoint cannot make. Zod only, so route declarations can import it
 * without loading the switch.
 */
import { z } from 'zod'

export const RuntimeSwitchRequestSchema = z
  .object({
    target: z.string().min(1),
    dryRun: z.boolean().optional(),
    copyWorkspaces: z.boolean().optional(),
    adoptCron: z.boolean().optional(),
  })
  .strict()

export type RuntimeSwitchRequest = z.infer<typeof RuntimeSwitchRequestSchema>
