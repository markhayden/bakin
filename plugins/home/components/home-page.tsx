/**
 * The Home page.
 *
 * Patterns: `storybook/public/pages/page.stories.tsx` (CanonicalUsage,
 * StandardWidth), `feedback/system-state.stories.tsx` (StateMatrix) for
 * every non-ready state, `lists/list-rows.stories.tsx` (InteractiveRows)
 * for starters, `feedback/alert.stories.tsx` (action) for the first hello,
 * `feedback/handoff-card.stories.tsx` for logging in,
 * `lists/list-rows.stories.tsx` (DenseRows: a row with its trailing
 * `ListRowActions`) for "Do more with Bakin",
 * and the conversation kit's `Composer` for the prompt. The
 * introduction is `introduction.tsx`.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Composer } from '@makinbakin/sdk/conversation'
import { handoffReturnChannel, toast, useHandoffReturn, usePluginEvent, usePluginJsonFetch, useTerminalHandoff } from '@makinbakin/sdk/hooks'
import { PluginLink, useQueryState, useRouter } from '@makinbakin/sdk/navigation'
import { HandoffCard, ListRow, ListRowActions, ListRows, Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Alert, AlertAction, AlertDescription, AlertTitle, Button, SystemState } from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { draftChatWith, startChat } from '../lib/client/start-chat'
import { Introduction } from './introduction'
import type { HomeLogin, HomeStarter, HomeState, HomeStateResponse, HomeSuggestion } from '../types'

const STATE_TIMEOUT_MS = 15_000
/** How many starters Home offers at once. */
const STARTER_LIMIT = 6

/** `/?introduce=1`: the person asked to go through the introduction (again). */
const INTRODUCE_PARAM = 'introduce'
const INTRODUCE_PATH = `/?${INTRODUCE_PARAM}=1`

function titleFor(state: HomeState | undefined, introducing: boolean): string {
  if (state?.name === 'meet-agent' || introducing) return 'Meet your main agent'
  if (state?.name === 'needs-login') return `One step before ${state.agent.name} can answer`
  if (state?.name === 'ready') return 'What do you want to do?'
  return 'Home'
}

/** Where the sidebar's count links: `/#do-more`. */
const DO_MORE_ID = 'do-more'

interface SuggestionsProps {
  suggestions: HomeSuggestion[]
  /** One was put away: Home should look again. */
  onChanged: () => void
}

/** "Do more with Bakin": what this home could add, each with the one step that adds it. */
function Suggestions({ suggestions, onChanged }: SuggestionsProps) {
  const [putting, setPutting] = useState<string | null>(null)
  const section = useRef<HTMLElement>(null)

  // Arriving from the sidebar's count: the section loads after the page does.
  useEffect(() => {
    if (window.location.hash === `#${DO_MORE_ID}`) section.current?.scrollIntoView({ block: 'start' })
  }, [])

  const notNow = useCallback(async (suggestion: HomeSuggestion) => {
    setPutting(suggestion.id)
    try {
      const res = await pluginFetch('home', `suggestions/${encodeURIComponent(suggestion.id)}/dismiss`, { method: 'POST' })
      if (!res.ok) throw new Error(`dismiss answered ${res.status}`)
      onChanged()
    } catch {
      toast("That couldn't be put away. Try again.", 'error')
    } finally {
      setPutting(null)
    }
  }, [onChanged])

  return (
    <section ref={section} id={DO_MORE_ID} aria-labelledby="home-do-more" className="flex scroll-mt-bakin-4 flex-col gap-bakin-3">
      <h2 id="home-do-more" className="text-bakin-text-muted">Do more with Bakin</h2>
      <ListRows variant="bordered" aria-labelledby="home-do-more">
        {suggestions.map((suggestion) => (
          <ListRow key={suggestion.id} className="flex flex-wrap items-center gap-bakin-2" data-suggestion={suggestion.id}>
            <span className="min-w-0 flex-1 basis-80">
              <span className="block font-bakin-typography-weight-semibold">{suggestion.title}</span>
              <span className="block text-bakin-text-muted">{suggestion.payoff}</span>
            </span>
            <ListRowActions aria-label={suggestion.title} className="gap-bakin-1">
              <Button size="xs" variant="ghost" disabled={putting !== null} onClick={() => { void notNow(suggestion) }}>Not now</Button>
              <Button size="xs" variant="outline" render={<PluginLink to={suggestion.action.href} />}>{suggestion.action.label}</Button>
            </ListRowActions>
          </ListRow>
        ))}
      </ListRows>
    </section>
  )
}

interface ReadyViewProps {
  agent: { id: string; name: string }
  starters: HomeStarter[]
  suggestions: HomeSuggestion[]
  /** A suggestion was put away: Home should look again. */
  onSuggestionsChanged: () => void
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

function ReadyView({ agent, starters, suggestions, onSuggestionsChanged, hello, onHelloSettled }: ReadyViewProps) {
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
      {suggestions.length > 0 ? <Suggestions suggestions={suggestions} onChanged={onSuggestionsChanged} /> : null}
    </div>
  )
}

/** Home cannot work right now: say what is true and where it is fixed. */
function UnavailableView({ state }: { state: Extract<HomeState, { name: 'unavailable' }> }) {
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

/** Home's own handoff channel: coming back from the sign-in makes Home look again. */
const HOME_CONSUMER = 'home'
const LOGIN_HANDOFF = 'login'

/** A runtime's step, with anything in backticks shown as something to type. */
function StepText({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) => (
        // The parts of one fixed sentence never reorder.
        index % 2 === 1 ? <code key={index} className="font-bakin-typography-family-mono">{part}</code> : <span key={index}>{part}</span>
      ))}
    </>
  )
}

