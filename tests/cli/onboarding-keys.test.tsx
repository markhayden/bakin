/**
 * Onboarding screens, driven by real key presses through Ink's own input
 * handling. Render-to-string tests show what a screen says; these show what
 * its keys DO — the runtime screen once rendered correctly while Enter on
 * the preselected entry did nothing at all.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { render } from 'ink'
import { useState, type ReactElement } from 'react'

import { OnboardingCredentialsPrompt, OnboardingRuntimePrompt, PromptFrame } from '../../src/core/cli/ui/onboarding'
import { createMultiSelectState, MultiSelect, type MultiSelectItem } from '../../src/core/cli/ui/multi-select'
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
  /**
   * A key pressed before the screen started listening is still waiting when
   * it does, as on a real terminal: Ink draws a frame before its input hook
   * attaches, and a press landing in between must not be lost.
   */
  override on(event: string, listener: (...args: unknown[]) => void): this {
    super.on(event, listener)
    if (event === 'readable' && this.queue.length > 0) queueMicrotask(() => this.emit('readable'))
    return this
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

describe('an answered screen collapses to its receipt', () => {
  /** What is on the terminal now: the last frame Ink wrote. */
  const lastFrame = (stdout: FakeStdout) => stdout.frames.at(-1) ?? ''

  it('the runtime screen becomes one row naming the choice, and keeps the brand', async () => {
    const settled: string[] = []
    const { stdin, stdout } = mount(
      <PromptFrame<string>
        showBrand
        screen={(answer) => <OnboardingRuntimePrompt options={RUNTIMES} preselected="pi" onSubmit={answer} />}
        receipt={(adapter) => ({ status: 'ok', label: 'Runtime', message: adapter === 'pi' ? 'Pi' : adapter })}
        onSettled={(adapter) => settled.push(adapter)}
      />,
    )
    await waitUntil(() => stdout.frames.join('').includes('Which runtime should this home use?'), { label: 'the runtime screen is drawn' })
    stdin.press(ENTER)
    await waitUntil(() => settled.length > 0, { label: 'the answer settles' })
    await waitUntil(() => !lastFrame(stdout).includes('Which runtime'), { label: 'the screen is replaced' })
    expect(settled).toEqual(['pi'])
    expect(lastFrame(stdout)).toContain('Runtime')
    expect(lastFrame(stdout)).toContain('Pi')
    expect(lastFrame(stdout)).toContain("Bakin'")
    expect(lastFrame(stdout)).not.toContain('Use up/down')
  })

  it('a screen with no receipt leaves nothing behind', async () => {
    const settled: string[] = []
    const { stdin, stdout } = mount(
      <PromptFrame<'recheck' | 'skip'>
        screen={(answer) => <OnboardingCredentialsPrompt runtimeLabel="Pi" steps={['Run pi']} docsUrl="https://example.invalid" showBrand={false} onSubmit={answer} />}
        receipt={() => null}
        onSettled={(value) => settled.push(value)}
      />,
    )
    await waitUntil(() => stdout.frames.join('').includes('Press Enter when you are logged in'), { label: 'the login screen is drawn' })
    stdin.press(ENTER)
    await waitUntil(() => settled.length > 0, { label: 'the answer settles' })
    await waitUntil(() => !lastFrame(stdout).includes('Press Enter'), { label: 'the screen is replaced' })
    expect(settled).toEqual(['recheck'])
    expect(lastFrame(stdout).trim()).toBe('')
  })
})

describe('checklist: keys', () => {
  const ITEMS: MultiSelectItem[] = [
    { id: 'messaging', label: 'Messaging', description: 'Planning', selected: true },
    { id: 'projects', label: 'Projects', description: 'Specs' },
    { id: 'terminal', label: 'Terminal', disabled: true, note: 'installed' },
  ]
  function Checklist({ onSubmit }: { onSubmit: (ids: string[]) => void }) {
    const [state, setState] = useState(() => createMultiSelectState(ITEMS))
    return <MultiSelect title="Plugins" items={ITEMS} state={state} onChange={setState} onSubmit={onSubmit} />
  }
  const lastFrame = (stdout: FakeStdout) => stdout.frames.at(-1) ?? ''

  it('every row leads with its box, and space checks and unchecks the pointed row', async () => {
    const { stdin, stdout } = mount(<Checklist onSubmit={() => {}} />)
    await waitUntil(() => lastFrame(stdout).includes('[\u2714] Messaging'), { label: 'the checklist is drawn' })
    expect(lastFrame(stdout)).toContain('[ ] Projects')
    expect(lastFrame(stdout)).toContain('[-] Terminal')
    stdin.press(' ')
    await waitUntil(() => lastFrame(stdout).includes('[ ] Messaging'), { label: 'space unchecks' })
    stdin.press(DOWN)
    stdin.press(' ')
    await waitUntil(() => lastFrame(stdout).includes('[\u2714] Projects'), { label: 'space checks the next row' })
  })

  it('Enter answers with the checked rows; an installed row is never one of them', async () => {
    const answers: string[][] = []
    const { stdin, stdout } = mount(<Checklist onSubmit={(ids) => answers.push(ids)} />)
    await waitUntil(() => lastFrame(stdout).includes('[\u2714] Messaging'), { label: 'the checklist is drawn' })
    stdin.press(DOWN)
    stdin.press(' ')
    await waitUntil(() => lastFrame(stdout).includes('[\u2714] Projects'), { label: 'the second row is checked' })
    stdin.press(DOWN) // wraps past the installed row, back to the first
    stdin.press(ENTER)
    await waitUntil(() => answers.length > 0, { label: 'Enter is answered' })
    expect(answers).toEqual([['messaging', 'projects']])
  })
})
