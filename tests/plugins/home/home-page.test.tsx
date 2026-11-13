// @vitest-environment jsdom
/**
 * The Home page (home-first-run plan, task 1.8): each state shows what is
 * true, the prompt and starters start a conversation, and a double submit
 * makes one chat. The kit's page, list and state patterns are real; the
 * composer is a stand-in that exposes exactly its `onSend` contract.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { actRender } from '../../rtl-settle'
import type { ReactNode } from 'react'

const contentDirMock = () => ({ getContentDir: () => '/tmp/bakin-test-home-page-unused', getBakinPaths: () => ({}) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import type { HomeStateResponse } from '../../../plugins/home/types'

let response: { data: HomeStateResponse | null; loading: boolean; error: string | null } = { data: null, loading: false, error: null }
const refresh = mock()
const TOUR = [
  { id: 'chat', title: 'Chat', icon: 'MessageSquare', body: 'Talk to any agent. Everything is kept.', first: 'Ask your main agent something.', href: '/chat' },
  { id: 'tasks', title: 'Tasks', icon: 'CheckSquare', body: 'The board is where work lives. Agents pick tasks up.', first: 'Break a goal into tasks.', href: '/tasks' },
  { id: 'health', title: 'Health', icon: 'HeartPulse', body: 'Bakin watches itself. Health says what is wrong.', first: 'Look here first.', href: '/health' },
]
let tourResponse: { data: { ok: true; slides: typeof TOUR } | null; loading: boolean; error: string | null } = { data: { ok: true, slides: TOUR }, loading: false, error: null }
const toast = mock()
import * as realSdkHooks from '@makinbakin/sdk/hooks'
/** Whether a browser terminal is installed, and what opening one answers. */
let terminal: { available: boolean | null; error: string | null; opens: string | null } = { available: false, error: null, opens: 's1' }
const terminalOpens: Array<[string, string]> = []
mock.module('@makinbakin/sdk/hooks', () => ({
  ...realSdkHooks,
  toast,
  usePluginJsonFetch: (_pluginId: string, path: string | null) => {
    if (path === 'tour') return { ...tourResponse, refresh }
    if (path === null) return { data: null, loading: false, error: null, refresh }
    return { ...response, refresh }
  },
  useTerminalHandoff: () => ({
    available: terminal.available,
    busy: false,
    error: terminal.error,
    open: async (command: string, title: string) => { terminalOpens.push([command, title]); return terminal.opens },
  }),
}))

const pushed: string[] = []
/** The page's query string, as the one key it reads. */
let query: Record<string, string> = {}
const querySets: Array<[string, string]> = []
mock.module('@makinbakin/sdk/navigation', () => ({
  useQueryState: (key: string, fallback = '') => [query[key] ?? fallback, (value: string) => { querySets.push([key, value]) }, () => {}],
  PluginLink: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ push: (path: string) => { pushed.push(path) } }),
}))

const drafts: Array<[string, string]> = []
/** What the composer reported back to its owner: a rejected send keeps the text. */
let lastSend: 'resolved' | 'rejected' | null = null
mock.module('@makinbakin/sdk/conversation', () => ({
  writeComposerDraft: (key: string, text: string) => { drafts.push([key, text]) },
  // The introduction's exchange: who is speaking and what was said is all a test needs.
  AgentTurn: ({ turn, agent }: { turn: { items: Array<{ content: string }> }; agent: { name: string } }) => <p data-said-by={agent.name}>{turn.items[0]!.content}</p>,
  UserMessage: ({ turn }: { turn: { content: string } }) => <p data-said-by="you">{turn.content}</p>,
  Composer: ({ onSend, inputLabel, busy }: { onSend: (content: string) => void | Promise<void>; inputLabel?: string; busy?: boolean }) => (
    <form onSubmit={(event) => {
      event.preventDefault()
      const value = (event.currentTarget.elements.namedItem('ask') as HTMLInputElement).value
      void Promise.resolve(onSend(value)).then(() => { lastSend = 'resolved' }, () => { lastSend = 'rejected' })
    }}>
      <input name="ask" aria-label={inputLabel} data-busy={busy ? 'true' : 'false'} />
      <button type="submit">Send</button>
    </form>
  ),
}))

