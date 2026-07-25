/**
 * IncidentRow (#690): cards render EFFECTIVE urgency with a plain-language
 * category chip, and a demoted incident says so instead of hiding it.
 */
// @vitest-environment jsdom
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-incident-row-${Date.now()}`)

// Defensive content-dir mocks per CLAUDE.md.
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { render, screen } from '@testing-library/react'
import '../../rtl-settle'
import type { HealthIncident } from '@makinbakin/sdk/types'
import { IncidentRow } from '@bakin/health/components/incident-row'
import type { OverviewIncident } from '@bakin/health/lib/health-view-model'

function item(overrides: Partial<HealthIncident> = {}): OverviewIncident {
  return {
    incident: {
      id: 'health:test:incident',
      status: 'warning',
      disposition: 'watch',
      effectiveDisposition: 'watch',
      title: 'Something needs review',
      impact: 'Operator impact statement.',
      resources: [],
      resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
      observationIds: ['obs-1'],
      observedAt: '2026-07-13T12:00:00.000Z',
      staleAt: '2026-07-13T12:30:00.000Z',
      stale: false,
      ...overrides,
    },
    observations: [],
    oldestEvidenceAt: '2026-07-13T12:00:00.000Z',
    freshness: 'fresh',
    verificationFailure: false,
  }
}

describe('IncidentRow (#690)', () => {
  it('renders the plain-language category chip for a classified incident', () => {
    render(<IncidentRow item={item({ class: 'policy_denial' })} />)
    expect(screen.getByText('Guardrail worked')).toBeTruthy()
  })

  it('a demoted incident renders calm with an honest provenance badge', () => {
    render(<IncidentRow item={item({
      class: 'cleanup_backlog',
      disposition: 'watch',
      effectiveDisposition: 'advisory',
    })} />)
    expect(screen.getByText('Advisory')).toBeTruthy()
    expect(screen.getByText('Housekeeping')).toBeTruthy()
    expect(screen.getByText('Calmed from watch')).toBeTruthy()
    expect(screen.queryByText('Watch')).toBeNull()
  })

  it('an undemoted watch incident renders as Watch with no provenance badge', () => {
    render(<IncidentRow item={item({ class: 'unattributed_usage' })} />)
    expect(screen.getByText('Watch')).toBeTruthy()
    expect(screen.getByText('Unattributed usage')).toBeTruthy()
    expect(screen.queryByText(/Calmed from/)).toBeNull()
  })

  it('error incidents stay Critical — never demoted, never calmed', () => {
    render(<IncidentRow item={item({
      class: 'runaway_usage',
      status: 'error',
      disposition: 'action_required',
      effectiveDisposition: 'action_required',
    })} />)
    expect(screen.getByText('Critical')).toBeTruthy()
    expect(screen.getByText('Runaway usage')).toBeTruthy()
  })
})
