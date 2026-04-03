/**
 * JSON Schema validation for workflow step outputs.
 * Uses ajv for full JSON Schema draft-07 support.
 * Enforces strict mode: additionalProperties is disallowed when schema defines properties.
 */
import Ajv from 'ajv'

const ajv = new Ajv({ allErrors: true })

const MAX_OUTPUT_BYTES = 100_000 // 100KB

export interface ValidationResult {
  valid: boolean
  errors?: string[]
}

/**
 * Validate step output against a JSON Schema.
 * If no schema is provided, any output is accepted.
 * When a schema defines `properties`, `additionalProperties: false` is injected
 * to prevent agents from smuggling extra deliverables into the output.
 */
export function validateStepOutput(
  schema: Record<string, unknown> | undefined,
  output: Record<string, unknown>
): ValidationResult {
  // Size guard
  const serialized = JSON.stringify(output)
  if (serialized.length > MAX_OUTPUT_BYTES) {
    return { valid: false, errors: [`Output exceeds ${MAX_OUTPUT_BYTES / 1000}KB size limit (got ${Math.round(serialized.length / 1000)}KB)`] }
  }

  if (!schema) {
    return { valid: true }
  }

  // Enforce strict mode: disallow extra properties when schema defines properties
  const strictSchema = schema.properties && !('additionalProperties' in schema)
    ? { ...schema, additionalProperties: false }
    : schema

  const validate = ajv.compile(strictSchema)
  const valid = validate(output) as boolean

  if (valid) {
    return { valid: true }
  }

  const errors = (validate.errors || []).map(err => {
    const path = err.instancePath || ''
    const msg = err.message || 'validation error'
    return path ? `${path}: ${msg}` : msg
  })

  return { valid: false, errors }
}

/**
 * Detect if submitted output is a near-duplicate of previously rejected output.
 * Returns an error message if similarity exceeds threshold.
 */
export function detectRejectionRepeat(
  previousOutput: Record<string, unknown> | undefined,
  newOutput: Record<string, unknown>,
  threshold = 0.95
): string | null {
  if (!previousOutput) return null

  const prev = JSON.stringify(previousOutput, Object.keys(previousOutput).sort())
  const curr = JSON.stringify(newOutput, Object.keys(newOutput).sort())

  if (prev === curr) {
    return 'Output is identical to the previously rejected version. You MUST address the rejection feedback before resubmitting.'
  }

  // Simple character-level similarity using longest common subsequence approximation
  const maxLen = Math.max(prev.length, curr.length)
  if (maxLen === 0) return null

  let matches = 0
  const shorter = prev.length <= curr.length ? prev : curr
  const longer = prev.length > curr.length ? prev : curr
  // Sliding window match count for approximate similarity
  const windowSize = Math.min(10, shorter.length)
  const windows = new Set<string>()
  for (let i = 0; i <= shorter.length - windowSize; i++) {
    windows.add(shorter.slice(i, i + windowSize))
  }
  for (let i = 0; i <= longer.length - windowSize; i++) {
    if (windows.has(longer.slice(i, i + windowSize))) matches++
  }
  const totalWindows = Math.max(longer.length - windowSize + 1, 1)
  const similarity = matches / totalWindows

  if (similarity >= threshold) {
    return `Output appears ${Math.round(similarity * 100)}% similar to the previously rejected version. Address the rejection feedback — do not resubmit with only cosmetic changes.`
  }

  return null
}
