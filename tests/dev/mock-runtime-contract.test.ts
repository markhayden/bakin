import { afterEach, describe, expect, it } from 'bun:test'
import { createImitationCrabHarness, type ImitationCrabHarness } from '../../dev/imitation-crab/harness'

async function collectText(stream: AsyncIterable<{ type: string; content?: string }>): Promise<string> {
  let text = ''
  let sawDone = false
  for await (const chunk of stream) {
    if (chunk.type === 'text') text += chunk.content ?? ''
    if (chunk.type === 'done') sawDone = true
  }
  expect(sawDone).toBe(true)
  return text
}

describe('imitation-crab runtime contract', () => {
  let harness: ImitationCrabHarness | null = null

  afterEach(async () => {
    await harness?.close()
    harness = null
  })

  async function openHarness(): Promise<ImitationCrabHarness> {
    harness = await createImitationCrabHarness({ chatMode: 'echo' })
    return harness
  }

  it('supports roster, workspace, and skill operations through the runtime adapter', async () => {
    const { services } = await openHarness()
    const { runtime } = services

    const agents = await runtime.agents.list()
    expect(agents.map((agent) => agent.id)).toEqual(expect.arrayContaining(['main', 'pixel', 'patch']))
    await expect(runtime.agents.get('pixel')).resolves.toEqual(expect.objectContaining({
      id: 'pixel',
      name: 'Pixel',
      metadata: expect.objectContaining({ subagentAllowAgents: null }),
    }))
    await expect(runtime.agents.heartbeat('patch')).resolves.toBe(false)

    await runtime.agents.writeWorkspaceFile('patch', {
      path: 'CONTRACT.md',
      content: 'runtime contract note',
      metadata: { installedBy: { package: 'contract-test', sha256: 'abc123' } },
    })
    await expect(runtime.agents.listWorkspaceFiles('patch')).resolves.toContain('CONTRACT.md')
    await expect(runtime.agents.readWorkspaceFile('patch', 'CONTRACT.md')).resolves.toEqual(expect.objectContaining({
      path: 'CONTRACT.md',
      content: 'runtime contract note',
      metadata: expect.objectContaining({
        installedBy: expect.objectContaining({ package: 'contract-test' }),
        userEdited: false,
      }),
    }))
    await runtime.agents.removeWorkspaceFile('patch', 'CONTRACT.md')
    await expect(runtime.agents.readWorkspaceFile('patch', 'CONTRACT.md')).resolves.toBeNull()

    await runtime.skills.write({
      name: 'contract-skill',
      files: {
        'SKILL.md': '# Contract Skill\n\nUse the runtime contract.',
        'scripts/helper.sh': 'echo contract',
      },
      metadata: { installedBy: { package: 'contract-test', sha256: 'def456' } },
    }, 'patch')
    await expect(runtime.skills.list('patch')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'contract-skill' }),
    ]))
    await expect(runtime.skills.get('contract-skill', 'patch')).resolves.toEqual(expect.objectContaining({
      name: 'contract-skill',
      instructions: expect.stringContaining('Contract Skill'),
      files: expect.objectContaining({ 'scripts/helper.sh': 'echo contract' }),
      metadata: expect.objectContaining({
        installedBy: expect.objectContaining({ package: 'contract-test' }),
        userEdited: false,
      }),
    }))
    await runtime.skills.remove('contract-skill', 'patch')
    await expect(runtime.skills.get('contract-skill', 'patch')).resolves.toBeNull()
  })

  it('supports messaging, tool, channel, cron, and execution operations through the runtime adapter', async () => {
    const { services } = await openHarness()
    const { runtime } = services

    await expect(runtime.ping()).resolves.toBe(true)
    await expect(runtime.messaging.send({
      agentId: 'pixel',
      content: 'Send a contract message',
    })).resolves.toEqual(expect.objectContaining({
      content: '[mock:Pixel] Send a contract message',
    }))
    await expect(collectText(runtime.messaging.stream({
      agentId: 'jessica',
      content: 'Stream a contract message',
    }))).resolves.toBe('[mock:Jessica] Stream a contract message')

    await expect(runtime.tools.invoke('pixel', 'message_send', { message: 'hello' })).resolves.toEqual({
      ok: true,
      output: { ok: true, mock: true },
    })

    await expect(runtime.channels.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'discord',
        capabilities: expect.arrayContaining(['message', 'rich-content']),
      }),
    ]))
    await expect(runtime.channels.sendMessage({
      channels: ['discord:contract-channel'],
      message: { body: 'contract channel message' },
    })).resolves.toEqual(expect.objectContaining({
      deliveries: [expect.objectContaining({ channelId: 'discord:contract-channel' })],
    }))

    const createdCron = await runtime.cron.create({
      name: 'Contract Cron',
      schedule: '*/10 * * * *',
      command: 'Run contract cron',
      toolsAllow: ['message'],
    })
    expect(createdCron).toEqual(expect.objectContaining({
      command: 'Run contract cron',
      toolsAllow: ['message'],
    }))
    await expect(runtime.cron.update(createdCron.id, {
      schedule: '0 * * * *',
      toolsAllow: ['message', 'exec'],
    })).resolves.toEqual(expect.objectContaining({
      id: createdCron.id,
      schedule: '0 * * * *',
      toolsAllow: ['message', 'exec'],
    }))
    await expect(runtime.cron.runNow(createdCron.id)).resolves.toEqual(expect.objectContaining({
      jobId: createdCron.id,
      status: 'succeeded',
    }))
    await expect(runtime.cron.listRuns(createdCron.id)).resolves.toEqual([
      expect.objectContaining({ jobId: createdCron.id, status: 'succeeded' }),
    ])
    await runtime.cron.remove(createdCron.id)
    await expect(runtime.cron.get(createdCron.id)).resolves.toBeNull()

    await expect(runtime.tasks.dispatch({
      bakinTaskId: 'task-contract',
      agentId: 'patch',
      title: 'Run contract task',
    })).resolves.toEqual({ flowId: 'flow-task-contract' })
    await expect(runtime.tasks.getExecutionStatus('flow-task-contract')).resolves.toEqual({
      flowId: 'flow-task-contract',
      state: 'unknown',
    })
  })
})