type Answer = { status: number; body: unknown } | Error
let answers: Answer[] = []
const requests: Array<{ path: string; body: unknown }> = []
/** When set, the create request waits for this before answering. */
let holdCreate: Promise<void> | null = null
mock.module('@makinbakin/sdk/utils', () => ({
  pluginFetch: async (_pluginId: string, path: string, init?: RequestInit) => {
    requests.push({ path, body: init?.body === undefined ? null : JSON.parse(String(init.body)) })
    if (path === 'chats' && holdCreate) await holdCreate
    const answer = answers.shift()
    if (!answer || answer instanceof Error) throw answer ?? new Error('unscripted request')
    return new Response(JSON.stringify(answer.body), { status: answer.status })
  },
}))

import { HomePage } from '../../../plugins/home/components/home-page'

const PERSONALITIES = [
  { id: 'warm', label: 'Warm and encouraging', sample: 'Nice, that is a solid start.' },
  { id: 'direct', label: 'Direct and efficient', sample: 'Done. Three issues found.' },
]
const STARTERS = [
  { id: 'brainstorm', title: 'Brainstorm ideas', description: 'Think out loud', prompt: 'Brainstorm with me.', needsAttachment: false },
  { id: 'summarize-document', title: 'Summarize a document', description: 'Attach a file', prompt: 'Please summarize the attached document.', needsAttachment: true },
]
type Shown = Omit<HomeStateResponse, 'personalities' | 'hello' | 'introductionSkipped' | 'suggestions' | 'suggestionCount'> & { hello?: boolean; introductionSkipped?: boolean; suggestions?: HomeStateResponse['suggestions']; suggestionCount?: number }
const ready = (starters = STARTERS): Shown => ({ ok: true, state: { name: 'ready', agent: { id: 'main', name: 'Nova' } }, starters })
const show = async (data: Shown | null, over: Partial<typeof response> = {}) => {
  response = { data: data ? { hello: false, introductionSkipped: false, suggestions: [], suggestionCount: 0, ...data, personalities: PERSONALITIES } : null, loading: false, error: null, ...over }
  await actRender(() => render(<HomePage />))
}
const ask = async (text: string) => {
  fireEvent.change(screen.getByLabelText('Ask Nova'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
}

beforeEach(() => {
  answers = []
  requests.length = 0
  pushed.length = 0
  query = {}
  tourResponse = { data: { ok: true, slides: TOUR }, loading: false, error: null }
  querySets.length = 0
  terminal = { available: false, error: null, opens: 's1' }
  terminalOpens.length = 0
  realSdkHooks.handoffReturnChannel('home').take()
  drafts.length = 0
  lastSend = null
  holdCreate = null
  toast.mockClear()
  refresh.mockClear()
})
afterEach(() => { cleanup() })

describe('Home: ready', () => {
  it('asks what you want to do, by the agent\'s name, and lists the starters', async () => {
    await show(ready())
    expect(screen.getByRole('heading', { level: 1, name: 'What do you want to do?' })).toBeTruthy()
    expect(screen.getByLabelText('Ask Nova')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Brainstorm ideas' })).toBeTruthy()
    expect(screen.getByText('Think out loud')).toBeTruthy()
  })

  it('offers six starters at most, and no starter section when there are none', async () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ ...STARTERS[0]!, id: `s${index}`, title: `Starter ${index}` }))
    await show(ready(many))
    expect(screen.getAllByRole('button', { name: /^Starter / })).toHaveLength(6)
    cleanup()
    await show(ready([]))
    expect(screen.queryByText('Or start with one of these')).toBeNull()
  })

  it('typing and sending creates a chat with the main agent, sends the words, and opens it', async () => {
    answers = [{ status: 201, body: { chat: { id: 'c1' } } }, { status: 202, body: { ok: true } }]
    await show(ready())
    await ask('  Plan my week  ')
    await waitFor(() => expect(pushed).toEqual(['/chat/c1']))
    expect(requests).toEqual([{ path: 'chats', body: { agentId: 'main' } }, { path: 'chats/c1/messages', body: { content: 'Plan my week' } }])
    expect(toast).not.toHaveBeenCalled()
  })

  it('a starter sends its prompt the same way', async () => {
    answers = [{ status: 201, body: { chat: { id: 'c2' } } }, { status: 202, body: { ok: true } }]
    await show(ready())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Brainstorm ideas' })) })
    await waitFor(() => expect(pushed).toEqual(['/chat/c2']))
    expect(requests[1]).toEqual({ path: 'chats/c2/messages', body: { content: 'Brainstorm with me.' } })
  })

  it('a starter that needs a file goes to Chat\'s draft with the words waiting, and sends nothing', async () => {
    await show(ready())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Summarize a document' })) })
    expect(pushed).toEqual(['/chat/new?agent=main'])
    expect(drafts).toEqual([['chat-draft:main', 'Please summarize the attached document.']])
    expect(requests).toEqual([])
  })

  it('when the chat cannot be created, it says so, stays on Home, and the composer keeps the text', async () => {
    answers = [{ status: 500, body: { error: 'nope' } }]
    await show(ready())
    await ask('hello')
    await waitFor(() => expect(lastSend).toBe('rejected'))
    expect(pushed).toEqual([])
    expect(toast).toHaveBeenCalledWith("Couldn't start a conversation with Nova. Try again.", 'error')
  })

  it('when the message does not send, the chat still opens with the words waiting in its composer', async () => {
    answers = [{ status: 201, body: { chat: { id: 'c3' } } }, new Error('connection reset')]
    await show(ready())
    await ask('Research llamas')
    await waitFor(() => expect(pushed).toEqual(['/chat/c3']))
    expect(drafts).toEqual([['chat:c3', 'Research llamas']])
    expect(toast).toHaveBeenCalledWith("Message didn't send. Your text is waiting in the composer.", 'error')
  })

  it('a second submit while the first is still creating its chat makes one chat, not two', async () => {
    let release!: () => void
    holdCreate = new Promise<void>((resolve) => { release = resolve })
    answers = [{ status: 201, body: { chat: { id: 'c4' } } }, { status: 202, body: { ok: true } }]
    await show(ready())
    await ask('once')
    await ask('twice')
    await act(async () => { release() })
    await waitFor(() => expect(pushed).toEqual(['/chat/c4']))
    expect(requests.filter((request) => request.path === 'chats')).toHaveLength(1)
  })

  it('blank input does nothing', async () => {
    await show(ready())
    await ask('   ')
    expect(requests).toEqual([])
  })
})

