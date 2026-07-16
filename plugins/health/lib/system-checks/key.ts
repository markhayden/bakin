/**
 * Normalize external identifiers before using them in stable Health keys.
 *
 * Health keys are persisted in reports and linked from incidents, so every
 * check must apply the same normalization and length bound.
 */
export function stableKeyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]/g, '-').slice(0, 100) || 'unknown'
}