interface LoginViewProps {
  agent: { id: string; name: string }
  login: HomeLogin | undefined
  starters: HomeStarter[]
  /** Look at the machine again: the person says they are logged in, or came back from doing it. */
  onCheck: () => void
  checking: boolean
}

/**
 * No provider is logged in. Bakin never handles the secret: it shows the
 * runtime's own steps, hands over the command (typed into a Terminal
 * session where one is installed, copyable everywhere), and looks again
 * when the person comes back.
 */
function LoginView({ agent, login, starters, onCheck, checking }: LoginViewProps) {
  const terminal = useTerminalHandoff(Boolean(login?.command))
  const channel = handoffReturnChannel(HOME_CONSUMER)

  const openTerminal = useCallback(async () => {
    if (!login?.command) return
    channel.arm(LOGIN_HANDOFF)
    const sessionId = await terminal.open(login.command, `Log in to ${login.runtime}`)
    if (!sessionId) channel.disarm(LOGIN_HANDOFF)
  }, [channel, login, terminal])

  return (
    <div className="flex flex-col gap-bakin-6" data-home-login>
      <p className="text-bakin-text-muted">
        {agent.name} needs an AI provider to think with, and none is logged in yet. You log in yourself{login ? `, in ${login.runtime}` : ''}; Bakin never sees your password or key.
      </p>
      {login ? (
        // Numbered by hand: the canonical stylesheet carries no list-marker utility.
        <ol className="flex flex-col gap-bakin-2">
          {login.steps.map((step, index) => (
            <li key={step} className="flex gap-bakin-2">
              <span aria-hidden="true" className="shrink-0 text-bakin-text-muted">{index + 1}.</span>
              <span className="min-w-0"><StepText text={step} /></span>
            </li>
          ))}
        </ol>
      ) : null}
      {login?.command ? (
        <HandoffCard
          title="Start the sign-in"
          description={terminal.available
            ? 'Open in Terminal types the command for you. Press Enter to run it, follow the steps above, then come back here.'
            : 'Run this in a terminal on the machine Bakin runs on, follow the steps above, then come back here.'}
          command={login.command}
          onCopied={() => channel.arm(LOGIN_HANDOFF)}
          onOpenTerminal={terminal.available ? () => { void openTerminal() } : undefined}
          busy={terminal.busy}
          error={terminal.error ?? undefined}
          headingLevel={2}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-bakin-3">
        <Button onClick={onCheck} disabled={checking}>{checking ? 'Checking…' : "I've logged in. Check again"}</Button>
        {login ? <a href={login.docsUrl} target="_blank" rel="noreferrer" className="underline">{login.runtime} docs</a> : null}
      </div>
      {starters.length > 0 ? (
        <section aria-labelledby="home-locked-starters" className="flex flex-col gap-bakin-3">
          <h2 id="home-locked-starters" className="text-bakin-text-muted">Then you can ask {agent.name} for things like</h2>
          <ListRows variant="bordered" aria-labelledby="home-locked-starters">
            {starters.slice(0, STARTER_LIMIT).map((starter) => (
              <ListRow key={starter.id}>
                <span className="block font-bakin-typography-weight-semibold text-bakin-text-muted">{starter.title}</span>
                <span className="block text-bakin-text-muted">{starter.description}</span>
              </ListRow>
            ))}
          </ListRows>
        </section>
      ) : null}
    </div>
  )
}

function HomePageInner() {
  const { data, loading, error, refresh } = usePluginJsonFetch<HomeStateResponse>('home', 'state', { timeoutMs: STATE_TIMEOUT_MS })
  const state = data?.state
  const [introduce, setIntroduce] = useQueryState(INTRODUCE_PARAM)
  // Reopening needs an agent to introduce; a home that cannot read its roster shows that instead.
  const reopened = introduce === '1' && state !== undefined && state.name !== 'unavailable' && state.name !== 'meet-agent'
  const closeIntroduction = useCallback(() => { setIntroduce('') }, [setIntroduce])
  const lookAgain = useCallback(() => { void refresh() }, [refresh])
  // Put away in another tab or on another device: this one follows.
  usePluginEvent('home.suggestions_changed', lookAgain)
  // Back from the sign-in (the Terminal route, or their own shell): look again, once.
  useHandoffReturn(HOME_CONSUMER, lookAgain)

  return (
    <Page width="standard">
      <PageHeader title={titleFor(state, reopened)} />
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
        ) : reopened ? (
          <Introduction
            agent={state.agent}
            personalities={data.personalities}
            again={{ onCancel: closeIntroduction }}
            onFinished={() => { closeIntroduction(); void refresh() }}
          />
        ) : state.name === 'meet-agent' ? (
          <Introduction agent={state.agent} personalities={data.personalities} resume={state.resume} onFinished={() => { void refresh() }} />
        ) : state.name === 'ready' ? (
          <ReadyView agent={state.agent} starters={data.starters} suggestions={data.suggestions} onSuggestionsChanged={lookAgain} hello={data.hello} onHelloSettled={() => { void refresh() }} />
        ) : state.name === 'needs-login' ? (
          <LoginView agent={state.agent} login={data.login} starters={data.starters} onCheck={lookAgain} checking={loading} />
        ) : (
          <UnavailableView state={state} />
        )}
        {data?.introductionSkipped && state && !reopened && (state.name === 'ready' || state.name === 'needs-login') ? (
          <p className="text-bakin-text-muted">
            You skipped the introduction. <PluginLink to={INTRODUCE_PATH}>Meet {state.agent.name}</PluginLink> whenever you like.
          </p>
        ) : null}
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