describe('Home: not ready', () => {
  it('loading, then an error with a way to try again', async () => {
    await show(null, { loading: true })
    expect(screen.getByText('Loading Home')).toBeTruthy()
    cleanup()
    await show(null, { error: 'boom' })
    expect(screen.getByText("Home couldn't load")).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('an unreachable runtime points at Health; a model that cannot run points at Models with the reason', async () => {
    await show({ ok: true, state: { name: 'unavailable', reason: 'runtime_unreachable', href: '/health' }, starters: [] })
    expect(screen.getByText("Bakin can't reach its agents right now")).toBeTruthy()
    cleanup()
    await show({ ok: true, state: { name: 'unavailable', reason: 'model_cannot_run', detail: 'no credentials for openai', href: '/models' }, starters: [] })
    expect(screen.getByText(/no credentials for openai/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Models' }).getAttribute('href')).toBe('/models')
  })
})

describe('Home: saying hello', () => {
  const offered = (): Shown => ({ ...ready(), hello: true })

  it('is not offered unless the server says so', async () => {
    await show(ready())
    expect(screen.queryByRole('button', { name: 'Say hello to Nova' })).toBeNull()
  })

  it('sends an ordinary first message in a titled chat, records the hello, and opens the chat', async () => {
    answers = [{ status: 201, body: { chat: { id: 'c9' } } }, { status: 202, body: { ok: true } }, { status: 200, body: { ok: true } }]
    await show(offered())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Say hello to Nova' })) })
    await waitFor(() => expect(pushed).toEqual(['/chat/c9']))
    expect(requests).toEqual([
      { path: 'chats', body: { agentId: 'main', title: 'Meeting Nova' } },
      { path: 'chats/c9/messages', body: { content: 'Hello, Nova!' } },
      { path: 'hello', body: null },
    ])
  })

  it('a chat that cannot be created says so, records nothing, and the offer stays', async () => {
    answers = [{ status: 500, body: { error: 'nope' } }]
    await show(offered())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Say hello to Nova' })) })
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't start a conversation with Nova. Try again.", 'error'))
    expect(requests.map((request) => request.path)).toEqual(['chats'])
    expect(pushed).toEqual([])
    expect(screen.getByRole('button', { name: 'Say hello to Nova' })).toBeTruthy()
  })

  it('a hello that could not be recorded still opens the chat: it is only offered again', async () => {
    answers = [{ status: 201, body: { chat: { id: 'c10' } } }, { status: 202, body: { ok: true } }, new Error('connection reset')]
    await show(offered())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Say hello to Nova' })) })
    await waitFor(() => expect(pushed).toEqual(['/chat/c10']))
  })

  it('"Not now" puts the offer away without sending anything, and Home looks again', async () => {
    answers = [{ status: 200, body: { ok: true } }]
    await show(offered())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not now' })) })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests).toEqual([{ path: 'hello', body: null }])
    expect(pushed).toEqual([])
  })
})

describe('Home: meet your agent', () => {
  const meet = (resume?: { agentName: string; personality: { kind: 'preset'; id: string } | { kind: 'custom'; description: string }; userName: string }): Shown => ({
    ok: true, state: { name: 'meet-agent', agent: { id: 'main', name: 'Main' }, ...(resume ? { resume } : {}) }, starters: STARTERS,
  })
  const type = (label: string, value: string) => { fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } }) }
  const press = async (name: string) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })) }) }
  const said = (by: string) => Array.from(document.querySelectorAll(`[data-said-by="${by}"]`)).map((node) => node.textContent)

  it('opens on the first question, with no prompt and no starters', async () => {
    await show(meet())
    expect(screen.getByRole('heading', { level: 1, name: 'Meet your main agent' })).toBeTruthy()
    expect(said('Your main agent')).toEqual(["Hi. I don't have a name yet. What would you like to call me?"])
    expect(screen.queryByLabelText(/^Ask /)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Brainstorm ideas' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('three answers, shown back as a conversation, are saved once and Home looks again', async () => {
    answers = [{ status: 200, body: { ok: true } }]
    await show(meet())
    type("Your agent's name", '  Nova ')
    await press('Continue')
    expect(said('Nova')).toEqual(["Hi. I don't have a name yet. What would you like to call me?", 'Nova. I like it. How should I come across?'])
    expect(said('you')).toEqual(['Nova'])
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Direct and efficient/ })) })
    await press('Continue')
    expect(said('you')).toEqual(['Nova', 'Direct and efficient'])
    expect(requests).toEqual([])
    type('Your name', 'Mark')
    await press('Finish')
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests).toEqual([{ path: 'introduction', body: { agentName: 'Nova', personality: { kind: 'preset', id: 'direct' }, userName: 'Mark' } }])
  })

  it('a blank answer does not move on', async () => {
    await show(meet())
    type("Your agent's name", '   ')
    await press('Continue')
    expect(screen.getByLabelText("Your agent's name", { exact: false })).toBeTruthy()
    expect(said('you')).toEqual([])
  })

  it('"Describe it yourself" asks for the words and sends them as written', async () => {
    answers = [{ status: 200, body: { ok: true } }]
    await show(meet())
    type("Your agent's name", 'Nova')
    await press('Continue')
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Describe it yourself' })) })
    await press('Continue')
    expect(said('you')).toEqual(['Nova'])
    type('In your own words', 'Like a patient teacher')
    await press('Continue')
    type('Your name', 'Mark')
    await press('Finish')
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]!.body).toEqual({ agentName: 'Nova', personality: { kind: 'custom', description: 'Like a patient teacher' }, userName: 'Mark' })
  })

  it('Back returns to the earlier question with the answer still there', async () => {
    await show(meet())
    type("Your agent's name", 'Nova')
    await press('Continue')
    await press('Back')
    expect((screen.getByLabelText("Your agent's name", { exact: false }) as HTMLInputElement).value).toBe('Nova')
    expect(said('you')).toEqual([])
  })

  it('a save that fails says which part, keeps every answer, and finishes on a second try', async () => {
    answers = [{ status: 502, body: { ok: false, step: 'sync', error: 'install-state is busy' } }, { status: 200, body: { ok: true } }]
    await show(meet())
    type("Your agent's name", 'Nova')
    await press('Continue')
    await press('Continue')
    type('Your name', 'Mark')
    await press('Finish')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('your agents have not been told yet'))
    expect(refresh).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Your name', { exact: false }) as HTMLInputElement).value).toBe('Mark')
    await press('Finish')
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
  })

  it('a server that cannot be reached says so and keeps the answers', async () => {
    answers = [new Error('connection refused')]
    await show(meet({ agentName: 'Nova', personality: { kind: 'preset', id: 'warm' }, userName: 'Mark' }))
    await press('Finish')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("Bakin couldn't be reached"))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('answers that were given but not all saved come back on the last step, ready to finish', async () => {
    answers = [{ status: 200, body: { ok: true } }]
    await show(meet({ agentName: 'Nova', personality: { kind: 'custom', description: 'Dry and brief' }, userName: 'Mark' }))
    expect(said('you')).toEqual(['Nova', 'Dry and brief'])
    expect((screen.getByLabelText('Your name', { exact: false }) as HTMLInputElement).value).toBe('Mark')
    expect(screen.getByRole('alert').textContent).toContain("setup didn't finish")
    await press('Finish')
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests[0]!.body).toEqual({ agentName: 'Nova', personality: { kind: 'custom', description: 'Dry and brief' }, userName: 'Mark' })
  })

  it('"Skip for now" records the skip and Home looks again; a skip that fails stays put and says so', async () => {
    answers = [{ status: 500, body: { error: 'disk full' } }, { status: 200, body: { ok: true } }]
    await show(meet())
    await press('Skip for now')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("Skipping couldn't be saved"))
    expect(refresh).not.toHaveBeenCalled()
    await press('Skip for now')
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests).toEqual([{ path: 'introduction/skip', body: null }, { path: 'introduction/skip', body: null }])
  })
})

