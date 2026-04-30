import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('agent-rules managed-block module import', () => {
  let tempDir: string | null = null

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  })

  it('can be imported by CLI code without initializing user state', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-agent-rules-import-'))
    const bakinHome = join(tempDir, 'bakin-home')
    const openclawHome = join(tempDir, 'openclaw-home')
    const home = join(tempDir, 'home')

    const proc = Bun.spawn(
      [
        process.execPath,
        '-e',
        [
          "const mod = await import('./src/core/agent-rules/managed-blocks.ts')",
          "if (!mod.AGENT_RULES_BLOCK_START || !mod.AGENT_RULES_BLOCK_END) throw new Error('missing exports')",
        ].join('; '),
      ],
      {
        cwd: join(import.meta.dir, '../..'),
        env: {
          ...process.env,
          BAKIN_HOME: bakinHome,
          OPENCLAW_HOME: openclawHome,
          HOME: home,
          NODE_ENV: 'test',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    expect(stdout).toBe('')
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(existsSync(bakinHome)).toBe(false)
    expect(existsSync(openclawHome)).toBe(false)
    expect(existsSync(home)).toBe(false)
  })
})
