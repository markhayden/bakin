import { describe, it, expect, beforeEach, mock, type Mock } from 'bun:test'

const { hoistedBakinHome } = (() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const bakinHome = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  process.env.BAKIN_HOME = bakinHome
  process.env.OPENCLAW_HOME = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
  return { hoistedBakinHome: bakinHome }
})()

import { execFile } from 'child_process'

mock.module('child_process', () => ({
  execFile: mock(),
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => hoistedBakinHome,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

import { cronAdd, cronEdit, cronRemove, cronRun, cronList } from '@bakin/schedule/lib/openclaw-cron'

const mockExecFile = vi.mocked(execFile)

function setupExecFile(stdout: string, stderr = '', err: Error | null = null) {
  mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
    ;(callback as Function)(err, stdout, stderr)
    return {} as any
  })
}

describe('schedule/openclaw-cron', () => {
  beforeEach(() => {
    mock.clearAllMocks()
  })

  describe('cronAdd', () => {
    it('calls execFile with correct args and returns job ID', async () => {
      setupExecFile(JSON.stringify({ id: 'new-job-123' }))

      const id = await cronAdd({ name: 'Test Job', cron: '0 9 * * *' })
      expect(id).toBe('new-job-123')

      expect(mockExecFile).toHaveBeenCalledTimes(1)
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args).toContain('add')
      expect(args).toContain('--name')
      expect(args).toContain('Test Job')
      expect(args).toContain('--cron')
      expect(args).toContain('0 9 * * *')
      expect(args).toContain('--json')
    })

    it('handles plain text output', async () => {
      setupExecFile('Created job: id: abc-def')
      const id = await cronAdd({ name: 'Test', cron: '* * * * *' })
      expect(id).toBe('abc-def')
    })

    it('rejects on execFile error', async () => {
      setupExecFile('', 'command failed', new Error('ENOENT'))
      await expect(cronAdd({ name: 'Test', cron: '* * * * *' })).rejects.toThrow('failed')
    })
  })

  describe('cronEdit', () => {
    it('calls execFile with job ID and options', async () => {
      setupExecFile('')
      await cronEdit('job-1', { name: 'Updated', cron: '0 10 * * *' })

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[0]).toBe('cron')
      expect(args[1]).toBe('edit')
      expect(args[2]).toBe('job-1')
      expect(args).toContain('--name')
      expect(args).toContain('Updated')
      expect(args).toContain('--cron')
    })

    it('passes --disable flag', async () => {
      setupExecFile('')
      await cronEdit('job-1', { enabled: false })
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args).toContain('--disable')
    })
  })

  describe('cronRemove', () => {
    it('calls execFile with rm command', async () => {
      setupExecFile('')
      await cronRemove('job-1')
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[0]).toBe('cron')
      expect(args[1]).toBe('rm')
      expect(args[2]).toBe('job-1')
    })
  })

  describe('cronRun', () => {
    it('calls execFile with run command', async () => {
      setupExecFile('')
      await cronRun('job-1')
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[0]).toBe('cron')
      expect(args[1]).toBe('run')
      expect(args[2]).toBe('job-1')
    })

    it('passes --force flag', async () => {
      setupExecFile('')
      await cronRun('job-1', true)
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args).toContain('--force')
    })
  })

  describe('cronList', () => {
    it('parses JSON array output', async () => {
      setupExecFile(JSON.stringify([{ id: 'j1' }, { id: 'j2' }]))
      const jobs = await cronList()
      expect(jobs).toHaveLength(2)
    })

    it('parses jobs field from object', async () => {
      setupExecFile(JSON.stringify({ jobs: [{ id: 'j1' }] }))
      const jobs = await cronList()
      expect(jobs).toHaveLength(1)
    })

    it('returns empty array on parse failure', async () => {
      setupExecFile('not json')
      const jobs = await cronList()
      expect(jobs).toEqual([])
    })
  })
})
