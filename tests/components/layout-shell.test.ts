import { describe, expect, it } from 'bun:test'
import {
  shouldAutoCollapseActivity,
  shouldAutoCollapseActivityForViewport,
} from '../../packages/host/src/components/layout/layout-shell'

describe('LayoutShell activity rail policy', () => {
  it('gives the Health Activity dashboard the monitoring canvas by default', () => {
    expect(shouldAutoCollapseActivity('/health', new URLSearchParams('tab=activity'))).toBe(true)
    expect(shouldAutoCollapseActivity('/health', new URLSearchParams('tab=overview'))).toBe(false)
    expect(shouldAutoCollapseActivity('/tasks', new URLSearchParams('tab=activity'))).toBe(false)
  })

  it('keeps the activity rail collapsed when it would consume a mobile canvas', () => {
    expect(shouldAutoCollapseActivityForViewport(320)).toBe(true)
    expect(shouldAutoCollapseActivityForViewport(767)).toBe(true)
    expect(shouldAutoCollapseActivityForViewport(768)).toBe(false)
    expect(shouldAutoCollapseActivityForViewport(1440)).toBe(false)
  })
})
