import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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

  it('creates Bakin schedule cron jobs as OpenClaw main-session system events', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    await runtime.cron.create({
      id: 'schedule-1',
      name: 'Schedule One',
      schedule: '0 9 * * *',
      command: 'bakin:schedule:schedule-1',
      metadata: { bakinSchedule: true, tz: 'America/Denver' },
    })

    const store = JSON.parse(readFileSync(join(testDir, 'cron', 'jobs.json'), 'utf-8'))
    expect(store.jobs[0]).toEqual(expect.objectContaining({
      id: 'schedule-1',
      sessionTarget: 'main',
      wakeMode: 'now',
      delivery: { mode: 'none' },
      payload: { kind: 'systemEvent', text: 'bakin:schedule:schedule-1' },
      metadata: expect.objectContaining({ bakinSchedule: true }),
    }))
    expect(typeof store.jobs[0].createdAtMs).toBe('number')
  })

  it('persists toolsAllow on native isolated cron jobs and returns it from list/get', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    await runtime.cron.create({
      id: 'native-tools',
      name: 'Native Tools',
      schedule: '0 7 * * *',
      command: 'Post the daily recipe',
      toolsAllow: ['message', 'image_generate'],
    })

    const store = JSON.parse(readFileSync(join(testDir, 'cron', 'jobs.json'), 'utf-8'))
    expect(store.jobs[0].payload).toEqual(expect.objectContaining({
      kind: 'agentTurn',
      message: 'Post the daily recipe',
      toolsAllow: ['message', 'image_generate'],
    }))

    await expect(runtime.cron.get('native-tools')).resolves.toEqual(expect.objectContaining({
      id: 'native-tools',
      toolsAllow: ['message', 'image_generate'],
    }))
    await expect(runtime.cron.list()).resolves.toEqual([
      expect.objectContaining({ id: 'native-tools', toolsAllow: ['message', 'image_generate'] }),
    ])
  })

  it('updates and clears toolsAllow without dropping native cron payload fields', async () => {
    mkdirSync(join(testDir, 'cron'), { recursive: true })
    writeFileSync(join(testDir, 'cron', 'jobs.json'), JSON.stringify({
      version: 1,
      jobs: [{
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
      }],
    }), 'utf-8')

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    await runtime.cron.update('native-update-tools', { toolsAllow: ['message', 'exec'] })

    const updatedStore = JSON.parse(readFileSync(join(testDir, 'cron', 'jobs.json'), 'utf-8'))
    expect(updatedStore.jobs[0].payload).toEqual(expect.objectContaining({
      kind: 'agentTurn',
      message: 'Original native command',
      model: 'openai/gpt-5.4',
      toolsAllow: ['message', 'exec'],
    }))

    await expect(runtime.cron.get('native-update-tools')).resolves.toEqual(expect.objectContaining({
      toolsAllow: ['message', 'exec'],
    }))

    await runtime.cron.update('native-update-tools', { toolsAllow: null })

    const clearedStore = JSON.parse(readFileSync(join(testDir, 'cron', 'jobs.json'), 'utf-8'))
    expect(clearedStore.jobs[0].payload).toEqual(expect.objectContaining({
      kind: 'agentTurn',
      message: 'Original native command',
      model: 'openai/gpt-5.4',
    }))
    expect(clearedStore.jobs[0].payload.toolsAllow).toBeUndefined()
    await expect(runtime.cron.get('native-update-tools')).resolves.toEqual(expect.objectContaining({
      toolsAllow: undefined,
    }))
  })

  it('does not attach toolsAllow to Bakin schedule system-event cron jobs', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    await runtime.cron.create({
      id: 'schedule-tools',
      name: 'Schedule Tools',
      schedule: '0 9 * * *',
      command: 'bakin:schedule:schedule-tools',
      metadata: { bakinSchedule: true },
      toolsAllow: ['message'],
    })

    const store = JSON.parse(readFileSync(join(testDir, 'cron', 'jobs.json'), 'utf-8'))
    expect(store.jobs[0].payload).toEqual({ kind: 'systemEvent', text: 'bakin:schedule:schedule-tools' })
    await expect(runtime.cron.get('schedule-tools')).resolves.toEqual(expect.objectContaining({
      toolsAllow: undefined,
    }))
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

    await runtime.cron.update('native-1', {
      command: 'bakin:schedule:native-1',
      metadata: { bakinSchedule: true },
    })
    const adoptedStore = JSON.parse(readFileSync(join(testDir, 'cron', 'jobs.json'), 'utf-8'))
    expect(adoptedStore.jobs[0]).toEqual(expect.objectContaining({
      sessionTarget: 'main',
      wakeMode: 'now',
      delivery: { mode: 'none' },
      payload: { kind: 'systemEvent', text: 'bakin:schedule:native-1' },
    }))

    await runtime.cron.restoreRaw('native-1', raw, 'test restore')

    const store = JSON.parse(readFileSync(join(testDir, 'cron', 'jobs.json'), 'utf-8'))
    expect(store.jobs[0]).toEqual(raw)
  })

  it('converts metadata-only Bakin updates to system-event payloads', async () => {
    mkdirSync(join(testDir, 'cron'), { recursive: true })
    writeFileSync(join(testDir, 'cron', 'jobs.json'), JSON.stringify({
      version: 1,
      jobs: [{
        id: 'native-2',
        name: 'Native Two',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 8 * * *' },
        sessionTarget: 'isolated',
        payload: { kind: 'agentTurn', message: 'Original native command' },
        delivery: { mode: 'announce', channel: 'last' },
      }],
    }), 'utf-8')

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    await runtime.cron.update('native-2', {
      metadata: { bakinSchedule: true },
    })

    const store = JSON.parse(readFileSync(join(testDir, 'cron', 'jobs.json'), 'utf-8'))
    expect(store.jobs[0]).toEqual(expect.objectContaining({
      sessionTarget: 'main',
      wakeMode: 'now',
      delivery: { mode: 'none' },
      payload: { kind: 'systemEvent', text: 'Original native command' },
      metadata: { bakinSchedule: true },
    }))
  })
})
