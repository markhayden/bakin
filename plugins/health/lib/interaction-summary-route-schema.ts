import { z } from 'zod'
import {
  interactionCoverageSchema,
  interactionTimeBucketSchema,
} from './usage-feed-route-schema'

const nonNegativeInteger = z.number().int().nonnegative()
const nonNegativeNumber = z.number().nonnegative()

export const interactionCategorySchema = z.enum(['tools', 'api', 'agents'])

export const interactionSummaryResponseSchema = z.object({
  window: z.enum(['5m', '1h', '24h']),
  coverage: interactionCoverageSchema,
  totals: z.object({
    count: nonNegativeInteger,
    errors: nonNegativeInteger,
    unverified: nonNegativeInteger,
    foreground: nonNegativeInteger,
    background: nonNegativeInteger,
  }).strict(),
  categories: z.array(z.object({
    key: interactionCategorySchema,
    count: nonNegativeInteger,
    errors: nonNegativeInteger,
  }).strict()).length(3),
  topDestinations: z.array(z.object({
    category: interactionCategorySchema,
    name: z.string(),
    count: nonNegativeInteger,
    errors: nonNegativeInteger,
    medianDurationMs: nonNegativeNumber.nullable(),
  }).strict()).max(10),
  timeBuckets: z.array(interactionTimeBucketSchema),
}).strict().superRefine((data, context) => {
  if (
    data.totals.errors + data.totals.unverified > data.totals.count
    || data.totals.foreground + data.totals.background !== data.totals.count
  ) {
    context.addIssue({
      code: 'custom',
      path: ['totals'],
      message: 'interaction outcomes and scopes must reconcile with the total',
      input: data.totals,
    })
  }

  const categoryKeys = new Set(data.categories.map((row) => row.key))
  const categoryCount = data.categories.reduce((sum, row) => sum + row.count, 0)
  const categoryErrors = data.categories.reduce((sum, row) => sum + row.errors, 0)
  if (
    categoryKeys.size !== interactionCategorySchema.options.length
    || data.categories.some((row) => row.errors > row.count)
    || categoryCount !== data.totals.count
    || categoryErrors !== data.totals.errors
  ) {
    context.addIssue({
      code: 'custom',
      path: ['categories'],
      message: 'interaction sources must contain each source once and reconcile with totals',
      input: data.categories,
    })
  }

  if (data.topDestinations.some((row) => row.errors > row.count)) {
    context.addIssue({
      code: 'custom',
      path: ['topDestinations'],
      message: 'destination failures cannot exceed calls',
      input: data.topDestinations,
    })
  }

  const bucketCount = data.timeBuckets.reduce((sum, row) => sum + row.count, 0)
  const bucketErrors = data.timeBuckets.reduce((sum, row) => sum + row.failureCount, 0)
  if (bucketCount !== data.totals.count || bucketErrors !== data.totals.errors) {
    context.addIssue({
      code: 'custom',
      path: ['timeBuckets'],
      message: 'interaction time buckets must reconcile with totals',
      input: data.timeBuckets,
    })
  }
})

export type InteractionCategory = z.infer<typeof interactionCategorySchema>
export type InteractionSummaryResponse = z.infer<typeof interactionSummaryResponseSchema>

export function isInteractionSummaryResponse(
  value: unknown,
  requestedWindow: InteractionSummaryResponse['window'],
): value is InteractionSummaryResponse {
  const parsed = interactionSummaryResponseSchema.safeParse(value)
  return parsed.success && parsed.data.window === requestedWindow
}
