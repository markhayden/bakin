import { describe, expect, it } from 'bun:test'
import type { HealthCheckRegistrationInput } from '@makinbakin/sdk/types'

import {
  HealthContractError,
  healthCheckRegistrationInputSchema,
  healthCheckRunInputSchema,
  healthRepairActionDefinitionSchema,
  parseHealthCheckRegistration,
  parseHealthCheckRunInput,
  parseHealthRepairActionDefinition,
  safeParseHealthCheckRegistration,
  safeParseHealthCheckRunInput,
  safeParseHealthRepairApplyOutput,
  safeParseHealthRepairActionDefinition,
  safeParseHealthRepairPlanOutput,
} from '../../src/core/health-contract'

function validRegistration(): HealthCheckRegistrationInput {
  return {
    id: 'runtime.reachability',
    name: 'Runtime reachability',
    description: 'Verifies that the configured runtime can serve turns.',
    group: { key: 'runtime', label: 'Runtime' },
    maxAgeMs: 60_000,
    timeoutMs: 15_000,
    run: async () => ({
      outcome: 'observed' as const,
      observations: [{ key: 'ping', status: 'healthy' as const, summary: 'Runtime answered the probe.' }],
    }),
  }
}

function warningObservation(overrides: Record<string, unknown> = {}) {
  return {
    key: 'journal.backlog',
    status: 'warning',
    summary: 'Search writes are waiting to drain.',
    detail: 'The oldest pending write is still within the recovery window.',
    sourceObservedAt: '2026-07-13T12:00:00.000Z',
    evidence: { pending: 3, tables: ['bakin_tasks'] },
    incident: {
      key: 'journal-backlog',
      title: 'Search journal is behind',
      impact: 'New content may take longer to appear in Search.',
      disposition: 'watch',
      resources: [{ kind: 'service', id: 'search', label: 'Search' }],
      resolution: {
        key: 'review-search',
        type: 'navigate',
        label: 'Review Search',
        href: '/health?tab=system&section=search',
      },
    },
    ...overrides,
  }
}

function observed(observation: Record<string, unknown>) {
  return { outcome: 'observed', observations: [observation] }
}

describe('health registration validation', () => {
  it('accepts an exact registration with a callable run function', () => {
    const input = validRegistration()

    expect(healthCheckRegistrationInputSchema.parse(input)).toEqual(input)
    expect(parseHealthCheckRegistration(input)).toEqual(input)
    expect(safeParseHealthCheckRegistration(input)).toEqual({ success: true, data: input })
  })

  it('rejects invalid identifiers, missing callables, bounds, and unknown legacy fields', () => {
    const invalid = {
      ...validRegistration(),
      id: 'Runtime Reachability',
      name: 'x'.repeat(121),
      description: 'x'.repeat(501),
      group: { key: '-runtime', label: '' },
      maxAgeMs: 0,
      timeoutMs: 0,
      run: 'not callable',
      autoFix: true,
    }

    const result = safeParseHealthCheckRegistration(invalid)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected registration validation to fail')
    expect(result.error).toBeInstanceOf(HealthContractError)
    expect(result.error.code).toBe('INVALID_HEALTH_REGISTRATION')
    expect(result.error.path).toBe('id')
    expect(result.error.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'id',
      'name',
      'description',
      'group.key',
      'group.label',
      'maxAgeMs',
      'timeoutMs',
      'run',
    ]))
    expect(result.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true)
  })

  it('throws a structured error without retaining or printing the rejected payload', () => {
    const secretValue = 'Do Not Leak This Value'
    let thrown: unknown

    try {
      parseHealthCheckRegistration({ ...validRegistration(), id: secretValue })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(HealthContractError)
    const error = thrown as HealthContractError
    expect(error.message).not.toContain(secretValue)
    expect(JSON.stringify(error)).not.toContain(secretValue)
    expect(error.toJSON()).toEqual({
      code: 'INVALID_HEALTH_REGISTRATION',
      path: 'id',
      message: 'Health registration failed contract validation.',
      issues: error.issues,
    })
  })
})