describe('Home: the introduction can be reopened', () => {
  const press = async (name: string) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })) }) }

  it('a skipped introduction leaves a quiet way back on Home; one that was never skipped does not', async () => {
    await show({ ...ready(), introductionSkipped: true })
    expect(screen.getByRole('link', { name: 'Meet Nova' }).getAttribute('href')).toBe('/?introduce=1')
    cleanup()
    await show({ ok: true, state: { name: 'needs-login', agent: { id: 'main', name: 'Main' } }, starters: [], introductionSkipped: true })
    expect(screen.getByRole('link', { name: 'Meet Main' })).toBeTruthy()
    cleanup()
    await show(ready())
    expect(screen.queryByRole('link', { name: /^Meet / })).toBeNull()
  })

  it('?introduce=1 opens the introduction over a ready Home, starting from the name the agent has', async () => {
    query = { introduce: '1' }
    await show(ready())
    expect(screen.getByRole('heading', { level: 1, name: 'Meet your main agent' })).toBeTruthy()
    expect(screen.queryByLabelText(/^Ask /)).toBeNull()
    expect(document.querySelector('[data-said-by="Nova"]')?.textContent).toBe("Let's start over. What would you like to call me?")
    expect((screen.getByLabelText("Your agent's name", { exact: false }) as HTMLInputElement).value).toBe('Nova')
  })

  it('Cancel leaves without recording anything: no skip is written over a finished introduction', async () => {
    query = { introduce: '1' }
    await show(ready())
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    await press('Cancel')
    expect(querySets).toEqual([['introduce', '']])
    expect(requests).toEqual([])
    expect(refresh).not.toHaveBeenCalled()
  })

  it('finishing saves the new answers, closes the introduction, and Home looks again', async () => {
    answers = [{ status: 200, body: { ok: true } }]
    query = { introduce: '1' }
    await show(ready())
    fireEvent.change(screen.getByLabelText("Your agent's name", { exact: false }), { target: { value: 'Juno' } })
    await press('Continue')
    await press('Continue')
    fireEvent.change(screen.getByLabelText('Your name', { exact: false }), { target: { value: 'Mark' } })
    await press('Finish')
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests).toEqual([{ path: 'introduction', body: { agentName: 'Juno', personality: { kind: 'preset', id: 'warm' }, userName: 'Mark' } }])
    expect(querySets).toEqual([['introduce', '']])
  })

  it('a home that cannot read its agents shows that, whatever the URL asks for', async () => {
    query = { introduce: '1' }
    await show({ ok: true, state: { name: 'unavailable', reason: 'runtime_unreachable', href: '/health' }, starters: [] })
    expect(screen.getByText("Bakin can't reach its agents right now")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })
})

