interface ExpectedFailureResult {
  label: string
  exitCode: number
  output: string
  expectedSignature: string
}

interface ExpectedFailureRun extends Omit<ExpectedFailureResult, 'exitCode' | 'output'> {
  command: string[]
  cwd: string
  env: Record<string, string | undefined>
}

export function assertExpectedFailure(result: ExpectedFailureResult): void {
  if (result.exitCode === 0) {
    throw new Error(`${result.label} teeth test unexpectedly passed`)
  }
  if (!result.output.includes(result.expectedSignature)) {
    throw new Error(
      `${result.label} teeth test failed, but did not report its expected ${result.expectedSignature} failure`,
    )
  }
}

export async function runExpectedFailure(run: ExpectedFailureRun): Promise<void> {
  const child = Bun.spawn(run.command, {
    cwd: run.cwd,
    env: run.env,
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  globalThis.process.stdout.write(stdout)
  globalThis.process.stderr.write(stderr)
  assertExpectedFailure({
    label: run.label,
    exitCode,
    output: `${stdout}\n${stderr}`,
    expectedSignature: run.expectedSignature,
  })
}
