/**
 * Command runner abstraction for the OpenClaw dev rig.
 *
 * All side-effecting shell-outs (docker, op, openclaw CLI) go through this
 * interface so the orchestration logic can be unit-tested against a fake runner
 * without spawning processes. The default implementation uses Bun.spawn, the
 * established shell-out path in scripts/ (see build-binary.ts, dev.ts).
 */

export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  /** Inherit stdio (interactive flows like the codex OAuth browser step). */
  interactive?: boolean
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface CommandRunner {
  run(argv: string[], opts?: RunOptions): Promise<RunResult>
}

export const bunRunner: CommandRunner = {
  async run(argv, opts = {}) {
    const proc = Bun.spawn(argv, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdin: opts.interactive ? 'inherit' : 'ignore',
      stdout: opts.interactive ? 'inherit' : 'pipe',
      stderr: opts.interactive ? 'inherit' : 'pipe',
    })
    const [stdout, stderr] = opts.interactive
      ? ['', '']
      : await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])
    const code = await proc.exited
    return { code, stdout, stderr }
  },
}
