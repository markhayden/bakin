/**
 * Wire schemas for converted routes (#895 D6): every route that starts an
 * operation answers 202 `{ operationId, bootId }` (200 with `attached: true`
 * when an identical live request already runs). Route declarations use this
 * so the OpenAPI document states the shape.
 */
import { z } from 'zod'

export const operationStartResponseSchema = z.object({
  operationId: z.string().min(1),
  bootId: z.string().min(1),
  attached: z.literal(true).optional(),
}).strict()