describe('Home: logging in', () => {
  const LOGIN = { runtime: 'Pi', steps: ['Open another terminal and run `pi`.', 'Type `/login` and pick a provider.'], command: 'pi', docsUrl: 'https://pi.dev/docs/latest' }
  const needsLogin = (login: Partial<typeof LOGIN> | null = LOGIN): Shown => ({
    ok: true, state: { name: 'needs-login', agent: { id: 'main', name: 'Nova' } }, starters: STARTERS, ...(login ? { login: login as typeof LOGIN } : {}),
  })
  const home = () => realSdkHooks.handoffReturnChannel('home')

  it("shows the runtime's own steps in order, the command, and says Bakin never sees the secret", async () => {
    await show(needsLogin())
    expect(screen.getByRole('heading', { level: 1, name: 'One step before Nova can answer' })).toBeTruthy()
    expect(screen.getAllByRole('listitem').slice(0, 2).map((item) => item.textContent)).toEqual(['1.Open another terminal and run pi.', '2.Type /login and pick a provider.'])
    expect(screen.getByText('/login').tagName).toBe('CODE')
    expect(screen.getByText(/Bakin never sees your password or key/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Pi docs' }).getAttribute('href')).toBe('https://pi.dev/docs/latest')
  })

  it('nothing that would fail is offered: no prompt, and the starters are shown but cannot be pressed', async () => {
    await show(needsLogin())
    expect(screen.queryByLabelText(/^Ask /)).toBeNull()
    expect(screen.getByText('Brainstorm ideas')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Brainstorm ideas' })).toBeNull()
  })

  it('without a browser terminal the card is copy-only', async () => {
    await show(needsLogin())
    expect(screen.queryByRole('button', { name: /Terminal/ })).toBeNull()
    expect(screen.getByText(/Run this in a terminal on the machine Bakin runs on/)).toBeTruthy()
  })

  it('with Terminal installed, "Open in Terminal" hands over the command and arms the return check', async () => {
    terminal.available = true
    await show(needsLogin())
    expect(screen.getByText(/Press Enter to run it/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Terminal/ })) })
    expect(terminalOpens).toEqual([['pi', 'Log in to Pi']])
    expect(home().isArmed('login')).toBe(true)
  })

  it('a terminal that could not be opened arms nothing and says so', async () => {
    terminal = { available: true, error: 'The Terminal plugin refused to start a session. Copy the command instead.', opens: null }
    await show(needsLogin())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Terminal/ })) })
    expect(home().isArmed('login')).toBe(false)
    expect(screen.getByText(/refused to start a session/)).toBeTruthy()
  })

  it('coming back after a handoff makes Home look again, once', async () => {
    await show(needsLogin())
    expect(refresh).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(refresh).not.toHaveBeenCalled() // nothing was handed off
    home().arm('login')
    act(() => { window.dispatchEvent(new Event('focus')) })
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('"Check again" looks at the machine again', async () => {
    await show(needsLogin())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: "I've logged in. Check again" })) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('a runtime with no command to hand over shows its steps and docs, and no card', async () => {
    await show(needsLogin({ runtime: 'OpenClaw', steps: ['Add a provider login in OpenClaw.'], docsUrl: 'https://openclaw.ai/docs/' }))
    expect(screen.getByText('Add a provider login in OpenClaw.')).toBeTruthy()
    expect(screen.queryByText('Start the sign-in')).toBeNull()
    expect(screen.getByRole('link', { name: 'OpenClaw docs' })).toBeTruthy()
  })
})

