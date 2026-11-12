/**
 * Onboarding screens, driven by real key presses through Ink's own input
 * handling. Render-to-string tests show what a screen says; these show what
 * its keys DO — the runtime screen once rendered correctly while Enter on
 * the preselected entry did nothing at all.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { render } from 'ink'
import type { ReactElement } from 'react'

import { OnboardingCredentialsPrompt, OnboardingRuntimePrompt } from '../../src/core/cli/ui/onboarding'
import { waitUntil } from '../helpers/wait'

/** The slice of a TTY input stream Ink reads from. */
class FakeStdin extends EventEmitter {
  isTTY = true
  private queue: string[] = []
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null {
    return this.queue.shift() ?? null
  }
  press(keys: string): void {
    this.queue.push(keys)
    this.emit('readable')
  }
}

class FakeStdout extends EventEmitter {
  columns = 100
  rows = 40
  isTTY = true
  frames: string[] = []
  write(chunk: string): boolean {
    this.frames.push(String(chunk))
    return true
  }
}

const ENTER = '\r'
const DOWN = '\u001B[B'
const mounted: Array<{ unmount: () => void }> = []

function mount(element: ReactElement): { stdin: FakeStdin; stdout: FakeStdout } {
  const stdin = new FakeStdin()
  const stdout = new FakeStdout()
  const app = render(element, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
    debug: true,
  })
  mounted.push(app)
  return { stdin, stdout }
}

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
})

const RUNTIMES = [
  { adapter: 'openclaw', label: 'OpenClaw', summary: 'A separate gateway.', found: false },
  { adapter: 'pi', label: 'Pi', summary: 'Runs inside Bakin.', found: true },
]

describe('runtime selection screen: keys', () => {
  it('Enter picks the preselected runtime', async () => {
    const picked: string[] = []
    const { stdin, stdout } = mount(<OnboardingRuntimePrompt options={RUNTIMES} preselected="pi" onSubmit={(adapter) => picked.push(adapter)} />)
    await waitUntil(() => stdout.frames.join('').includes('Which runtime should this home use?'), { label: 'the runtime screen is drawn' })
    stdin.press(ENTER)
    await waitUntil(() => picked.length > 0, { label: 'Enter is answered' })
    expect(picked).toEqual(['pi'])
  })

  it('Down then Enter picks the other runtime', async () => {
    const picked: string[] = []
    const { stdin, stdout } = mount(<OnboardingRuntimePrompt options={RUNTIMES} preselected="pi" onSubmit={(adapter) => picked.push(adapter)} />)
    await waitUntil(() => stdout.frames.join('').includes('Which runtime should this home use?'), { label: 'the runtime screen is drawn' })
    stdin.press(DOWN)
    stdin.press(ENTER)
    await waitUntil(() => picked.length > 0, { label: 'Enter is answered' })
    expect(picked).toEqual(['openclaw'])
  })

  it('whichever runtime is preselected is the one Enter picks', async () => {
    const picked: string[] = []
    const both = RUNTIMES.map((runtime) => ({ ...runtime, found: true }))
    const { stdin, stdout } = mount(<OnboardingRuntimePrompt options={both} preselected="openclaw" onSubmit={(adapter) => picked.push(adapter)} />)
    await waitUntil(() => stdout.frames.join('').includes('Which runtime should this home use?'), { label: 'the runtime screen is drawn' })
    stdin.press(ENTER)
    await waitUntil(() => picked.length > 0, { label: 'Enter is answered' })
    expect(picked).toEqual(['openclaw'])
  })
})

describe('credentials screen: keys', () => {
  const props = { runtimeLabel: 'Pi', steps: ['Run `pi`.', 'Type `/login`.'], docsUrl: 'https://pi.dev/docs/latest' }

  it('Enter asks to check again', async () => {
    const answers: string[] = []
    const { stdin, stdout } = mount(<OnboardingCredentialsPrompt {...props} onSubmit={(answer) => answers.push(answer)} />)
    await waitUntil(() => stdout.frames.join('').includes('Press Enter when you are logged in'), { label: 'the credentials screen is drawn' })
    stdin.press(ENTER)
    await waitUntil(() => answers.length > 0, { label: 'Enter is answered' })
    expect(answers).toEqual(['recheck'])
  })

  it.each(['s', 'S'])('%s skips', async (key) => {
    const answers: string[] = []
    const { stdin, stdout } = mount(<OnboardingCredentialsPrompt {...props} onSubmit={(answer) => answers.push(answer)} />)
    await waitUntil(() => stdout.frames.join('').includes('Press Enter when you are logged in'), { label: 'the credentials screen is drawn' })
    stdin.press(key)
    await waitUntil(() => answers.length > 0, { label: 'the key is answered' })
    expect(answers).toEqual(['skip'])
  })

  it('other keys do nothing: a stray letter never skips the login', async () => {
    const answers: string[] = []
    const { stdin, stdout } = mount(<OnboardingCredentialsPrompt {...props} onSubmit={(answer) => answers.push(answer)} />)
    await waitUntil(() => stdout.frames.join('').includes('Press Enter when you are logged in'), { label: 'the credentials screen is drawn' })
    stdin.press('x')
    stdin.press('q')
    stdin.press(ENTER)
    await waitUntil(() => answers.length > 0, { label: 'Enter is answered' })
    // Only the Enter registered.
    expect(answers).toEqual(['recheck'])
  })
})
