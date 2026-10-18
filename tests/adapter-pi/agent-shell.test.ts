/**
 * Pi agent shells name their agent on every command (#898 D-H5): the
 * replacement bash tool sets BAKIN_AGENT_CONTEXT in the command's own
 * environment — never the shared process.env — and survives `cd`.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { agentBashTool } from '../../packages/adapter-pi/src/agent-shell'

const cwd = mkdtempSync(join(tmpdir(), 'bakin-agent-shell-'))
afterAll(() => rmSync(cwd, { recursive: true, force: true }))

const settings = { getShellCommandPrefix: () => undefined, getShellPath: () => undefined }

async function run(command: string): Promise<string> {
  const tool = agentBashTool(cwd, settings, 'researcher')
  const result = await tool.execute('call-1', { command }, new AbortController().signal, undefined, undefined as never)
  return result.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
}

describe('agentBashTool', () => {
  it('replaces the built-in bash by name', () => {
    expect(agentBashTool(cwd, settings, 'researcher').name).toBe('bash')
  })

  it('every command carries the agent, including after cd', async () => {
    expect((await run('echo "ctx=$BAKIN_AGENT_CONTEXT"')).trim()).toContain('ctx=researcher')
    expect((await run('cd / && echo "ctx=$BAKIN_AGENT_CONTEXT"')).trim()).toContain('ctx=researcher')
  })

  it('never touches the shared process environment', async () => {
    await run('true')
    expect(process.env.BAKIN_AGENT_CONTEXT).toBeUndefined()
  })
})