describe('health repair-action validation', () => {
  it('accepts an exact owner-local repair action with callable handlers', () => {
    const input = {
      id: 'rebuild-index',
      name: 'Rebuild Search index',
      plan: async () => [],
      apply: async () => [],
    }

    expect(healthRepairActionDefinitionSchema.parse(input)).toEqual(input)
    expect(parseHealthRepairActionDefinition(input)).toEqual(input)
    expect(safeParseHealthRepairActionDefinition(input)).toEqual({ success: true, data: input })
  })

  it('rejects invalid identity, handlers, and unknown legacy fields with a distinct error code', () => {
    const result = safeParseHealthRepairActionDefinition({
      id: 'Rebuild Index',
      name: '',
      plan: [],
      apply: null,
      autoFix: true,
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected repair-action validation to fail')
    expect(result.error).toBeInstanceOf(HealthContractError)
    expect(result.error.code).toBe('INVALID_HEALTH_REPAIR_ACTION')
    expect(result.error.path).toBe('id')
    expect(result.error.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'id',
      'name',
      'plan',
      'apply',
    ]))
    expect(result.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true)
  })

  it('throws a payload-free HealthContractError from the parse utility', () => {
    const rejected = 'Sensitive Repair Name'

    expect(() => parseHealthRepairActionDefinition({
      id: rejected,
      name: 'Repair',
      plan: async () => [],
      apply: async () => [],
    })).toThrow(HealthContractError)

    const result = safeParseHealthRepairActionDefinition({
      id: rejected,
      name: 'Repair',
      plan: async () => [],
      apply: async () => [],
    })
    if (result.success) throw new Error('expected repair-action validation to fail')
    expect(JSON.stringify(result.error)).not.toContain(rejected)
  })

  it('validates exact callback outputs with payload-free, phase-specific failures', () => {
    const item = {
      id: 'restart-engine',
      actionId: 'restart-search',
      title: 'Restart Search',
      reason: 'Search is unavailable.',
      safety: 'safe' as const,
      incidentIds: [], observationIds: [], preconditions: [],
      changes: [{ kind: 'service' as const, target: 'search', action: 'invoke' as const, description: 'Restart Search.' }],
    }
    const applyResult = {
      itemId: 'health.restart-search:restart-engine',
      actionId: 'health.restart-search',
      status: 'applied' as const,
      message: 'Restarted Search.',
      affectedCheckIds: ['health.search'],
      changes: item.changes,
    }

    expect(safeParseHealthRepairPlanOutput([item])).toEqual({ success: true, data: [item] })
    expect(safeParseHealthRepairApplyOutput([applyResult])).toEqual({ success: true, data: [applyResult] })

    const secret = 'repair-output-secret'
    const invalidPlan = safeParseHealthRepairPlanOutput([{ ...item, secret }])
    const invalidApply = safeParseHealthRepairApplyOutput([{ ...applyResult, secret }])
    expect(invalidPlan.success).toBe(false)
    expect(invalidApply.success).toBe(false)
    if (invalidPlan.success || invalidApply.success) throw new Error('expected callback outputs to fail')
    expect(invalidPlan.error.code).toBe('INVALID_HEALTH_REPAIR_PLAN_OUTPUT')
    expect(invalidApply.error.code).toBe('INVALID_HEALTH_REPAIR_APPLY_OUTPUT')
    expect(JSON.stringify([invalidPlan.error, invalidApply.error])).not.toContain(secret)
  })
})

