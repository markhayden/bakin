import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { parseSecretsTemplate } from '../../../scripts/instance/op-resolve'

/**
 * Guard against the incident this rig has already seen once: a real 1Password
 * service-account token was pasted into the committed dev/docker/secrets.op.env
 * and had to be rotated. parseSecretsTemplate rejects any value that is not an
 * `op://` reference, but only at `instance up` — i.e. after a secret would have
 * already been committed/pushed. Running it over the COMMITTED file in CI turns
 * that runtime rejection into a build failure, so a pasted literal can't merge.
 *
 * This is the one instance test that intentionally reads a real repo file (a
 * committed template of references, never secrets) — not the disposable home.
 */
const COMMITTED_TEMPLATE = join(import.meta.dir, '../../../dev/docker/secrets.op.env')

describe('committed dev/docker/secrets.op.env', () => {
  it('contains only op:// references — never a pasted literal secret', () => {
    const text = readFileSync(COMMITTED_TEMPLATE, 'utf-8')
    // Throws if any non-comment, non-blank line is not `KEY=op://...`.
    const refs = parseSecretsTemplate(text)
    expect(refs.length).toBeGreaterThan(0)
    for (const { ref } of refs) {
      expect(ref.startsWith('op://')).toBe(true)
    }
  })
})
