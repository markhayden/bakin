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
  // Passes its props on: the kit renders whole-card links through it with their own label.
  PluginLink: ({ to, children, ...rest }: { to: string; children?: ReactNode } & Record<string, unknown>) => <a href={to} {...rest}>{children}</a>,
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

/** What the everyday Home reads from Tasks, Chat and Schedule; null is "not read yet". The reduction has its own test. */
let activity: HomeActivity | null = null
const NO_WORK: HomeActivity = { hasWork: false, tasks: { planned: 0, inProgress: 0, completed: 0, blocked: 0 }, projects: null, scheduled: { jobs: 0, comingUp: 0 }, pickUp: [] }
mock.module('../../../plugins/home/lib/client/activity', () => ({ useHomeActivity: (enabled: boolean) => (enabled ? activity : null) }))

import { HomePage } from '../../../plugins/home/components/home-page'
import type { HomeActivity } from '../../../plugins/home/lib/client/activity'

const PERSONALITIES = [
  { id: 'warm', label: 'Charming', sample: 'Nice, that is a solid start.' },
  { id: 'direct', label: 'Brutally efficient', sample: 'Done. Three issues found.' },
]
const STARTERS = [
  { id: 'brainstorm', title: 'Brainstorm ideas', description: 'Think out loud', prompt: 'Brainstorm with me.', needsAttachment: false },
  { id: 'summarize-document', title: 'Summarize a document', description: 'Attach a file', prompt: 'Please summarize the attached document.', needsAttachment: true },
]
type Shown = Omit<HomeStateResponse, 'personalities' | 'firstDay' | 'introductionSkipped' | 'suggestions' | 'suggestionCount'> & { firstDay?: boolean; introductionSkipped?: boolean; suggestions?: HomeStateResponse['suggestions']; suggestionCount?: number }
const ready = (starters = STARTERS): Shown => ({ ok: true, state: { name: 'ready', agent: { id: 'main', name: 'Nova' } }, starters })
const show = async (data: Shown | null, over: Partial<typeof response> = {}) => {
  response = { data: data ? { firstDay: false, introductionSkipped: false, suggestions: [], suggestionCount: 0, ...data, personalities: PERSONALITIES } : null, loading: false, error: null, ...over }
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
  // Most tests are about a home with nothing done yet; the activity read has landed.
  activity = { ...NO_WORK }
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
  it('greets a returning person by name, in the agent\'s voice, with the prompt and the starters', async () => {
    await show({ ...ready(), person: 'Mark' })
    expect(screen.getByRole('heading', { level: 1, name: 'Hey Mark, welcome back.' })).toBeTruthy()
    expect(screen.getByLabelText('Ask Nova')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Brainstorm ideas' })).toBeTruthy()
    expect(screen.getByText('Think out loud')).toBeTruthy()
    cleanup()
    // Nobody's name on record: the greeting does without one.
    await show(ready())
    expect(screen.getByRole('heading', { level: 1, name: 'Hey, welcome back.' })).toBeTruthy()
  })

  it('offers four starters at most, and no starter section when there are none', async () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ ...STARTERS[0]!, id: `s${index}`, title: `Starter ${index}` }))
    await show(ready(many))
    expect(screen.getAllByRole('button', { name: /^Starter / })).toHaveLength(4)
    cleanup()
    await show(ready([]))
    expect(screen.queryByText(/Try one of these/)).toBeNull()
  })

  it('typing and sending creates a chat with the main agent, sends the words, and opens it', async () => {
    answers = [{ status: 201, body: { chat: { id: 'c1' } } }, { status: 202, body: { ok: true } }]
    await show(ready())
    await ask('  Plan my week  ')
    await waitFor(() => expect(pushed).toEqual(['/chat/c1']))
    expect(requests).toEqual([{ path: 'chats', body: { agentId: 'main' } }, { path: 'chats/c1/messages', body: { content: 'Plan my week' } }])
    expect(toast).not.toHaveBeenCalled()
  })

  it('a starter sends its prompt the same way, and is not offered again once it went', async () => {
    answers = [{ status: 201, body: { chat: { id: 'c2' } } }, { status: 202, body: { ok: true } }, { status: 200, body: { ok: true } }]
    await show(ready())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Brainstorm ideas' })) })
    await waitFor(() => expect(pushed).toEqual(['/chat/c2']))
    expect(requests.find((request) => request.path === 'chats/c2/messages')).toEqual({ path: 'chats/c2/messages', body: { content: 'Brainstorm with me.' } })
    await waitFor(() => expect(requests.map((request) => request.path)).toEqual(['chats', 'chats/c2/messages', 'starters/brainstorm/used']))
  })

  it('a starter whose conversation could not start stays on offer', async () => {
    answers = [{ status: 500, body: { error: 'nope' } }]
    await show(ready())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Brainstorm ideas' })) })
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't start a conversation with Nova. Try again.", 'error'))
    expect(requests.map((request) => request.path)).toEqual(['chats'])
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

describe('Home: the first day', () => {
  const firstDay = (): Shown => ({ ...ready(), firstDay: true, person: 'Mark' })

  it('ends as soon as there is work anywhere, not only a request from Home, and Home records it', async () => {
    activity = { ...NO_WORK, hasWork: true }
    answers = [{ status: 200, body: { ok: true } }]
    await show(firstDay())
    expect(screen.getByRole('heading', { level: 1, name: 'Hey Mark, welcome back.' })).toBeTruthy()
    await waitFor(() => expect(requests.map((request) => request.path)).toEqual(['first-request']))
  })


  it('is its own greeting, with every starter and nothing about work yet', async () => {
    activity = { ...NO_WORK }
    await show(firstDay())
    expect(screen.getByRole('heading', { level: 1, name: "Well, look at that. We're all set." })).toBeTruthy()
    expect(screen.getByText('Not sure where to start? Try one of these.')).toBeTruthy()
    expect(document.querySelector('[data-home-areas]')).toBeNull()
  })

  it('ends with the first thing asked for, typed or picked', async () => {
    activity = { ...NO_WORK }
    answers = [{ status: 201, body: { chat: { id: 'c9' } } }, { status: 202, body: { ok: true } }, { status: 200, body: { ok: true } }]
    await show(firstDay())
    await ask('Plan my week')
    await waitFor(() => expect(pushed).toEqual(['/chat/c9']))
    expect(requests.map((request) => request.path)).toEqual(['chats', 'chats/c9/messages', 'first-request'])
  })

  it('a first request that could not be recorded still opens the chat: the first day just lasts a little longer', async () => {
    activity = { ...NO_WORK }
    answers = [{ status: 201, body: { chat: { id: 'c10' } } }, { status: 202, body: { ok: true } }, new Error('connection reset')]
    await show(firstDay())
    await ask('Plan my week')
    await waitFor(() => expect(pushed).toEqual(['/chat/c10']))
  })

  it('a returning person records nothing extra', async () => {
    answers = [{ status: 201, body: { chat: { id: 'c11' } } }, { status: 202, body: { ok: true } }]
    await show(ready())
    await ask('Plan my week')
    await waitFor(() => expect(pushed).toEqual(['/chat/c11']))
    expect(requests.map((request) => request.path)).toEqual(['chats', 'chats/c11/messages'])
  })
})

describe('Home: once there is work', () => {
  const WORK: HomeActivity = {
    hasWork: true,
    tasks: { planned: 2, inProgress: 1, completed: 4, blocked: 0 },
    projects: 0,
    scheduled: { jobs: 3, comingUp: 5 },
    pickUp: [
      { key: 'chat:c1', kind: 'chat', title: 'Avatar ideas', detail: 'Chat · Done, option 3 it is.', href: '/chat/c1', at: 2 },
      { key: 'task:t2', kind: 'task', title: 'Draft post', detail: 'Task · Waiting on you', href: '/tasks?taskId=t2', at: 1 },
    ],
  }
  const area = (title: string) => within(document.querySelector(`[data-home-area="${title}"]`) as HTMLElement)

  it('shows nothing about work until there is some: a quiet home keeps "where to start"', async () => {
    activity = { ...WORK, hasWork: false, pickUp: [] }
    await show(ready())
    expect(document.querySelector('[data-home-areas]')).toBeNull()
    expect(screen.getByText('Not sure where to start? Try one of these.')).toBeTruthy()
  })

  it('four doors into the app, each with what is behind it and where it leads', async () => {
    activity = WORK
    await show(ready())
    expect(area('Tasks').getByText('7')).toBeTruthy()
    expect(area('Tasks').getByText('total tasks')).toBeTruthy()
    for (const label of ['Planned', 'In progress', 'Completed', 'Blocked']) expect(area('Tasks').getByText(label)).toBeTruthy()
    expect(area('Tasks').getByRole('link', { name: 'Tasks: Open the board' }).getAttribute('href')).toBe('/tasks')
    expect(area('Projects').getByText('None yet. Good for anything bigger than one task.')).toBeTruthy()
    expect(area('Projects').getByRole('link', { name: 'Projects: Start a project' }).getAttribute('href')).toBe('/projects')
    expect(area('Scheduled tasks').getByText('5')).toBeTruthy()
    expect(area('Scheduled tasks').getByText('3 jobs on autopilot.')).toBeTruthy()
    expect(area('Scheduled tasks').getByRole('link').getAttribute('href')).toBe('/schedule')
    expect(area('Team').getByRole('link').getAttribute('href')).toBe('/team')
  })

  it('without the Projects plugin, the Projects door leads to adding it', async () => {
    activity = { ...WORK, projects: null }
    await show(ready())
    expect(area('Projects').getByRole('link', { name: 'Projects: Add Projects' }).getAttribute('href')).toBe('/explore?tab=plugins&item=plugin:projects')
    expect(area('Projects').queryByText('active projects')).toBeNull()
  })

  it('a page that could not answer says so, never a zero it does not know', async () => {
    activity = { ...WORK, tasks: 'unknown', scheduled: 'unknown', projects: 'unknown' }
    await show(ready())
    for (const title of ['Tasks', 'Projects', 'Scheduled tasks']) {
      expect(area(title).getByText("Couldn't load this right now. Open it to see.")).toBeTruthy()
      expect(area(title).queryByText('0')).toBeNull()
    }
  })

  it('recent activity lists what was last touched, each a link to it', async () => {
    activity = WORK
    await show(ready())
    const list = within(screen.getByRole('list', { name: 'Recent activity' }))
    expect(list.getAllByRole('listitem')).toHaveLength(2)
    expect(list.getByRole('link', { name: 'Avatar ideas' }).getAttribute('href')).toBe('/chat/c1')
    expect(list.getByText('Task · Waiting on you')).toBeTruthy()
    expect(list.getByRole('link', { name: 'Draft post' }).getAttribute('href')).toBe('/tasks?taskId=t2')
  })

  it('the starters that are left are offered as things not tried yet', async () => {
    activity = WORK
    await show(ready())
    expect(screen.getByText("A few things we haven't tried yet.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Brainstorm ideas' })).toBeTruthy()
  })
})

describe('Home: meet your agent', () => {
  const meet = (resume?: { agentName: string; personality: { kind: 'preset'; id: string } | { kind: 'custom'; description: string }; userName: string }): Shown => ({
    ok: true, state: { name: 'meet-agent', agent: { id: 'main', name: 'Main' }, ...(resume ? { resume } : {}) }, starters: STARTERS,
  })
  const NAME = 'Give me a name…'
  const YOU = 'Your name…'
  const OWN_WORDS = 'Or describe my personality in your own words'
  const type = (placeholder: string, value: string) => { fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } }) }
  const press = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })) }) }
  const heading = () => screen.getByRole('heading', { level: 1 }).textContent
  const step = () => document.querySelector('[data-home-introduction]')?.getAttribute('data-step')

  it('opens on the name, in the agent\'s voice, with no prompt, no starters and no way to skip', async () => {
    await show(meet())
    expect(heading()).toBe("Oh good, you're here.")
    expect(screen.getByRole('heading', { level: 2, name: 'What would you like to call me?' })).toBeTruthy()
    expect(screen.queryByLabelText(/^Ask /)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Brainstorm ideas' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    // The button says what it will do once there is a name to do it with.
    expect(screen.getByRole('button', { name: 'Give me a name' })).toBeTruthy()
    type(NAME, 'Nova')
    expect(screen.getByRole('button', { name: 'Call me Nova' })).toBeTruthy()
  })

  it('three answers, each step speaking by the name just given, are saved once and Home looks again', async () => {
    answers = [{ status: 200, body: { ok: true } }]
    await show(meet())
    type(NAME, '  Nova ')
    await press('Call me Nova')
    expect(heading()).toBe('Nova. I like it.')
    expect(screen.getByText(/what kind of Nova are we talking about/)).toBeTruthy()
    // The first personality is chosen until another is picked.
    expect(screen.getByRole('radio', { name: 'Charming' }).getAttribute('aria-checked')).toBe('true')
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Brutally efficient' })) })
    expect(screen.getByRole('radio', { name: 'Brutally efficient' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Charming' }).getAttribute('aria-checked')).toBe('false')
    await press("That's me")
    expect(step()).toBe('you')
    expect(requests).toEqual([])
    type(YOU, 'Mark')
    await press("Let's get to work")
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests).toEqual([{ path: 'introduction', body: { agentName: 'Nova', personality: { kind: 'preset', id: 'direct' }, userName: 'Mark' } }])
  })

  it('a blank answer does not move on', async () => {
    await show(meet())
    type(NAME, '   ')
    await press('Give me a name')
    expect(step()).toBe('name')
  })

  it('typing in your own words is the choice: no card to press first, and clearing it goes back to a card', async () => {
    answers = [{ status: 200, body: { ok: true } }]
    await show(meet())
    type(NAME, 'Nova')
    await press('Call me Nova')
    fireEvent.change(screen.getByLabelText(OWN_WORDS), { target: { value: 'Like a patient teacher' } })
    expect(screen.getByRole('radio', { name: 'Charming' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.change(screen.getByLabelText(OWN_WORDS), { target: { value: '  ' } })
    expect(screen.getByRole('radio', { name: 'Charming' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByLabelText(OWN_WORDS), { target: { value: 'Like a patient teacher' } })
    await press("That's me")
    type(YOU, 'Mark')
    await press("Let's get to work")
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]!.body).toEqual({ agentName: 'Nova', personality: { kind: 'custom', description: 'Like a patient teacher' }, userName: 'Mark' })
  })

  it('Back returns to the earlier question with the answer still there', async () => {
    await show(meet())
    type(NAME, 'Nova')
    await press('Call me Nova')
    await press('Back')
    expect((screen.getByPlaceholderText(NAME) as HTMLInputElement).value).toBe('Nova')
    expect(step()).toBe('name')
  })

  it('a save that fails says which part, keeps every answer, and finishes on a second try', async () => {
    answers = [{ status: 502, body: { ok: false, step: 'sync', error: 'install-state is busy' } }, { status: 200, body: { ok: true } }]
    await show(meet())
    type(NAME, 'Nova')
    await press('Call me Nova')
    await press("That's me")
    type(YOU, 'Mark')
    await press("Let's get to work")
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('your agents have not been told yet'))
    expect(refresh).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText(YOU) as HTMLInputElement).value).toBe('Mark')
    await press("Let's get to work")
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
  })

  it('a server that cannot be reached says so and keeps the answers', async () => {
    answers = [new Error('connection refused')]
    await show(meet({ agentName: 'Nova', personality: { kind: 'preset', id: 'warm' }, userName: 'Mark' }))
    await press("Let's get to work")
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("Bakin couldn't be reached"))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('answers that were given but not all saved come back on the last step, ready to finish', async () => {
    answers = [{ status: 200, body: { ok: true } }]
    await show(meet({ agentName: 'Nova', personality: { kind: 'custom', description: 'Dry and brief' }, userName: 'Mark' }))
    expect(step()).toBe('you')
    expect((screen.getByPlaceholderText(YOU) as HTMLInputElement).value).toBe('Mark')
    expect(screen.getByRole('alert').textContent).toContain("setup didn't finish")
    await press("Let's get to work")
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests[0]!.body).toEqual({ agentName: 'Nova', personality: { kind: 'custom', description: 'Dry and brief' }, userName: 'Mark' })
  })

  it('only a failed save offers a way past the welcome: nobody is left stuck on it, and nobody skips it by habit', async () => {
    answers = [new Error('connection refused'), { status: 500, body: { error: 'disk full' } }, { status: 200, body: { ok: true } }]
    await show(meet({ agentName: 'Nova', personality: { kind: 'preset', id: 'warm' }, userName: 'Mark' }))
    await press("Let's get to work")
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("Bakin couldn't be reached"))
    await press('Skip for now')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("Skipping couldn't be saved either"))
    expect(refresh).not.toHaveBeenCalled()
    await press('Skip for now')
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests.map((request) => request.path)).toEqual(['introduction', 'introduction/skip', 'introduction/skip'])
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
    expect(screen.getByRole('heading', { level: 1, name: 'Back for a rethink?' })).toBeTruthy()
    expect(screen.queryByLabelText(/^Ask /)).toBeNull()
    expect((screen.getByPlaceholderText('Give me a name…') as HTMLInputElement).value).toBe('Nova')
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
    fireEvent.change(screen.getByPlaceholderText('Give me a name…'), { target: { value: 'Juno' } })
    await press('Call me Juno')
    await press("That's me")
    fireEvent.change(screen.getByPlaceholderText('Your name…'), { target: { value: 'Mark' } })
    await press("Let's get to work")
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
  const section = () => document.getElementById('do-more')

  it('is not there when nothing is suggested', async () => {
    await show(ready())
    expect(section()).toBeNull()
  })

  it('lists each suggestion with what it gives and one link that does it', async () => {
    await show(suggesting())
    const rows = within(section()!).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    // The title reads as the start of its sentence.
    expect(within(rows[0]!).getByText('Let your agents search the web.')).toBeTruthy()
    expect(within(section()!).getByRole('heading', { name: 'Want more out of your team? Here are 2 upgrades.' })).toBeTruthy()
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
    expect(screen.getByRole('link', { name: 'New to Bakin? Take a two-minute tour of what is where.' }).getAttribute('href')).toBe('/?tour=start')
    expect(dialog()).toBeNull()
    cleanup()
    await show({ ok: true, state: { name: 'needs-login', agent: { id: 'main', name: 'Nova' } }, starters: [] })
    expect(screen.getByRole('link', { name: 'New to Bakin? Take a two-minute tour of what is where.' })).toBeTruthy()
    cleanup()
    await show({ ok: true, state: { name: 'meet-agent', agent: { id: 'main', name: 'Main' } }, starters: [] })
    expect(screen.queryByRole('link', { name: 'New to Bakin? Take a two-minute tour of what is where.' })).toBeNull()
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
