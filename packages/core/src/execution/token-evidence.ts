/** Which usage evidence is meaningful for a tracked interaction. */
export type RunUsageKind = 'tokens' | 'media'

export interface RunTokenEvidenceInput {
  input?: number | null
  output?: number | null
  total?: number | null
  cacheRead?: number | null
  cacheWrite?: number | null
}

export interface NormalizedRunTokenEvidence {
  input: number | null
  output: number | null
  total: number | null
  cacheRead: number | null
  cacheWrite: number | null
}

function isReported(value: number | null | undefined): value is number {
  return value !== undefined && value !== null
}

/** Token counters are durable facts, so only non-negative safe integers qualify. */
function validTokenCount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Micro-dollar costs share the same durable non-negative integer contract. */
export function normalizeRunCostUsdMicros(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * Normalize runtime token evidence before it reaches any durable or live
 * consumer. Invalid evidence becomes unknown (NULL), never a plausible zero.
 * An explicit runtime total remains authoritative; a missing total is derived
 * only when every reported component is valid and the sum is itself safe.
 */
export function normalizeRunTokenEvidence(
  usageKind: RunUsageKind,
  input: RunTokenEvidenceInput = {},
): NormalizedRunTokenEvidence {
  if (usageKind === 'media') {
    return { input: null, output: null, total: null, cacheRead: null, cacheWrite: null }
  }

  const components = [input.input, input.output, input.cacheRead, input.cacheWrite]
  const componentsValid = components.every((value) => !isReported(value) || validTokenCount(value))
  const normalizedComponents = components.map((value) => validTokenCount(value) ? value : null)
  let total: number | null

  if (isReported(input.total)) {
    const baseTotal = validTokenCount(input.input) && validTokenCount(input.output)
      ? input.input + input.output
      : null
    total = validTokenCount(input.total)
      && componentsValid
      && (baseTotal === null || (Number.isSafeInteger(baseTotal) && input.total >= baseTotal))
      ? input.total
      : null
  } else {
    // Without an authoritative total, both base counters are required. Cache
    // counters remain optional and are additive only when the runtime reports
    // them. A lone input/output component is partial evidence, not a zero for
    // the missing side.
    if (!validTokenCount(input.input) || !validTokenCount(input.output) || !componentsValid) {
      total = null
    } else {
      const derived = input.input
        + input.output
        + (validTokenCount(input.cacheRead) ? input.cacheRead : 0)
        + (validTokenCount(input.cacheWrite) ? input.cacheWrite : 0)
      total = Number.isSafeInteger(derived) ? derived : null
    }
  }

  return {
    input: normalizedComponents[0]!,
    output: normalizedComponents[1]!,
    total,
    cacheRead: normalizedComponents[2]!,
    cacheWrite: normalizedComponents[3]!,
  }
}
