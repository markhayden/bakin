import { describe, expect, it } from 'bun:test'
import { execSync } from 'node:child_process'

/**
 * The bakin spacing scale defines steps 0,1,2,3,4,6,8 only. A utility like
 * `gap-bakin-5` or `pl-bakin-7` references a step that does not exist, so
 * Tailwind emits NOTHING and the style silently disappears (the
 * inspector-panel gap and dropdown inset-indent shipped broken this way).
 * Off-scale measurements use the standard numeric scale instead (`gap-5`,
 * `pl-7`) — real utilities with the intended value.
 */
const ALLOWED_STEPS = new Set(['0', '1', '2', '3', '4', '6', '8'])

const ROOTS = [
  'packages/ui/src',
  'packages/sdk/src',
  'packages/host/src',
  'plugins',
  'storybook/public',
]

function findOffScale(): string[] {
  const out: string[] = []
  const cmd = `grep -rEon '[a-z][a-z-]*-bakin-[0-9]+' ${ROOTS.join(' ')} --include='*.tsx' --include='*.ts' || true`
  const hits = execSync(cmd, { encoding: 'utf8' }).trim()
  if (!hits) return out
  for (const line of hits.split('\n')) {
    const match = line.match(/-bakin-(\d+)$/)
    if (match && !ALLOWED_STEPS.has(match[1]!)) out.push(line)
  }
  return out
}

describe('off-scale bakin utilities', () => {
  it('every numeric bakin utility references a real scale step', () => {
    const offenders = findOffScale()
    expect(offenders).toEqual([])
  })

  it('the detector itself catches an off-scale utility (teeth)', () => {
    const sample = 'className="gap-bakin-5 pl-bakin-7 px-bakin-4"'
    const found = [...sample.matchAll(/[a-z][a-z-]*-bakin-(\d+)/g)]
      .filter((m) => !ALLOWED_STEPS.has(m[1]!))
    expect(found.length).toBe(2)
  })
})
