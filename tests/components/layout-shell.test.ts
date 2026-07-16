import { describe, expect, it } from 'bun:test'
import { shouldAutoCollapseActivity } from '../../packages/host/src/components/layout/layout-shell'

describe('LayoutShell activity rail policy', () => {
  it('gives the Health Activity dashboard the monitoring canvas by default', () => {
    expect(shouldAutoCollapseActivity('/health', new URLSearchParams('tab=activity'))).toBe(true)
    expect(shouldAutoCollapseActivity('/health', new URLSearchParams('tab=overview'))).toBe(false)
    expect(shouldAutoCollapseActivity('/tasks', new URLSearchParams('tab=activity'))).toBe(false)
  })
})
