import { describe, expect, it } from 'bun:test'
import { renderSdkReference } from '../../scripts/docs/lib/sdk-reference'

describe('generated SDK Health reference', () => {
  it('resolves the canonical Health leaf behind the public types star export', () => {
    const reference = renderSdkReference()

    expect(reference).toContain('### Health')
    expect(reference).toContain('| `HealthCheckRegistrationInput` |')
    expect(reference).toContain('| `HealthObservationInput` |')
    expect(reference).toContain('| `HealthReport` |')
    expect(reference).toContain('| `HealthRepairActionDefinition` |')

    const retiredNames = [
      ['Health', 'Check', 'Result'],
      ['Plugin', 'Health', 'Check', 'Input'],
      ['Health', 'Repair', 'Handler'],
    ].map(parts => `\`${parts.join('')}\``)

    for (const retiredName of retiredNames) {
      expect(reference).not.toContain(retiredName)
    }
  })
})
