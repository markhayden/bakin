// @vitest-environment jsdom
/**
 * The Home page (home-first-run plan, task 1.8): each state shows what is
 * true, the prompt and starters start a conversation, and a double submit
 * makes one chat. The kit's page, list and state patterns are real; the
 * composer is a stand-in that exposes exactly its `onSend` contract.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { actRender } from '../../rtl-settle'
import type { ReactNode } from 'react'

const contentDirMock = () => ({ getContentDir: () => '/tmp/bakin-test-home-page-unused', getBakinPaths: () => ({}) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import type { HomeStateResponse } from '../../../plugins/home/types'

let response: { data: HomeStateResponse | null; loading: boolean; error: string | null } = { data: null, loading: false, error: null }
const refresh = mock()
const toast = mock()
import * as realSdkHooks from '@makinbakin/sdk/hooks'
mock.module('@makinbakin/sdk/hooks', () => ({
  ...realSdkHooks,
  toast,
  usePluginJsonFetch: () => ({ ...response, refresh }),
}))

const pushed: string[] = []
mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ push: (path: string) => { pushed.push(path) } }),
}))

const drafts: Array<[string, string]> = []
/** What the composer reported back to its owner: a rejected send keeps the text. */
let lastSend: 'resolved' | 'rejected' | null = null
mock.module('@makinbakin/sdk/conversation', () => ({
  writeComposerDraft: (key: string, text: string) => { drafts.push([key, text]) },
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
    requests.push({ path, body: JSON.parse(String(init?.body)) })
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
type Shown = Omit<HomeStateResponse, 'personalities'>
const ready = (starters = STARTERS): Shown => ({ ok: true, state: { name: 'ready', agent: { id: 'main', name: 'Nova' } }, starters })
const show = async (data: Shown | null, over: Partial<typeof response> = {}) => {
  response = { data: data ? { ...data, personalities: PERSONALITIES } : null, loading: false, error: null, ...over }
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

  it('an unnamed main agent: says so and links to its Team page; no prompt is offered', async () => {
    await show({ ok: true, state: { name: 'meet-agent', agent: { id: 'main', name: 'Main' } }, starters: STARTERS })
    expect(screen.getByText('Your main agent has no name yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Main' }).getAttribute('href')).toBe('/team/main')
    expect(screen.queryByLabelText(/^Ask /)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Brainstorm ideas' })).toBeNull()
  })

  it('no provider logged in: names the agent and points at Health; nothing that would fail is offered', async () => {
    await show({ ok: true, state: { name: 'needs-login', agent: { id: 'main', name: 'Nova' } }, starters: STARTERS })
    expect(screen.getByText("Nova can't answer yet")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Health' }).getAttribute('href')).toBe('/health')
    expect(screen.queryByLabelText(/^Ask /)).toBeNull()
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