describe('Home: do more with Bakin', () => {
  const SUGGESTIONS = [
    { id: 'web-search', title: 'Let your agents search the web', payoff: 'Research with current facts and sources.', action: { label: 'Add web search', href: '/explore?tab=capabilities&item=skill-pack:web-search-brave' } },
    { id: 'add-agent', title: 'Add a specialist to your team', payoff: 'A researcher, a developer or an image artist.', action: { label: 'Browse agents', href: '/explore?tab=agents' } },
  ]
  const suggesting = (): Shown => ({ ...ready(), suggestions: SUGGESTIONS, suggestionCount: 2 })
  const section = () => screen.queryByRole('region', { name: 'Do more with Bakin' })

  it('is not there when nothing is suggested', async () => {
    await show(ready())
    expect(section()).toBeNull()
  })

  it('lists each suggestion with what it gives and one link that does it', async () => {
    await show(suggesting())
    const rows = within(section()!).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Let your agents search the web')).toBeTruthy()
    expect(within(rows[0]!).getByText('Research with current facts and sources.')).toBeTruthy()
    expect(within(rows[0]!).getByRole('link', { name: 'Add web search' }).getAttribute('href')).toBe('/explore?tab=capabilities&item=skill-pack:web-search-brave')
    expect(within(rows[1]!).getByRole('link', { name: 'Browse agents' }).getAttribute('href')).toBe('/explore?tab=agents')
    // The section is where the sidebar's count lands.
    expect(section()!.id).toBe('do-more')
  })

  it('"Not now" puts that one away on the server, and Home looks again', async () => {
    answers = [{ status: 200, body: { ok: true } }]
    await show(suggesting())
    const row = within(section()!).getAllByRole('listitem')[1]!
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Not now' })) })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests).toEqual([{ path: 'suggestions/add-agent/dismiss', body: null }])
  })

  it('a "Not now" that could not be saved says so, and the suggestion stays', async () => {
    answers = [{ status: 500, body: { ok: false, error: 'disk full' } }]
    await show(suggesting())
    await act(async () => { fireEvent.click(within(section()!).getAllByRole('button', { name: 'Not now' })[0]!) })
    await waitFor(() => expect(toast).toHaveBeenCalledWith("That couldn't be put away. Try again.", 'error'))
    expect(refresh).not.toHaveBeenCalled()
    expect(within(section()!).getAllByRole('listitem')).toHaveLength(2)
  })

  it('is not shown while logging in or meeting the agent, whatever the response carries', async () => {
    await show({ ok: true, state: { name: 'needs-login', agent: { id: 'main', name: 'Nova' } }, starters: [], suggestions: SUGGESTIONS, suggestionCount: 2 })
    expect(section()).toBeNull()
  })
})

