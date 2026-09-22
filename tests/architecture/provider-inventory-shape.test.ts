/**
 * The runtime credential inventory (`credentials.providers()`, #907 / #378
 * model slice) is STATUS-ONLY by contract: it tells Bakin which providers
 * are configured, never what the credential is. This scanner pins the
 * declared TypeScript shape so a field that could carry secret material
 * can never be added to the contract — the conformance suite covers the
 * runtime values; this covers the type.
 *
 * Pure source scan: imports no app modules (content-dir mocks not needed).
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const CONCEPTS = join(process.cwd(), 'packages/core/src/adapters/runtime/concepts.ts')

const ALLOWED_FIELDS: Record<string, Set<string>> = {
  ProviderCredentialStatus: new Set(['providerId', 'configured', 'authFree', 'source']),
  ProviderCredentialInventory: new Set(['providers', 'evidence', 'detail']),
}

/** Field names that would let secret material ride on a status record. */
const SECRET_FIELD_RE = /^(?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|password|credential|bearer|key)$/i

function interfaceFields(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`)
  if (start === -1) throw new Error(`interface ${name} not declared in concepts.ts`)
  const body = source.slice(start, source.indexOf('\n}', start))
  return [...body.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]!)
}

describe('provider credential inventory is status-only (type shape)', () => {
  const source = readFileSync(CONCEPTS, 'utf8')

  for (const [name, allowed] of Object.entries(ALLOWED_FIELDS)) {
    it(`${name} declares only the allowed status fields`, () => {
      const fields = interfaceFields(source, name)
      expect(fields.length).toBeGreaterThan(0)
      for (const field of fields) {
        expect(allowed.has(field)).toBe(true)
        expect(SECRET_FIELD_RE.test(field)).toBe(false)
      }
    })
  }

  it('the secret-field pattern has teeth', () => {
    for (const bad of ['apiKey', 'api_key', 'token', 'accessToken', 'refresh_token', 'secret', 'password', 'credential', 'key']) {
      expect(SECRET_FIELD_RE.test(bad)).toBe(true)
    }
    for (const fine of ['providerId', 'configured', 'authFree', 'source', 'evidence', 'detail']) {
      expect(SECRET_FIELD_RE.test(fine)).toBe(false)
    }
  })
})
