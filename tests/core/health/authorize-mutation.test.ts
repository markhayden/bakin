/**
 * The ONE authorization gate (spec §3.2, A1): every mutation path — auto-apply,
 * convergence, Health repairs, CLI --yes, agent tools — asks the same
 * question. Table-driven over actor × mutation × kind × source × delta ×
 * reviewed. Pure — no mocks needed.
 */
import { describe, expect, it } from 'bun:test'
import {
  authorizeMutation,
  SHARED_ENGINE_ACTIONS,
  type MutationAuthorizationInput,
} from '../../../packages/core/src/health/authorize-mutation'

const TRUSTED = ['github:markhayden/bakin-bits-official']
const base: MutationAuthorizationInput = {
  subject: { kind: 'plugin', id: 'terminal' },
  mutation: 'upgrade',
  source: 'github:markhayden/bakin-bits-official#plugins/terminal',
  trustedSources: TRUSTED,
  consentDelta: { permissions: [], bins: [], secrets: [], npm: [] },
  consentReviewed: true,
  actor: 'system',
}

describe('authorizeMutation — operator', () => {
  it('an operator click is allowed for every mutation, even delete/policy, even quarantined or declined subjects', () => {
    for (const mutation of ['upgrade', 'sync', 'reinstall', 'restart', 'rebuild', 'delete', 'policy'] as const) {
      expect(authorizeMutation({ ...base, actor: 'operator', mutation, quarantined: true, declined: true, consentReviewed: false }))
        .toEqual({ allowed: true })
    }
  })
})

describe('authorizeMutation — system and agent actors', () => {
  it.each(['system', 'agent'] as const)('%s: delete and policy are operator-only', (actor) => {
    expect(authorizeMutation({ ...base, actor, mutation: 'delete' })).toEqual({ allowed: false, reason: 'operator-only' })
    expect(authorizeMutation({ ...base, actor, mutation: 'policy' })).toEqual({ allowed: false, reason: 'operator-only' })
  })

  it.each(['system', 'agent'] as const)('%s: restart and rebuild need no consent at all', (actor) => {
    expect(authorizeMutation({ ...base, actor, mutation: 'restart', consentReviewed: false, source: undefined })).toEqual({ allowed: true })
    expect(authorizeMutation({ ...base, actor, mutation: 'rebuild', consentReviewed: false, source: 'local:/tmp/x' })).toEqual({ allowed: true })
  })

  it('a trusted source with a reviewed empty delta upgrades unattended', () => {
    expect(authorizeMutation(base)).toEqual({ allowed: true })
    expect(authorizeMutation({ ...base, mutation: 'sync' })).toEqual({ allowed: true })
    expect(authorizeMutation({ ...base, mutation: 'reinstall' })).toEqual({ allowed: true })
  })

  it('refusal precedence: hub-skill, quarantined, declined, disabled kind, untrusted source, consent delta, unreviewed', () => {
    expect(authorizeMutation({ ...base, subject: { kind: 'hub-skill', id: 'clawhub-foo' }, quarantined: true })).toEqual({ allowed: false, reason: 'hub-skill' })
    expect(authorizeMutation({ ...base, quarantined: true, declined: true })).toEqual({ allowed: false, reason: 'quarantined' })
    expect(authorizeMutation({ ...base, declined: true, kindEnabled: false })).toEqual({ allowed: false, reason: 'declined' })
    expect(authorizeMutation({ ...base, kindEnabled: false, source: 'github:someone/else#p' })).toEqual({ allowed: false, reason: 'disabled' })
    expect(authorizeMutation({ ...base, source: 'github:someone/else#plugins/x', consentDelta: { permissions: ['fs'], bins: [], secrets: [], npm: [] } }))
      .toEqual({ allowed: false, reason: 'untrusted-source' })
    expect(authorizeMutation({ ...base, consentDelta: { permissions: ['fs'], bins: [], secrets: [], npm: [] }, consentReviewed: false }))
      .toEqual({ allowed: false, reason: 'consent-delta' })
    expect(authorizeMutation({ ...base, consentReviewed: false })).toEqual({ allowed: false, reason: 'consent-unreviewed' })
  })

  it('A1 — a kind switched off blocks an unattended VERSION change but not a same-version repair', () => {
    expect(authorizeMutation({ ...base, kindEnabled: false, mutation: 'upgrade' })).toEqual({ allowed: false, reason: 'disabled' })
    expect(authorizeMutation({ ...base, kindEnabled: false, mutation: 'reinstall' })).toEqual({ allowed: true })
    expect(authorizeMutation({ ...base, kindEnabled: false, mutation: 'sync', sameVersion: true })).toEqual({ allowed: true })
    expect(authorizeMutation({ ...base, kindEnabled: false, mutation: 'sync', sameVersion: false })).toEqual({ allowed: false, reason: 'disabled' })
  })

  it('trust is by repository: the #path suffix and a trailing slash do not matter; a local path is untrusted unless listed', () => {
    expect(authorizeMutation({ ...base, source: 'github:markhayden/bakin-bits-official#packs/ocr' })).toEqual({ allowed: true })
    expect(authorizeMutation({ ...base, source: 'github:markhayden/bakin-bits-official' })).toEqual({ allowed: true })
    expect(authorizeMutation({ ...base, source: 'github:markhayden/bakin-bits-official-fork#plugins/x' })).toEqual({ allowed: false, reason: 'untrusted-source' })
    expect(authorizeMutation({ ...base, source: '/Users/me/dev/plugin' })).toEqual({ allowed: false, reason: 'untrusted-source' })
    expect(authorizeMutation({ ...base, source: '/Users/me/dev/plugin', trustedSources: [...TRUSTED, '/Users/me/dev/plugin'] })).toEqual({ allowed: true })
    expect(authorizeMutation({ ...base, source: undefined })).toEqual({ allowed: false, reason: 'untrusted-source' })
  })

  it('trusted-by-construction kinds (search-engine, search-models, bakin) need no record and no source, but still honour quarantine and the kind switch', () => {
    for (const kind of ['search-engine', 'search-models', 'bakin'] as const) {
      const subject = { kind, id: kind === 'bakin' ? 'bakin' : 'antfly' }
      expect(authorizeMutation({ ...base, subject, source: undefined, consentReviewed: false, consentDelta: undefined })).toEqual({ allowed: true })
      expect(authorizeMutation({ ...base, subject, source: undefined, consentReviewed: false, quarantined: true })).toEqual({ allowed: false, reason: 'quarantined' })
      expect(authorizeMutation({ ...base, subject, source: undefined, consentReviewed: false, kindEnabled: false })).toEqual({ allowed: false, reason: 'disabled' })
    }
  })

  it('an unreviewed record with a non-empty delta reports the delta (the operator sees what is asked, not "review first")', () => {
    expect(authorizeMutation({ ...base, consentReviewed: false, consentDelta: { permissions: [], bins: ['tmux'], secrets: [], npm: [] } }))
      .toEqual({ allowed: false, reason: 'consent-delta' })
  })
})

describe('SHARED_ENGINE_ACTIONS', () => {
  it('is exactly the engine-owned actions any owner may reference, not a prefix', () => {
    expect(SHARED_ENGINE_ACTIONS).toEqual(['core.diagnose'])
    expect(Object.isFrozen(SHARED_ENGINE_ACTIONS)).toBe(true)
  })
})
