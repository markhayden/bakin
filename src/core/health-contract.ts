/**
 * Runtime validation for the canonical SDK-owned Health contract.
 *
 * Producers are in-process code, but their registrations and run outputs are
 * still boundary data: validate them before storing or publishing anything.
 * Validation errors intentionally retain issue metadata only, never the
 * rejected payload (which may contain credentials or other sensitive data).
 */
import { z } from 'zod'

import { HEALTH_INCIDENT_CLASSES } from '@makinbakin/sdk/types'
import type {
  HealthCheckRegistrationInput,
  HealthCheckRunInput,
  HealthRepairActionDefinition,
  HealthRepairApplyResult,
  HealthRepairPlanItem,
} from '@makinbakin/sdk/types'

export type HealthContractErrorCode =
  | 'INVALID_HEALTH_REGISTRATION'
  | 'INVALID_HEALTH_REPAIR_ACTION'
  | 'INVALID_HEALTH_REPAIR_PLAN_OUTPUT'
  | 'INVALID_HEALTH_REPAIR_APPLY_OUTPUT'
  | 'INVALID_HEALTH_RUN_OUTPUT'

export interface HealthContractIssue {
  code: string
  path: string
  message: string
}

export interface HealthContractErrorJson {
  code: HealthContractErrorCode
  path: string
  message: string
  issues: HealthContractIssue[]
}

export type HealthContractSafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: HealthContractError }

const REGISTRATION_ERROR_MESSAGE = 'Health registration failed contract validation.'
const REPAIR_ACTION_ERROR_MESSAGE = 'Health repair action failed contract validation.'
const REPAIR_PLAN_OUTPUT_ERROR_MESSAGE = 'Health repair plan output failed contract validation.'
const REPAIR_APPLY_OUTPUT_ERROR_MESSAGE = 'Health repair apply output failed contract validation.'
const RUN_OUTPUT_ERROR_MESSAGE = 'Health check run output failed contract validation.'

/** Structured, payload-free contract failure suitable for logs and HTTP errors. */
export class HealthContractError extends Error {
  readonly code: HealthContractErrorCode
  readonly path: string
  readonly issues: HealthContractIssue[]

  constructor(code: HealthContractErrorCode, message: string, issues: HealthContractIssue[]) {
    super(message)
    this.name = 'HealthContractError'
    this.code = code
    this.issues = issues.map((issue) => ({ ...issue }))
    this.path = this.issues[0]?.path ?? '$'
  }

  toJSON(): HealthContractErrorJson {
    return {
      code: this.code,
      path: this.path,
      message: this.message,
      issues: this.issues.map((issue) => ({ ...issue })),
    }
  }
}

const STABLE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/

