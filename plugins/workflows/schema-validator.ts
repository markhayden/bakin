/**
 * JSON Schema validation for workflow step outputs.
 * Uses ajv for full JSON Schema draft-07 support.
 */
import Ajv from 'ajv'

const ajv = new Ajv({ allErrors: true })

export interface ValidationResult {
  valid: boolean
  errors?: string[]
}

/**
 * Validate step output against a JSON Schema.
 * If no schema is provided, any output is accepted.
 */
export function validateStepOutput(
  schema: Record<string, unknown> | undefined,
  output: Record<string, unknown>
): ValidationResult {
  if (!schema) {
    return { valid: true }
  }

  const validate = ajv.compile(schema)
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
