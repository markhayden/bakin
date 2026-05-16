import { describe, expect, it } from 'bun:test'
import { workflowDefinitionNameFromHookInput } from '../../../plugins/workflows/lib/hook-input'

describe('workflow hook input helpers', () => {
  it('accepts workflowId as an alias for definition name', () => {
    expect(workflowDefinitionNameFromHookInput({ workflowId: 'messaging-image-post-prep' }))
      .toBe('messaging-image-post-prep')
  })

  it('prefers explicit name over workflowId', () => {
    expect(workflowDefinitionNameFromHookInput({ name: 'canonical', workflowId: 'legacy' }))
      .toBe('canonical')
  })
})