describe('health run-output validation', () => {
  it('accepts every resolution variant and JSON-safe evidence', () => {
    const observations = [
      warningObservation(),
      warningObservation({
        key: 'manual-resolution',
        incident: {
          ...(warningObservation().incident as Record<string, unknown>),
          key: 'manual-resolution',
          resolution: {
            key: 'follow-steps',
            type: 'instructions',
            label: 'Follow recovery steps',
            steps: ['Inspect the service log.', 'Restart the service if the process is wedged.'],
            command: 'bakin doctor --full',
          },
        },
      }),
      warningObservation({
        key: 'repair-resolution',
        incident: {
          ...(warningObservation().incident as Record<string, unknown>),
          key: 'repair-resolution',
          disposition: 'action_required',
          resolution: {
            key: 'rebuild-index',
            type: 'repair',
            label: 'Rebuild index',
            actionId: 'rebuild-index',
          },
        },
      }),
      warningObservation({
        key: 'rerun-resolution',
        incident: {
          ...(warningObservation().incident as Record<string, unknown>),
          key: 'rerun-resolution',
          resolution: { key: 'rerun', type: 'rerun', label: 'Run checks again' },
        },
        evidence: {
          nullable: null,
          boolean: true,
          integer: 3,
          decimal: 1.5,
          text: 'safe',
          nested: { rows: [{ id: 'one', healthy: true }] },
        },
      }),
    ]
    const input = { outcome: 'observed', observations }

    expect(healthCheckRunInputSchema.safeParse(input).success).toBe(true)
    const parsed = parseHealthCheckRunInput(input)
    expect(parsed.outcome).toBe('observed')
    if (parsed.outcome !== 'observed') throw new Error('expected observed run')
    expect(parsed.observations.map((observation) => observation.incident?.resolution.type)).toEqual([
      'navigate',
      'instructions',
      'repair',
      'rerun',
    ])
    expect(safeParseHealthCheckRunInput(input).success).toBe(true)
  })

  it('accepts an explicit not-applicable result', () => {
    const input = { outcome: 'not_applicable' as const, reason: 'Search is disabled in settings.' }

    expect(parseHealthCheckRunInput(input)).toEqual(input)
  })

  it('rejects empty observed runs and unknown output fields', () => {
    const empty = safeParseHealthCheckRunInput({ outcome: 'observed', observations: [] })
    const extra = safeParseHealthCheckRunInput({
      outcome: 'not_applicable',
      reason: 'Not configured.',
      results: [],
    })

    expect(empty.success).toBe(false)
    expect(extra.success).toBe(false)
    if (extra.success) throw new Error('expected exact schema validation to fail')
    expect(extra.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true)
  })

  it('enforces the observation status, incident, and disposition invariants', () => {
    const healthyWithIncident = safeParseHealthCheckRunInput(observed(warningObservation({ status: 'healthy' })))
    const warningWithoutIncident = safeParseHealthCheckRunInput(observed({
      key: 'slow',
      status: 'warning',
      summary: 'The operation is slow.',
    }))
    const errorWithWatch = safeParseHealthCheckRunInput(observed(warningObservation({ status: 'error' })))
    const unknownWithAction = safeParseHealthCheckRunInput(observed(warningObservation({
      status: 'unknown',
      incident: {
        ...(warningObservation().incident as Record<string, unknown>),
        disposition: 'action_required',
      },
    })))

    expect(healthyWithIncident.success).toBe(false)
    expect(warningWithoutIncident.success).toBe(false)
    expect(errorWithWatch.success).toBe(false)
    expect(unknownWithAction.success).toBe(false)

    expect(parseHealthCheckRunInput(observed(warningObservation({
      status: 'error',
      incident: {
        ...(warningObservation().incident as Record<string, unknown>),
        disposition: 'action_required',
      },
    })))).toBeDefined()
    expect(parseHealthCheckRunInput(observed(warningObservation({ status: 'unknown' })))).toBeDefined()
  })

  it('enforces stable keys, string limits, resource bounds, and ISO source times', () => {
    const resources = Array.from({ length: 51 }, (_, index) => ({ kind: 'other', id: `resource-${index}` }))
    const invalid = warningObservation({
      key: '-invalid',
      summary: 'x'.repeat(501),
      detail: 'x'.repeat(4_001),
      sourceObservedAt: 'yesterday',
      incident: {
        ...(warningObservation().incident as Record<string, unknown>),
        key: 'Invalid key',
        title: 'x'.repeat(121),
        impact: 'x'.repeat(501),
        resources,
      },
    })

    const result = safeParseHealthCheckRunInput(observed(invalid))

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected bounded strings to fail')
    expect(result.error.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'observations.0.key',
      'observations.0.summary',
      'observations.0.detail',
      'observations.0.sourceObservedAt',
      'observations.0.incident.key',
      'observations.0.incident.title',
      'observations.0.incident.impact',
      'observations.0.incident.resources',
    ]))
  })

  it('allows only same-origin application navigation paths', () => {
    for (const href of [
      'https://evil.example/health',
      '//evil.example/health',
      '/\\evil.example/health',
      'health?tab=system',
      'javascript:alert(1)',
    ]) {
      const observation = warningObservation({
        incident: {
          ...(warningObservation().incident as Record<string, unknown>),
          resolution: { key: 'review', type: 'navigate', label: 'Review', href },
        },
      })

      expect(safeParseHealthCheckRunInput(observed(observation)).success).toBe(false)
    }

    expect(safeParseHealthCheckRunInput(observed(warningObservation({
      incident: {
        ...(warningObservation().incident as Record<string, unknown>),
        resolution: { key: 'review', type: 'navigate', label: 'Review', href: '/health?tab=system#search' },
      },
    }))).success).toBe(true)
  })

  it('rejects sensitive evidence keys at any depth across case and separator variants', () => {
    const sensitiveKeys = [
      'secret',
      'clientSecret',
      'PASSWORD',
      'access_token',
      'refresh-token',
      'api.key',
      'private_key',
      'authorization',
      'sessionCookie',
      'credentials',
    ]

    for (const key of sensitiveKeys) {
      const secretValue = `hidden-${key}`
      const result = safeParseHealthCheckRunInput(observed(warningObservation({
        evidence: { safe: { nested: { [key]: secretValue } } },
      })))

      expect(result.success).toBe(false)
      if (result.success) throw new Error(`expected sensitive key ${key} to fail`)
      expect(result.error.code).toBe('INVALID_HEALTH_RUN_OUTPUT')
      expect(result.error.path).toBe(`observations.0.evidence.safe.nested.${key}`)
      expect(result.error.message).not.toContain(secretValue)
      expect(JSON.stringify(result.error)).not.toContain(secretValue)
    }

    expect(safeParseHealthCheckRunInput(observed(warningObservation({
      evidence: { inputTokens: 100, tokenCount: 100, cacheReadTokens: 50 },
    }))).success).toBe(true)
  })

  it('rejects non-JSON values, sparse arrays, and cycles', () => {
    const cyclic: Record<string, unknown> = { healthy: true }
    cyclic.self = cyclic
    const nonJsonValues: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      BigInt(1),
      Symbol('not-json'),
      () => 'not-json',
      new Date('2026-07-13T12:00:00.000Z'),
      Object.assign(Object.create({ inherited: true }), { own: true }),
      cyclic,
    ]
    const sparse = new Array(2)
    sparse[1] = 'present'
    nonJsonValues.push(sparse)

    for (const value of nonJsonValues) {
      const result = safeParseHealthCheckRunInput(observed(warningObservation({ evidence: { value } })))
      expect(result.success).toBe(false)
    }
  })

  it('enforces the 32 KiB serialized evidence limit using UTF-8 bytes', () => {
    const belowLimit = safeParseHealthCheckRunInput(observed(warningObservation({
      evidence: { sample: 'a'.repeat(32_000) },
    })))
    const aboveLimit = safeParseHealthCheckRunInput(observed(warningObservation({
      evidence: { sample: 'é'.repeat(17_000) },
    })))

    expect(belowLimit.success).toBe(true)
    expect(aboveLimit.success).toBe(false)
    if (aboveLimit.success) throw new Error('expected oversized evidence to fail')
    expect(aboveLimit.error.path).toBe('observations.0.evidence')
    expect(aboveLimit.error.issues.some((issue) => issue.code === 'evidence_too_large')).toBe(true)
  })

  it('returns a structured safe-parse failure suitable for runner synthesis', () => {
    const result = safeParseHealthCheckRunInput({ outcome: 'observed', observations: [] })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected malformed run output to fail')
    expect(result.error).toBeInstanceOf(HealthContractError)
    expect(result.error).toMatchObject({
      name: 'HealthContractError',
      code: 'INVALID_HEALTH_RUN_OUTPUT',
      message: 'Health check run output failed contract validation.',
    })
    expect(result.error.path).toBe('observations')
    expect(result.error.issues.length).toBeGreaterThan(0)
    expect(result.error.issues[0]).toEqual(expect.objectContaining({
      code: expect.any(String),
      path: expect.any(String),
      message: expect.any(String),
    }))
  })

  it('contains hostile inspection failures without exposing their thrown value', () => {
    const secretValue = 'proxy-secret-value'
    const hostileEvidence = new Proxy({}, {
      getPrototypeOf() {
        throw new Error(secretValue)
      },
    })

    const result = safeParseHealthCheckRunInput(observed(warningObservation({ evidence: hostileEvidence })))

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected hostile evidence to fail')
    expect(result.error.issues).toEqual([{
      code: 'validation_exception',
      path: '$',
      message: 'Contract input could not be inspected safely.',
    }])
    expect(JSON.stringify(result.error)).not.toContain(secretValue)
  })
})
