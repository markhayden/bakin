/**
 * The Home page.
 *
 * Patterns: `storybook/public/pages/page.stories.tsx` (CanonicalUsage,
 * StandardWidth), `feedback/system-state.stories.tsx` (StateMatrix) for
 * every non-ready state, `lists/list-rows.stories.tsx` (InteractiveRows)
 * for starters, and the conversation kit's `Composer` for the prompt.
 */
import { Suspense, useCallback, useRef, useState } from 'react'
import { Composer } from '@makinbakin/sdk/conversation'
import { toast, usePluginJsonFetch } from '@makinbakin/sdk/hooks'
import { PluginLink, useRouter } from '@makinbakin/sdk/navigation'
import { ListRow, ListRows, Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'
import { draftChatWith, startChat } from '../lib/client/start-chat'
import type { HomeStarter, HomeState, HomeStateResponse } from '../types'

const STATE_TIMEOUT_MS = 15_000
/** How many starters Home offers at once. */
const STARTER_LIMIT = 6

function titleFor(state: HomeState | undefined): string {
  if (state?.name === 'ready') return 'What do you want to do?'
  return 'Home'
}

interface ReadyViewProps {
  agent: { id: string; name: string }
  starters: HomeStarter[]
}

function ReadyView({ agent, starters }: ReadyViewProps) {
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

  const pick = useCallback((starter: HomeStarter) => {
    if (starter.needsAttachment) {
      router.push(draftChatWith(agent.id, starter.prompt))
      return
    }
    void send(starter.prompt).catch(() => { /* reported by the toast above */ })
  }, [agent.id, router, send])

  return (
    <div className="flex flex-col gap-bakin-6">
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
function NotReadyView({ state }: { state: Exclude<HomeState, { name: 'ready' }> }) {
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
  if (state.name === 'meet-agent') {
    return (
      <SystemState
        kind="initial-empty"
        scope="page"
        title="Your main agent has no name yet"
        description="Give it a name and a personality on its Team page. A guided introduction is coming to this page."
        action={<Button render={<PluginLink to={`/team/${encodeURIComponent(state.agent.id)}`} />}>Open {state.agent.name}</Button>}
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
        ) : state.name === 'ready' ? (
          <ReadyView agent={state.agent} starters={data.starters} />
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
