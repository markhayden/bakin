import { describe, it, expect, vi } from 'vitest'

vi.mock('../../plugins/workflows/runtime', () => ({
  getCurrentStep: vi.fn(),
}))

vi.mock('../../scripts/lib/registry', () => ({
  addExecTool: vi.fn(),
}))

import { formatStepContext, getStepFormatted } from '../../scripts/lib/get-step'
import { getCurrentStep } from '../../plugins/workflows/runtime'

const mockGetCurrentStep = vi.mocked(getCurrentStep)

describe('formatStepContext', () => {
  it('includes step ID and status', () => {
    const result = formatStepContext({ stepId: 'write-copy', status: 'active' })
    expect(result).toContain('STEP: write-copy')
    expect(result).toContain('STATUS: active')
  })

  it('includes label and agent when provided', () => {
    const result = formatStepContext({
      stepId: 'write-copy',
      status: 'active',
      label: 'Write Copy & Brief',
      agent: 'basil',
    })
    expect(result).toContain('LABEL: Write Copy & Brief')
    expect(result).toContain('AGENT: basil')
  })

  it('includes instructions', () => {
    const result = formatStepContext({
      stepId: 'write-copy',
      status: 'active',
      instructions: 'Write a social media post for the brand.',
    })
    expect(result).toContain('INSTRUCTIONS:')
    expect(result).toContain('Write a social media post for the brand.')
  })

  it('shows first-step message when no prior output', () => {
    const result = formatStepContext({ stepId: 'step-1', status: 'active' })
    expect(result).toContain('(none — this is the first step)')
  })

  it('includes prior step output', () => {
    const result = formatStepContext({
      stepId: 'step-2',
      status: 'active',
      priorStepOutput: { caption: 'Golden hour smoothie' },
    })
    expect(result).toContain('PRIOR STEP OUTPUT:')
    expect(result).toContain('Golden hour smoothie')
  })

  it('includes prior step output as string', () => {
    const result = formatStepContext({
      stepId: 'step-2',
      status: 'active',
      priorStepOutput: 'raw text output',
    })
    expect(result).toContain('raw text output')
  })

  it('includes all prior step outputs when present', () => {
    const result = formatStepContext({
      stepId: 'step-3',
      status: 'active',
      stepOutputs: {
        'write-copy': { caption: 'hello' },
        'gen-image': { path: '/img.png' },
      },
    })
    expect(result).toContain('ALL PRIOR STEP OUTPUTS:')
    expect(result).toContain('[write-copy]')
    expect(result).toContain('[gen-image]')
  })

  it('formats output schema as readable fields', () => {
    const result = formatStepContext({
      stepId: 'write-copy',
      status: 'active',
      output_schema: {
        type: 'object',
        required: ['caption'],
        properties: {
          caption: { type: 'string', description: 'The post caption' },
          hashtags: { type: 'array' },
        },
      },
    })
    expect(result).toContain('REQUIRED OUTPUT SCHEMA:')
    expect(result).toContain('caption (string, required): The post caption')
    expect(result).toContain('hashtags (array)')
  })

  it('includes rejection context', () => {
    const result = formatStepContext({
      stepId: 'write-copy',
      status: 'revision_required',
      rejectionReason: 'Caption too long, needs to be under 280 chars',
      previousOutput: { caption: 'A very long caption...' },
    })
    expect(result).toContain('REJECTION CONTEXT:')
    expect(result).toContain('Caption too long')
    expect(result).toContain('YOUR PREVIOUS OUTPUT (needs revision):')
    expect(result).toContain('A very long caption...')
  })

  it('shows first attempt when no rejection', () => {
    const result = formatStepContext({ stepId: 'step-1', status: 'active' })
    expect(result).toContain('(none — first attempt)')
  })

  it('formats nested object schemas', () => {
    const result = formatStepContext({
      stepId: 'gen-image',
      status: 'active',
      output_schema: {
        type: 'object',
        required: ['imageBrief'],
        properties: {
          imageBrief: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'What the image shows' },
            },
          },
        },
      },
    })
    expect(result).toContain('imageBrief (object, required)')
    expect(result).toContain('subject (string): What the image shows')
  })
})

describe('getStepFormatted', () => {
  it('returns fail when no step found', async () => {
    mockGetCurrentStep.mockResolvedValue(null)
    const result = await getStepFormatted('task-missing', 'basil')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No active step')
  })

  it('returns formatted text on success', async () => {
    mockGetCurrentStep.mockResolvedValue({
      stepId: 'write-copy',
      status: 'active',
      label: 'Write Copy',
    } as never)
    const result = await getStepFormatted('task-123', 'basil')
    expect(result.ok).toBe(true)
    expect(result.formatted).toContain('STEP: write-copy')
    expect(result.raw).toBeDefined()
  })

  it('returns fail on error', async () => {
    mockGetCurrentStep.mockRejectedValue(new Error('network error'))
    const result = await getStepFormatted('task-err', 'basil')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('network error')
  })
})
