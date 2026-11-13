/**
 * The Home page.
 *
 * Patterns: `storybook/public/pages/page.stories.tsx` (CanonicalUsage,
 * StandardWidth), `feedback/system-state.stories.tsx` (StateMatrix) for
 * every non-ready state, `lists/list-rows.stories.tsx` (InteractiveRows)
 * for starters, `feedback/alert.stories.tsx` (action) for the first hello,
 * and the conversation kit's `Composer` for the prompt. The
 * introduction is `introduction.tsx`.
 */
import { Suspense, useCallback, useRef, useState } from 'react'
import { Composer } from '@makinbakin/sdk/conversation'
import { toast, usePluginJsonFetch } from '@makinbakin/sdk/hooks'
import { PluginLink, useRouter } from '@makinbakin/sdk/navigation'
import { ListRow, ListRows, Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Alert, AlertAction, AlertDescription, AlertTitle, Button, SystemState } from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { draftChatWith, startChat } from '../lib/client/start-chat'
import { Introduction } from './introduction'
import type { HomeStarter, HomeState, HomeStateResponse } from '../types'

const STATE_TIMEOUT_MS = 15_000
/** How many starters Home offers at once. */
const STARTER_LIMIT = 6

function titleFor(state: HomeState | undefined): string {
  if (state?.name === 'ready') return 'What do you want to do?'
  if (state?.name === 'meet-agent') return 'Meet your main agent'
  return 'Home'
}

interface ReadyViewProps {
  agent: { id: string; name: string }
  starters: HomeStarter[]
  /** The introduction just finished and nobody has said hello yet. */
  hello: boolean
  /** The hello offer was used or put away: Home should look again. */
  onHelloSettled: () => void
}

/** The offer is over once this is recorded; a failure only means it is offered again. */
async function recordHello(): Promise<void> {
  try {
    await pluginFetch('home', 'hello', { method: 'POST' })
  } catch {
    // Nothing is lost: Home offers the hello again next time.
  }
}

function ReadyView({ agent, starters, hello, onHelloSettled }: ReadyViewProps) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  // A second submit while the first is still creating its chat must not make a second chat.
  const inFlight = useRef(false)

  const send = useCallback(async (content: string) => {
    const text = content.trim()
    if (!text || inFlight.current) return
    inFlight.current = true
    setSending(true)
    try {
      const result = await startChat(agent.id, text)
      if (!result.chatId) {
        toast(`Couldn't start a conversation with ${agent.name}. Try again.`, 'error')
        // Thrown so the composer keeps what was typed.
        throw new Error('chat was not created')
      }
      if (!result.sent) toast("Message didn't send. Your text is waiting in the composer.", 'error')
      router.push(`/chat/${encodeURIComponent(result.chatId)}`)
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }, [agent.id, agent.name, router])

  const sayHello = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setSending(true)
    try {
      const result = await startChat(agent.id, `Hello, ${agent.name}!`, { title: `Meeting ${agent.name}` })
      if (!result.chatId) {
        toast(`Couldn't start a conversation with ${agent.name}. Try again.`, 'error')
        return
      }
      await recordHello()
      if (!result.sent) toast("Message didn't send. Your text is waiting in the composer.", 'error')
      router.push(`/chat/${encodeURIComponent(result.chatId)}`)
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }, [agent.id, agent.name, router])

  const notNow = useCallback(async () => {
    await recordHello()
    onHelloSettled()
  }, [onHelloSettled])

  const pick = useCallback((starter: HomeStarter) => {
    if (starter.needsAttachment) {
      router.push(draftChatWith(agent.id, starter.prompt))
      return
    }
    void send(starter.prompt).catch(() => { /* reported by the toast above */ })
  }, [agent.id, router, send])

  return (
    <div className="flex flex-col gap-bakin-6">
      {hello ? (
        <Alert tone="accent" role="status">
          <AlertTitle>{agent.name} is ready to meet you</AlertTitle>
          <AlertDescription>Say hello and see how {agent.name} answers. You can change the name or personality any time on the Team page.</AlertDescription>
          <AlertAction>
            <Button size="xs" variant="ghost" disabled={sending} onClick={() => { void notNow() }}>Not now</Button>
            <Button size="xs" disabled={sending} onClick={() => { void sayHello() }}>Say hello to {agent.name}</Button>
          </AlertAction>
        </Alert>
      ) : null}
      <Composer
        storageKey="home"
        onSend={send}
        busy={sending}
        inputLabel={`Ask ${agent.name}`}
        placeholder={`Ask ${agent.name} for anything`}
        autoFocus
      />
      {starters.length > 0 ? (
        <section aria-labelledby="home-starters" className="flex flex-col gap-bakin-3">
          <h2 id="home-starters" className="text-bakin-text-muted">Or start with one of these</h2>
          <ListRows variant="bordered" aria-labelledby="home-starters">
            {starters.slice(0, STARTER_LIMIT).map((starter) => (
              <ListRow key={starter.id} interactive={{ label: starter.title, onActivate: () => pick(starter) }}>
                <span className="block font-bakin-typography-weight-semibold">{starter.title}</span>
                <span className="block text-bakin-text-muted">{starter.description}</span>
              </ListRow>
            ))}
          </ListRows>
        </section>
      ) : null}
    </div>
  )
}

/** States that have no screen of their own yet say what is true and where it is fixed today. */
function NotReadyView({ state }: { state: Exclude<HomeState, { name: 'ready' | 'meet-agent' }> }) {
  if (state.name === 'unavailable') {
    const model = state.reason === 'model_cannot_run'
    return (
      <SystemState
        kind="error"
        scope="page"
        title={model ? "Your agent's model can't run here" : "Bakin can't reach its agents right now"}
        description={model
          ? `A provider is logged in, but not one this agent's model belongs to${state.detail ? ` (${state.detail})` : ''}. Pick a model that can run on the Models page.`
          : 'The agent runtime is not answering. Health shows what is wrong and how to fix it.'}
        action={<Button render={<PluginLink to={state.href} />}>{model ? 'Open Models' : 'Open Health'}</Button>}
      />
    )
  }
  return (
    <SystemState
      kind="initial-empty"
      scope="page"
      title={`${state.agent.name} can't answer yet`}
      description="No AI provider is logged in, so agents cannot run. Health shows the steps to log in."
      action={<Button render={<PluginLink to="/health" />}>Open Health</Button>}
    />
  )
}

function HomePageInner() {
  const { data, loading, error, refresh } = usePluginJsonFetch<HomeStateResponse>('home', 'state', { timeoutMs: STATE_TIMEOUT_MS })
  const state = data?.state

  return (
    <Page width="standard">
      <PageHeader title={titleFor(state)} />
      <PageBody label="Home">
        {loading && !data ? (
          <SystemState kind="loading" scope="page" title="Loading Home" description="Checking what your agents can do." />
        ) : error || !data || !state ? (
          <SystemState
            kind="error"
            scope="page"
            title="Home couldn't load"
            description="Bakin could not work out what to show. Try again; if it keeps happening, check Health."
            action={<Button variant="outline" onClick={() => { void refresh() }}>Try again</Button>}
          />
        ) : state.name === 'meet-agent' ? (
          <Introduction agent={state.agent} personalities={data.personalities} resume={state.resume} onFinished={() => { void refresh() }} />
        ) : state.name === 'ready' ? (
          <ReadyView agent={state.agent} starters={data.starters} hello={data.hello} onHelloSettled={() => { void refresh() }} />
        ) : (
          <NotReadyView state={state} />
        )}
      </PageBody>
    </Page>
  )
}

export function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageInner />
    </Suspense>
  )
}
