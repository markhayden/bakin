import { describe, expect, it } from 'bun:test'
import {
  INTERACTION_SOURCE_META,
  interactionCategoryMeta,
} from '../../../plugins/health/components/interaction-source-meta'

describe('interaction source metadata', () => {
  it('uses one user-facing vocabulary for every interaction source', () => {
    expect(INTERACTION_SOURCE_META.mcp.label).toBe('Tools')
    expect(INTERACTION_SOURCE_META.rest.label).toBe('API')
    expect(INTERACTION_SOURCE_META.agent.label).toBe('Agents')

    expect(interactionCategoryMeta('tools')).toBe(INTERACTION_SOURCE_META.mcp)
    expect(interactionCategoryMeta('api')).toBe(INTERACTION_SOURCE_META.rest)
    expect(interactionCategoryMeta('agents')).toBe(INTERACTION_SOURCE_META.agent)
  })

  it('keeps source icon colors clear of the failure color', () => {
    for (const source of Object.values(INTERACTION_SOURCE_META)) {
      expect(source.iconColorClass).not.toContain('destructive')
      expect(source.iconColorClass).not.toContain('danger')
    }
  })
})
