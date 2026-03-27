import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../plugins/workflows/runtime', () => ({
  getCurrentStep: vi.fn(),
  completeStep: vi.fn(),
}))

vi.mock('../../plugins/workflows/schema-validator', () => ({
  validateStepOutput: vi.fn(),
}))

vi.mock('../../scripts/lib/registry', () => ({
  addExecTool: vi.fn(),
}))

import { submitStepValidated } from '../../scripts/lib/submit-step'
import { getCurrentStep, completeStep } from '../../plugins/workflows/runtime'
import { validateStepOutput } from '../../plugins/workflows/schema-validator'

const mockGetCurrentStep = vi.mocked(getCurrentStep)
const mockCompleteStep = vi.mocked(completeStep)
const mockValidateStepOutput = vi.mocked(validateStepOutput)

describe('submitStepValidated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('returns fail when no active step found', async () => {
    mockGetCurrentStep.mockResolvedValue(null)
    const result = await submitStepValidated('task-123', 'step-1', { caption: 'test' }, 'chef')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No active step')
  })

  it('fails on schema validation error', async () => {
    mockGetCurrentStep.mockResolvedValue({
      stepId: 'write-copy',
      output_schema: { type: 'object', required: ['caption'] },
    } as never)
    mockValidateStepOutput.mockReturnValue({
      valid: false,
      errors: ['Missing required field: caption'],
    })

    const result = await submitStepValidated('task-123', 'write-copy', {}, 'chef')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Schema validation failed')
    expect(result.details).toContain('Missing required field: caption')
    // Should not have called completeStep
    expect(mockCompleteStep).not.toHaveBeenCalled()
  })

  it('submits successfully when validation passes', async () => {
    mockGetCurrentStep.mockResolvedValue({
      stepId: 'write-copy',
      output_schema: { type: 'object', required: ['caption'] },
    } as never)
    mockValidateStepOutput.mockReturnValue({ valid: true, errors: [] })
    mockCompleteStep.mockResolvedValue({ success: true, workflowComplete: false } as never)

    const result = await submitStepValidated(
      'task-123',
      'write-copy',
      { caption: 'Golden hour smoothie' },
      'chef',
    )
    expect(result.ok).toBe(true)
    expect(result.submitted).toBe(true)
    expect(result.success).toBe(true)
    expect(result.workflowComplete).toBe(false)
  })

  it('submits without validation when step has no schema', async () => {
    mockGetCurrentStep.mockResolvedValue({
      stepId: 'simple-step',
      // no output_schema
    } as never)
    mockCompleteStep.mockResolvedValue({ success: true, workflowComplete: true } as never)

    const result = await submitStepValidated(
      'task-456',
      'simple-step',
      { done: true },
      'chef',
    )
    expect(result.ok).toBe(true)
    expect(result.workflowComplete).toBe(true)
    expect(mockValidateStepOutput).not.toHaveBeenCalled()
  })

  it('catches near-duplicate rejection from server', async () => {
    mockGetCurrentStep.mockResolvedValue({ stepId: 'step-1' } as never)
    mockCompleteStep.mockRejectedValue(new Error('near-duplicate output detected'))

    const result = await submitStepValidated('task-789', 'step-1', { data: 'same' }, 'chef')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('too similar')
  })

  it('catches generic server errors', async () => {
    mockGetCurrentStep.mockResolvedValue({ stepId: 'step-1' } as never)
    mockCompleteStep.mockRejectedValue(new Error('connection timeout'))

    const result = await submitStepValidated('task-000', 'step-1', { data: 'x' }, 'chef')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('connection timeout')
  })
})