describe('Home: the tour', () => {
  const dialog = () => screen.queryByRole('dialog')
  const touring = async (slide: string, data: Shown = ready()) => {
    query = { tour: slide }
    await show(data)
  }

  it('is offered on a ready Home and while logging in, and is never open by itself', async () => {
    await show(ready())
    expect(screen.getByRole('link', { name: 'Take a two-minute tour' }).getAttribute('href')).toBe('/?tour=start')
    expect(dialog()).toBeNull()
    cleanup()
    await show({ ok: true, state: { name: 'needs-login', agent: { id: 'main', name: 'Nova' } }, starters: [] })
    expect(screen.getByRole('link', { name: 'Take a two-minute tour' })).toBeTruthy()
    cleanup()
    await show({ ok: true, state: { name: 'meet-agent', agent: { id: 'main', name: 'Main' } }, starters: [] })
    expect(screen.queryByRole('link', { name: 'Take a two-minute tour' })).toBeNull()
  })

  it('opens on the first slide: where it is, what the area is for, one thing to try, and its page', async () => {
    await touring('start')
    const slide = within(dialog()!)
    expect(dialog()!.getAttribute('aria-labelledby')).toBeTruthy()
    expect(slide.getByRole('heading', { name: 'Chat' })).toBeTruthy()
    expect(slide.getByText('1 of 3')).toBeTruthy()
    expect(slide.getByText('Talk to any agent. Everything is kept.')).toBeTruthy()
    expect(slide.getByText('Ask your main agent something.')).toBeTruthy()
    expect(slide.getByRole('link', { name: 'Open Chat' }).getAttribute('href')).toBe('/chat')
    // Nowhere to go back to from the first slide.
    expect(slide.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('Next and Back move through the URL, naming where Next goes', async () => {
    await touring('tasks')
    const slide = within(dialog()!)
    expect(slide.getByText('2 of 3')).toBeTruthy()
    await act(async () => { fireEvent.click(slide.getByRole('button', { name: 'Next: Health' })) })
    await act(async () => { fireEvent.click(slide.getByRole('button', { name: 'Back' })) })
    expect(querySets).toEqual([['tour', 'health'], ['tour', 'chat']])
  })

  it('the last slide ends with Done, which hands back to Home', async () => {
    await touring('health')
    const slide = within(dialog()!)
    expect(slide.queryByRole('button', { name: /^Next/ })).toBeNull()
    await act(async () => { fireEvent.click(slide.getByRole('button', { name: 'Done' })) })
    expect(querySets).toEqual([['tour', '']])
  })

  it('closing it any other way also clears the URL', async () => {
    await touring('tasks')
    await act(async () => { fireEvent.click(within(dialog()!).getByRole('button', { name: 'Close the tour' })) })
    expect(querySets).toEqual([['tour', '']])
  })

  it('slides that cannot be loaded say so and put the tour away, never an empty dialog', async () => {
    tourResponse = { data: null, loading: false, error: 'Request failed (500)' }
    await touring('start')
    expect(dialog()).toBeNull()
    await waitFor(() => expect(toast).toHaveBeenCalledWith("The tour couldn't be loaded. Try again.", 'error'))
    expect(querySets).toEqual([['tour', '']])
  })
})
