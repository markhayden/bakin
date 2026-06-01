import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const cronExecOpts = { timeout: 35000 }

describe('OpenClaw runtime cron adapter', () => {
  let testDir: string
  let originalOpenClawHome: string | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-cron-test-'))
    originalOpenClawHome = process.env.OPENCLAW_HOME
    process.env.OPENCLAW_HOME = testDir
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates Bakin schedule cron jobs as isolated no-delivery timer messages through the CLI', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const exec = mock(async (_args: string[]) => JSON.stringify({
      id: 'openclaw-schedule-1',
      name: 'Schedule One',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'America/Denver' },
      sessionTarget: 'isolated',
      wakeMode: 'now',
      delivery: { mode: 'none' },
      payload: {
        kind: 'agentTurn',
        message: 'bakin:schedule:schedule-1',
      },
    }))
    ;(runtime as unknown as { exec: typeof exec }).exec = exec

    const created = await runtime.cron.create({
      id: 'schedule-1',
      name: 'Schedule One',
      schedule: '0 9 * * *',
      command: 'bakin:schedule:schedule-1',
      metadata: { bakinSchedule: true, tz: 'America/Denver' },
    })

    expect(created).toEqual(expect.objectContaining({
      id: 'openclaw-schedule-1',
      command: 'bakin:schedule:schedule-1',
      toolsAllow: undefined,
    }))
    expect(exec).toHaveBeenCalledWith([
      'cron',
      'add',
      '--name',
      'Schedule One',
      '--cron',
      '0 9 * * *',
      '--wake',
      'now',
      '--json',
      '--timeout',
      '30000',
      '--tz',
      'America/Denver',
      '--session',
      'isolated',
      '--message',
      'bakin:schedule:schedule-1',
      '--no-deliver',
      '--light-context',
    ], cronExecOpts)
  })

  it('persists toolsAllow on native isolated cron jobs and returns it from list/get', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const rawJob = {
      id: 'openclaw-native-tools',
      name: 'Native Tools',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 7 * * *' },
      sessionTarget: 'isolated',
      payload: {
        kind: 'agentTurn',
        message: 'Post the daily recipe',
        toolsAllow: ['message', 'image_generate'],
      },
    }
    const exec = mock(async (args: string[]) => {
      if (args[1] === 'list') return JSON.stringify([rawJob])
      return JSON.stringify(rawJob)
    })
    ;(runtime as unknown as { exec: typeof exec }).exec = exec

    const created = await runtime.cron.create({
      id: 'native-tools',
      name: 'Native Tools',
      schedule: '0 7 * * *',
      command: 'Post the daily recipe',
      toolsAllow: ['message', 'image_generate'],
    })

    expect(created).toEqual(expect.objectContaining({
      id: 'openclaw-native-tools',
      toolsAllow: ['message', 'image_generate'],
    }))
    expect(exec).toHaveBeenCalledWith([
      'cron',
      'add',
      '--name',
      'Native Tools',
      '--cron',
      '0 7 * * *',
      '--wake',
      'now',
      '--json',
      '--timeout',
      '30000',
      '--session',
      'isolated',
      '--message',
      'Post the daily recipe',
      '--tools',
      'message,image_generate',
    ], cronExecOpts)

    await expect(runtime.cron.get('openclaw-native-tools')).resolves.toEqual(expect.objectContaining({
      id: 'openclaw-native-tools',
      toolsAllow: ['message', 'image_generate'],
    }))
    await expect(runtime.cron.list()).resolves.toEqual([
      expect.objectContaining({ id: 'openclaw-native-tools', toolsAllow: ['message', 'image_generate'] }),
    ])
  })

  it('updates and clears toolsAllow with OpenClaw cron edit', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const rawJob: {
      id: string
      name: string
      enabled: boolean
      schedule: { kind: string; expr: string }
      sessionTarget: string
      payload: Record<string, unknown>
      delivery: { mode: string }
    } = {
      id: 'native-update-tools',
      name: 'Native Update Tools',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 8 * * *' },
      sessionTarget: 'isolated',
      payload: {
        kind: 'agentTurn',
        message: 'Original native command',
        model: 'openai/gpt-5.4',
        toolsAllow: ['message'],
      },
      delivery: { mode: 'none' },
    }
    const exec = mock(async (args: string[]) => {
      if (args[1] === 'list') return JSON.stringify([rawJob])
      if (args[1] === 'edit') {
        const toolsIndex = args.indexOf('--tools')
        if (toolsIndex !== -1) rawJob.payload.toolsAllow = args[toolsIndex + 1].split(',')
        if (args.includes('--clear-tools')) delete rawJob.payload.toolsAllow
      }
      return ''
    })
    ;(runtime as unknown as { exec: typeof exec }).exec = exec

    await expect(runtime.cron.update('native-update-tools', { toolsAllow: ['message', 'exec'] })).resolves.toEqual(expect.objectContaining({
      toolsAllow: ['message', 'exec'],
    }))
    expect(exec).toHaveBeenCalledWith([
      'cron',
      'edit',
      'native-update-tools',
      '--timeout',
      '30000',
      '--session',
      'isolated',
      '--message',
      'Original native command',
      '--tools',
      'message,exec',
    ], cronExecOpts)

    await expect(runtime.cron.update('native-update-tools', { toolsAllow: null })).resolves.toEqual(expect.objectContaining({
      toolsAllow: undefined,
    }))
    expect(exec).toHaveBeenCalledWith([
      'cron',
      'edit',
      'native-update-tools',
      '--timeout',
      '30000',
      '--session',
      'isolated',
      '--message',
      'Original native command',
      '--clear-tools',
    ], cronExecOpts)
  })

  it('does not attach toolsAllow to Bakin schedule timer cron jobs', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const exec = mock(async (_args: string[]) => JSON.stringify({
      id: 'openclaw-schedule-tools',
      name: 'Schedule Tools',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      sessionTarget: 'isolated',
      payload: {
        kind: 'agentTurn',
        message: 'bakin:schedule:schedule-tools',
      },
    }))
    ;(runtime as unknown as { exec: typeof exec }).exec = exec

    const created = await runtime.cron.create({
      id: 'schedule-tools',
      name: 'Schedule Tools',
      schedule: '0 9 * * *',
      command: 'bakin:schedule:schedule-tools',
      metadata: { bakinSchedule: true },
      toolsAllow: ['message'],
    })

    expect(created.toolsAllow).toBeUndefined()
    expect(exec.mock.calls[0][0]).not.toContain('--tools')
  })

  it('preserves provider tool allowlists when listing runtime cron jobs with bakin commands', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const exec = mock(async () => JSON.stringify([{
      id: 'openclaw-schedule-listed',
      name: 'Schedule Listed',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      sessionTarget: 'isolated',
      payload: {
        kind: 'agentTurn',
        message: 'bakin:schedule:schedule-listed',
        toolsAllow: ['message'],
      },
    }]))
    ;(runtime as unknown as { exec: typeof exec }).exec = exec

    await expect(runtime.cron.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'openclaw-schedule-listed',
        command: 'bakin:schedule:schedule-listed',
        toolsAllow: ['message'],
      }),
    ])
  })

  it('preserves the timezone from OpenClaw cron schedule objects when listing jobs', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const exec = mock(async () => JSON.stringify([{
      id: 'openclaw-tz',
      name: 'Timezone job',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'America/Denver' },
      payload: { kind: 'systemEvent', text: 'bakin:schedule:timezone-job' },
    }]))
    ;(runtime as unknown as { exec: typeof exec }).exec = exec

    await expect(runtime.cron.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'openclaw-tz',
        schedule: '0 9 * * *',
        metadata: expect.objectContaining({ tz: 'America/Denver' }),
      }),
    ])
  })

  it('captures and restores raw cron snapshots without dropping provider-specific fields', async () => {
    mkdirSync(join(testDir, 'cron'), { recursive: true })
    writeFileSync(join(testDir, 'cron', 'jobs.json'), JSON.stringify({
      version: 1,
      jobs: [{
        id: 'native-1',
        name: 'Native',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'America/Denver', staggerMs: 30000 },
        sessionTarget: 'isolated',
        wakeMode: 'now',
        payload: { kind: 'agentTurn', message: 'Do native work', model: 'openai/gpt-5.4' },
        delivery: { mode: 'announce', channel: 'last' },
        failureAlert: { enabled: true, after: 2 },
        state: { nextRunAtMs: 123 },
        createdAtMs: 100,
        updatedAtMs: 100,
      }],
    }), 'utf-8')

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const raw = await runtime.cron.getRaw('native-1', 'test capture')

    writeFileSync(join(testDir, 'cron', 'jobs.json'), JSON.stringify({ version: 1, jobs: [] }), 'utf-8')
    await runtime.cron.restoreRaw('native-1', raw, 'test restore')

    const store = JSON.parse(readFileSync(join(testDir, 'cron', 'jobs.json'), 'utf-8'))
    expect(store.jobs[0]).toEqual(raw)
  })

  it('converts metadata-only Bakin updates to isolated timer payloads through the CLI', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const rawJob: {
      id: string
      name: string
      enabled: boolean
      schedule: { kind: string; expr: string }
      sessionTarget: string
      payload: Record<string, unknown>
      delivery: { mode: string; channel: string }
    } = {
      id: 'native-2',
      name: 'Native Two',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 8 * * *' },
      sessionTarget: 'isolated',
      payload: { kind: 'agentTurn', message: 'Original native command' },
      delivery: { mode: 'announce', channel: 'last' },
    }
    const exec = mock(async (args: string[]) => {
      if (args[1] === 'edit') {
        rawJob.sessionTarget = 'isolated'
        rawJob.payload = {
          kind: 'agentTurn',
          message: 'Original native command',
        }
        rawJob.delivery = { mode: 'none', channel: 'last' }
      }
      return JSON.stringify([rawJob])
    })
    ;(runtime as unknown as { exec: typeof exec }).exec = exec

    await expect(runtime.cron.update('native-2', {
      metadata: { bakinSchedule: true },
    })).resolves.toEqual(expect.objectContaining({
      command: 'Original native command',
      toolsAllow: undefined,
    }))
    expect(exec).toHaveBeenCalledWith([
      'cron',
      'edit',
      'native-2',
      '--timeout',
      '30000',
      '--session',
      'isolated',
      '--message',
      'Original native command',
      '--no-deliver',
      '--light-context',
      '--clear-tools',
    ], cronExecOpts)
  })

  it('reads cron run history through the OpenClaw cron CLI', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const exec = mock(async () => JSON.stringify([
      { runId: 'run-1', jobId: 'cron-history', status: 'success', timestamp: '2026-03-31T09:00:00Z' },
    ]))
    ;(runtime as unknown as { exec: typeof exec }).exec = exec

    await expect(runtime.cron.listRuns('cron-history')).resolves.toEqual([
      expect.objectContaining({ id: 'run-1', jobId: 'cron-history', status: 'succeeded' }),
    ])
    expect(exec).toHaveBeenCalledWith([
      'cron',
      'runs',
      '--id',
      'cron-history',
      '--limit',
      '50',
      '--timeout',
      '30000',
    ], cronExecOpts)
  })

  it('runs cron jobs without passing unsupported force flags', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const exec = mock(async () => '')
    ;(runtime as unknown as { exec: typeof exec }).exec = exec

    await runtime.cron.runNow('cron-tui-smoke-test')

    expect(exec).toHaveBeenCalledWith(['cron', 'run', 'cron-tui-smoke-test'])
  })
})
