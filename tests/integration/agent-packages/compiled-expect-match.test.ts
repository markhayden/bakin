/**
 * Compile-and-run regression for the login `expect` matcher inside a
 * `bun build --compile` binary. On a checkout the server runs the matcher
 * as a script; inside the binary there is no script, so the server re-enters
 * ITSELF on the hidden `__bakin-expect-match` command. Both the argv the
 * binary chooses for itself and the round trip through that command are
 * asserted here — and the deadline still kills a catastrophic pattern.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const testDir = join(tmpdir(), `bakin-test-compiled-expect-${Date.now()}-${Math.random().toString(16).slice(2)}`)
mkdirSync(testDir, { recursive: true })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { EXPECT_MATCH_COMMAND, EXPECT_MATCH_DEADLINE_EXIT, matchExpect } from '../../../src/core/agent-packages/expect-match'

const GOG = '"email":\\s*"([^"]+)"[^}]*"valid":\\s*true'

async function compileEntry(): Promise<string> {
  const entry = join(testDir, 'entry.ts')
  writeFileSync(entry, `
import { dispatchExpectMatch, expectMatchArgv } from ${JSON.stringify(join(REPO_ROOT, 'src/core/agent-packages/expect-match.ts'))}
if (process.argv.includes('--print-argv')) { console.log(JSON.stringify(expectMatchArgv())); process.exit(0) }
// EXACTLY what src/core/cli.ts does first thing in dispatchCli.
const code = await dispatchExpectMatch(process.argv)
process.exit(code ?? 3)
`)
  const outfile = join(testDir, 'expect-bin')
  const proc = Bun.spawn(['bun', 'build', '--compile', `--outfile=${outfile}`, entry], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' })
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(`compile failed (exit ${code}): ${err.slice(-1200)}`)
  return outfile
}

describe('compiled expect matcher', () => {
  it('a binary re-enters itself on the hidden command, answers matches, and still dies at the deadline', async () => {
    const binary = await compileEntry()

    const printed = spawnSync(binary, ['--print-argv'], { cwd: testDir })
    const argv = JSON.parse(printed.stdout.toString().trim()) as string[]
    expect(argv).toHaveLength(2)
    expect(argv[0]).toMatch(/expect-bin$/)
    expect(argv[1]).toBe(EXPECT_MATCH_COMMAND)

    const viaCommand = [binary, EXPECT_MATCH_COMMAND]
    const matched = await matchExpect(GOG, '{"accounts":[{"email":"old@x","valid":false},{"email":"new@x","valid":true}]}', { timeoutMs: 20_000, argv: viaCommand })
    expect(matched).toEqual({ ok: true, matches: [['"email":"new@x","valid":true', 'new@x']] })

    const killed = await matchExpect('a*a*a*a*a*a*a*a*b', 'a'.repeat(10_000), { timeoutMs: 1_500, argv: viaCommand })
    expect(killed).toEqual({ ok: false, reason: 'expect-timeout', detail: 'the pattern did not finish within 1500 ms' })

    // Orphaned (nobody kills it): the binary's worker-backed deadline ends the process itself.
    const orphan = spawnSync(binary, [EXPECT_MATCH_COMMAND], {
      cwd: testDir, timeout: 20_000,
      input: JSON.stringify({ pattern: 'a*a*a*a*a*a*a*a*b', input: 'a'.repeat(10_000), deadlineMs: 500 }),
    })
    expect(orphan.status).toBe(EXPECT_MATCH_DEADLINE_EXIT)

    // Anything else is not the command: exit 3 from the fixture, no stdin read.
    const other = spawnSync(binary, ['serve'], { cwd: testDir, stdio: 'ignore' })
    expect(other.status).toBe(3)
  }, 120_000)
})