function nonBlankString(max: number, label: string): z.ZodString {
  return z.string()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`)
    .refine((value) => value.trim().length > 0, `${label} is required.`)
}

const stableKeySchema = z.string().regex(
  STABLE_KEY_PATTERN,
  'Must be a stable lowercase identifier of at most 128 characters.',
)

const healthGroupSchema = z.object({
  key: stableKeySchema,
  label: nonBlankString(120, 'Group label'),
}).strict()

const callableSchema = z.custom<HealthCheckRegistrationInput['run']>(
  (value) => typeof value === 'function',
  { message: 'Run must be a function.' },
)

/** Exact producer registration schema. Core adds owner metadata separately. */
export const healthCheckRegistrationInputSchema = z.object({
  id: stableKeySchema,
  name: nonBlankString(120, 'Check name'),
  description: nonBlankString(500, 'Check description'),
  group: healthGroupSchema,
  maxAgeMs: z.number().int().positive().finite().optional(),
  timeoutMs: z.number().int().positive().finite().optional(),
  run: callableSchema,
}).strict()

const repairPlanCallableSchema = z.custom<HealthRepairActionDefinition['plan']>(
  (value) => typeof value === 'function',
  { message: 'Plan must be a function.' },
)

const repairApplyCallableSchema = z.custom<HealthRepairActionDefinition['apply']>(
  (value) => typeof value === 'function',
  { message: 'Apply must be a function.' },
)

/** Exact owner-local repair-action schema; core namespaces the action id. */
export const healthRepairActionDefinitionSchema = z.object({
  id: stableKeySchema,
  name: nonBlankString(120, 'Repair action name'),
  plan: repairPlanCallableSchema,
  apply: repairApplyCallableSchema,
}).strict()

const healthRepairChangeOutputSchema = z.object({
  kind: z.enum(['file', 'setting', 'service', 'runtime', 'task', 'other']),
  target: nonBlankString(4_000, 'Repair change target'),
  action: z.enum(['create', 'update', 'delete', 'install', 'invoke']),
  description: nonBlankString(4_000, 'Repair change description'),
}).strict()

const healthRepairPreconditionOutputSchema = z.object({
  observationId: nonBlankString(512, 'Repair observation id'),
  executionId: nonBlankString(512, 'Repair execution id'),
  status: z.enum(['warning', 'error', 'unknown']),
  resolutionKey: nonBlankString(512, 'Repair resolution key'),
}).strict()

/** Exact producer-authored plan items before core stamps trusted identities. */
export const healthRepairPlanItemOutputSchema = z.object({
  id: nonBlankString(512, 'Repair item id'),
  actionId: nonBlankString(512, 'Repair action id'),
  title: nonBlankString(500, 'Repair item title'),
  reason: nonBlankString(4_000, 'Repair item reason'),
  safety: z.enum(['safe', 'manual', 'destructive']),
  incidentIds: z.array(nonBlankString(512, 'Repair incident id')),
  observationIds: z.array(nonBlankString(512, 'Repair observation id')),
  preconditions: z.array(healthRepairPreconditionOutputSchema),
  changes: z.array(healthRepairChangeOutputSchema),
}).strict()

export const healthRepairPlanOutputSchema = z.array(healthRepairPlanItemOutputSchema)

/** Exact producer-authored apply results before core publishes or audits them. */
export const healthRepairApplyResultOutputSchema = z.object({
  itemId: nonBlankString(512, 'Repair result item id'),
  actionId: nonBlankString(512, 'Repair result action id'),
  status: z.enum(['applied', 'skipped', 'failed']),
  message: nonBlankString(4_000, 'Repair result message'),
  affectedCheckIds: z.array(nonBlankString(512, 'Affected check id')),
  changes: z.array(healthRepairChangeOutputSchema),
}).strict()

export const healthRepairApplyOutputSchema = z.array(healthRepairApplyResultOutputSchema)

function issuePath(path: PropertyKey[]): string {
  return path.length === 0 ? '$' : path.map(String).join('.')
}

function safeIssueMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'custom') return issue.message
  switch (issue.code) {
    case 'invalid_type': return 'Value has an invalid type.'
    case 'invalid_value': return 'Value is not permitted.'
    case 'invalid_union': return 'Value does not match the required contract variant.'
    case 'unrecognized_keys': return 'Object contains unrecognized keys.'
    case 'too_small': return 'Value is below the allowed bound.'
    case 'too_big': return 'Value exceeds the allowed bound.'
    case 'invalid_format': return 'Value has an invalid format.'
    case 'not_multiple_of': return 'Number is not an allowed multiple.'
    default: return 'Value failed contract validation.'
  }
}

function sanitizeIssues(error: z.ZodError): HealthContractIssue[] {
  return error.issues.map((issue) => {
    const contractCode = 'params' in issue
      ? (issue.params as { contractCode?: unknown } | undefined)?.contractCode
      : undefined
    return {
      code: typeof contractCode === 'string' ? contractCode : issue.code,
      path: issuePath(issue.path),
      message: safeIssueMessage(issue),
    }
  })
}

function safeParseContract<T>(
  schema: z.ZodType,
  input: unknown,
  code: HealthContractErrorCode,
  message: string,
): HealthContractSafeParseResult<T> {
  try {
    const result = schema.safeParse(input)
    return result.success
      ? { success: true, data: result.data as T }
      : { success: false, error: contractError(code, message, result.error) }
  } catch {
    return {
      success: false,
      error: new HealthContractError(code, message, [{
        code: 'validation_exception',
        path: '$',
        message: 'Contract input could not be inspected safely.',
      }]),
    }
  }
}

function contractError(
  code: HealthContractErrorCode,
  message: string,
  error: z.ZodError,
): HealthContractError {
  return new HealthContractError(code, message, sanitizeIssues(error))
}

export function safeParseHealthCheckRegistration(
  input: unknown,
): HealthContractSafeParseResult<HealthCheckRegistrationInput> {
  return safeParseContract(
    healthCheckRegistrationInputSchema,
    input,
    'INVALID_HEALTH_REGISTRATION',
    REGISTRATION_ERROR_MESSAGE,
  )
}

export function parseHealthCheckRegistration(input: unknown): HealthCheckRegistrationInput {
  const result = safeParseHealthCheckRegistration(input)
  if (!result.success) throw result.error
  return result.data
}

export function safeParseHealthRepairActionDefinition(
  input: unknown,
): HealthContractSafeParseResult<HealthRepairActionDefinition> {
  return safeParseContract(
    healthRepairActionDefinitionSchema,
    input,
    'INVALID_HEALTH_REPAIR_ACTION',
    REPAIR_ACTION_ERROR_MESSAGE,
  )
}

export function parseHealthRepairActionDefinition(input: unknown): HealthRepairActionDefinition {
  const result = safeParseHealthRepairActionDefinition(input)
  if (!result.success) throw result.error
  return result.data
}

export function safeParseHealthRepairPlanOutput(
  input: unknown,
): HealthContractSafeParseResult<HealthRepairPlanItem[]> {
  return safeParseContract(
    healthRepairPlanOutputSchema,
    input,
    'INVALID_HEALTH_REPAIR_PLAN_OUTPUT',
    REPAIR_PLAN_OUTPUT_ERROR_MESSAGE,
  )
}

export function parseHealthRepairPlanOutput(input: unknown): HealthRepairPlanItem[] {
  const result = safeParseHealthRepairPlanOutput(input)
  if (!result.success) throw result.error
  return result.data
}

export function safeParseHealthRepairApplyOutput(
  input: unknown,
): HealthContractSafeParseResult<HealthRepairApplyResult[]> {
  return safeParseContract(
    healthRepairApplyOutputSchema,
    input,
    'INVALID_HEALTH_REPAIR_APPLY_OUTPUT',
    REPAIR_APPLY_OUTPUT_ERROR_MESSAGE,
  )
}

export function parseHealthRepairApplyOutput(input: unknown): HealthRepairApplyResult[] {
  const result = safeParseHealthRepairApplyOutput(input)
  if (!result.success) throw result.error
  return result.data
}

const healthResourceKindSchema = z.enum([
  'system',
  'runtime',
  'service',
  'plugin',
  'agent',
  'team',
  'session',
  'search_table',
  'task',
  'workflow',
  'asset',
  'schedule',
  'budget_rule',
  'model',
  'channel',
  'capability',
  'setting',
  'directory',
  'file',
  'other',
])

export const healthResourceSchema = z.object({
  kind: healthResourceKindSchema,
  id: stableKeySchema,
  label: nonBlankString(120, 'Resource label').optional(),
}).strict()

function isSameOriginApplicationPath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false
  if (/\p{Cc}/u.test(value)) return false
  try {
    const base = new URL('http://bakin.local')
    return new URL(value, base).origin === base.origin
  } catch {
    return false
  }
}

const resolutionBaseShape = {
  key: stableKeySchema,
  label: nonBlankString(120, 'Resolution label'),
}

export const healthRepairResolutionSchema = z.object({
  ...resolutionBaseShape,
  type: z.literal('repair'),
  actionId: stableKeySchema,
}).strict()

export const healthNavigateResolutionSchema = z.object({
  ...resolutionBaseShape,
  type: z.literal('navigate'),
  href: nonBlankString(4_000, 'Navigation path').refine(
    isSameOriginApplicationPath,
    'Navigation href must be a same-origin application path.',
  ),
}).strict()

export const healthInstructionsResolutionSchema = z.object({
  ...resolutionBaseShape,
  type: z.literal('instructions'),
  steps: z.array(nonBlankString(4_000, 'Instruction step')).min(1, 'At least one instruction step is required.'),
  command: nonBlankString(4_000, 'Command').optional(),
}).strict()

export const healthRerunResolutionSchema = z.object({
  ...resolutionBaseShape,
  type: z.literal('rerun'),
}).strict()

export const healthResolutionSchema = z.discriminatedUnion('type', [
  healthRepairResolutionSchema,
  healthNavigateResolutionSchema,
  healthInstructionsResolutionSchema,
  healthRerunResolutionSchema,
])

const incidentBaseShape = {
  key: stableKeySchema,
  title: nonBlankString(120, 'Incident title'),
  impact: nonBlankString(500, 'Incident impact'),
  /** Producer-stamped behavior class (#690); absent = unclassified (never demoted). */
  class: z.enum(HEALTH_INCIDENT_CLASSES).optional(),
  resources: z.array(healthResourceSchema).max(50, 'An incident may reference at most 50 resources.').optional(),
  resolution: healthResolutionSchema,
}

export const advisoryIncidentInputSchema = z.object({
  ...incidentBaseShape,
  disposition: z.literal('advisory'),
}).strict()

export const watchIncidentInputSchema = z.object({
  ...incidentBaseShape,
  disposition: z.literal('watch'),
}).strict()

export const actionIncidentInputSchema = z.object({
  ...incidentBaseShape,
  disposition: z.literal('action_required'),
}).strict()

export const healthIncidentInputSchema = z.discriminatedUnion('disposition', [
  advisoryIncidentInputSchema,
  watchIncidentInputSchema,
  actionIncidentInputSchema,
])

const MAX_EVIDENCE_BYTES = 32 * 1024
const MAX_EVIDENCE_ISSUES = 50

type EvidenceFrame =
  | { kind: 'visit'; value: unknown; path: PropertyKey[] }
  | { kind: 'exit'; value: object }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isSensitiveEvidenceKey(key: string): boolean {
  const normalized = key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (normalized.length === 0) return false
  return normalized.includes('password')
    || normalized.includes('passwd')
    || normalized.includes('secret')
    || normalized.endsWith('token')
    || normalized.includes('apikey')
    || normalized.includes('privatekey')
    || normalized.includes('authorization')
    || normalized.endsWith('cookie')
    || normalized.includes('credential')
    || normalized === 'auth'
    || normalized.endsWith('auth')
}

function addEvidenceIssue(
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  contractCode: string,
  message: string,
): void {
  if (ctx.issues.length >= MAX_EVIDENCE_ISSUES) return
  ctx.addIssue({ code: 'custom', path, message, params: { contractCode } })
}

function validateEvidenceValue(value: unknown, ctx: z.RefinementCtx): void {
  const active = new Set<object>()
  const stack: EvidenceFrame[] = [{ kind: 'visit', value, path: [] }]

  while (stack.length > 0 && ctx.issues.length < MAX_EVIDENCE_ISSUES) {
    const frame = stack.pop()!
    if (frame.kind === 'exit') {
      active.delete(frame.value)
      continue
    }

    const current = frame.value
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        addEvidenceIssue(ctx, frame.path, 'non_json_evidence', 'Evidence numbers must be finite.')
      }
      continue
    }
    if (typeof current !== 'object') {
      addEvidenceIssue(ctx, frame.path, 'non_json_evidence', 'Evidence contains a non-JSON value.')
      continue
    }
    if (active.has(current)) {
      addEvidenceIssue(ctx, frame.path, 'cyclic_evidence', 'Evidence must not contain cycles.')
      continue
    }

    active.add(current)
    stack.push({ kind: 'exit', value: current })

    if (Array.isArray(current)) {
      const descriptors = Object.getOwnPropertyDescriptors(current)
      const keys = Reflect.ownKeys(descriptors).filter((key) => key !== 'length')
      const numericKeys: string[] = []
      for (const key of keys) {
        if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) {
          addEvidenceIssue(ctx, [...frame.path, key], 'non_json_evidence', 'Evidence arrays may contain indexed values only.')
          continue
        }
        const index = Number(key)
        if (!Number.isSafeInteger(index) || index >= current.length) {
          addEvidenceIssue(ctx, [...frame.path, key], 'non_json_evidence', 'Evidence contains an invalid array index.')
          continue
        }
        numericKeys.push(key)
      }
      if (numericKeys.length !== current.length) {
        addEvidenceIssue(ctx, frame.path, 'non_json_evidence', 'Evidence arrays must not be sparse.')
      }
      for (let index = numericKeys.length - 1; index >= 0; index--) {
        const key = numericKeys[index]!
        const descriptor = descriptors[key]
        if (!descriptor || !('value' in descriptor)) {
          addEvidenceIssue(ctx, [...frame.path, key], 'non_json_evidence', 'Evidence must not contain accessor properties.')
          continue
        }
        stack.push({ kind: 'visit', value: descriptor.value, path: [...frame.path, Number(key)] })
      }
      continue
    }

    if (!isPlainObject(current)) {
      addEvidenceIssue(ctx, frame.path, 'non_json_evidence', 'Evidence objects must use a plain object prototype.')
      continue
    }

    const descriptors = Object.getOwnPropertyDescriptors(current)
    const keys = Reflect.ownKeys(descriptors)
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!
      if (typeof key !== 'string') {
        addEvidenceIssue(ctx, [...frame.path, key], 'non_json_evidence', 'Evidence object keys must be strings.')
        continue
      }
      if (isSensitiveEvidenceKey(key)) {
        addEvidenceIssue(ctx, [...frame.path, key], 'sensitive_evidence_key', 'Evidence contains a sensitive key.')
        continue
      }
      const descriptor = descriptors[key]
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        addEvidenceIssue(ctx, [...frame.path, key], 'non_json_evidence', 'Evidence properties must be enumerable data properties.')
        continue
      }
      stack.push({ kind: 'visit', value: descriptor.value, path: [...frame.path, key] })
    }
  }
}

const encoder = new TextEncoder()

function primitiveJsonBytes(value: string | number | boolean | null): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

/** Exact JSON byte count without recursively stringifying an untrusted graph. */
function serializedEvidenceBytes(root: Record<string, unknown>): number {
  const stack: unknown[] = [root]
  let bytes = 0

  while (stack.length > 0) {
    const value = stack.pop()
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      bytes += primitiveJsonBytes(value)
    } else if (Array.isArray(value)) {
      bytes += 2 + Math.max(0, value.length - 1)
      for (let index = value.length - 1; index >= 0; index--) stack.push(value[index])
    } else {
      const descriptors = Object.getOwnPropertyDescriptors(value as Record<string, unknown>)
      const keys = Object.keys(descriptors)
      bytes += 2 + Math.max(0, keys.length - 1) + keys.length
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index]!
        bytes += primitiveJsonBytes(key)
        stack.push(descriptors[key]!.value)
      }
    }
    if (bytes > MAX_EVIDENCE_BYTES) return bytes
  }
  return bytes
}

/** JSON-only, secret-redacted-by-rejection evidence with a 32 KiB wire bound. */
export const healthEvidenceSchema = z.custom<Record<string, unknown>>(
  isPlainObject,
  { message: 'Evidence must be a JSON object.' },
).superRefine((evidence, ctx) => {
  validateEvidenceValue(evidence, ctx)
  if (ctx.issues.length > 0) return
  if (serializedEvidenceBytes(evidence) > MAX_EVIDENCE_BYTES) {
    addEvidenceIssue(ctx, [], 'evidence_too_large', 'Serialized evidence must not exceed 32 KiB.')
  }
})

const observationBaseShape = {
  key: stableKeySchema,
  summary: nonBlankString(500, 'Observation summary'),
  detail: nonBlankString(4_000, 'Observation detail').optional(),
  sourceObservedAt: z.iso.datetime({ offset: true }).optional(),
  evidence: healthEvidenceSchema.optional(),
}

export const healthyObservationInputSchema = z.object({
  ...observationBaseShape,
  status: z.literal('healthy'),
  incident: z.never().optional(),
}).strict()

export const warningObservationInputSchema = z.object({
  ...observationBaseShape,
  status: z.literal('warning'),
  incident: healthIncidentInputSchema,
}).strict()

export const errorObservationInputSchema = z.object({
  ...observationBaseShape,
  status: z.literal('error'),
  incident: actionIncidentInputSchema,
}).strict()

export const unknownObservationInputSchema = z.object({
  ...observationBaseShape,
  status: z.literal('unknown'),
  // watch, or advisory when the producer vouches the unknown self-resolves
  // (scan warm-up, attribution landing). Never action_required.
  incident: z.union([watchIncidentInputSchema, advisoryIncidentInputSchema]),
}).strict()

export const healthObservationInputSchema = z.discriminatedUnion('status', [
  healthyObservationInputSchema,
  warningObservationInputSchema,
  errorObservationInputSchema,
  unknownObservationInputSchema,
])

const observedHealthCheckRunInputSchema = z.object({
  outcome: z.literal('observed'),
  observations: z.array(healthObservationInputSchema).min(1, 'An observed run must return at least one observation.'),
}).strict()

const notApplicableHealthCheckRunInputSchema = z.object({
  outcome: z.literal('not_applicable'),
  reason: nonBlankString(500, 'Not-applicable reason'),
}).strict()

/** Exact status-discriminated producer run-output schema. */
export const healthCheckRunInputSchema = z.discriminatedUnion('outcome', [
  observedHealthCheckRunInputSchema,
  notApplicableHealthCheckRunInputSchema,
])

export function safeParseHealthCheckRunInput(
  input: unknown,
): HealthContractSafeParseResult<HealthCheckRunInput> {
  return safeParseContract(
    healthCheckRunInputSchema,
    input,
    'INVALID_HEALTH_RUN_OUTPUT',
    RUN_OUTPUT_ERROR_MESSAGE,
  )
}

export function parseHealthCheckRunInput(input: unknown): HealthCheckRunInput {
  const result = safeParseHealthCheckRunInput(input)
  if (!result.success) throw result.error
  return result.data
}
