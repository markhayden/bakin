/**
 * The Home page.
 *
 * Patterns: `storybook/public/pages/page.stories.tsx` (CanonicalUsage) for
 * the page, `feedback/system-state.stories.tsx` (StateMatrix) for loading,
 * errors and "unavailable", `feedback/handoff-card.stories.tsx` for logging
 * in, the conversation kit's `Composer` for the prompt,
 * `primitives/card.stories.tsx` (InteractiveCard) for starters and the four
 * area cards, `lists/list-rows.stories.tsx` (DenseRows, InteractiveRows)
 * for recent activity and the upgrades, `primitives/shimmer-text.stories.tsx`
 * for the tour offer, and `overlays/dialog.stories.tsx` for the tour
 * (`tour.tsx`). The welcome is `introduction.tsx`.
 *
 * Approved departures from the kit, recorded in `design-system/exceptions.json`:
 * the welcome and the ready Home carry their own heading instead of a
 * `PageHeader`, and the area cards are tinted per area.
 */
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarClock, CheckSquare, ChevronRight, FolderKanban, MessageSquare, Users, type LucideIcon } from 'lucide-react'
import { Composer } from '@makinbakin/sdk/conversation'
import { handoffReturnChannel, toast, useAgentList, useHandoffReturn, useHostStore, usePluginEvent, usePluginJsonFetch, useTerminalHandoff } from '@makinbakin/sdk/hooks'
import { PluginLink, useQueryState, useRouter } from '@makinbakin/sdk/navigation'
import { HandoffCard, ListRow, ListRowActions, ListRows, Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Avatar, AvatarFallback, AvatarImage, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Overline, ShimmerText, SystemState } from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { useHomeActivity } from '../lib/client/activity'
import { draftChatWith, startChat } from '../lib/client/start-chat'
import { AgentFace } from './agent-face'
import { Introduction } from './introduction'
import { Tour, TOUR_PARAM, TOUR_START } from './tour'
import type { HomeLogin, HomeStarter, HomeState, HomeStateResponse, HomeSuggestion } from '../types'

const STATE_TIMEOUT_MS = 15_000
/** How many starters Home offers at once. */
const STARTER_LIMIT = 4

/** `/?introduce=1`: the person asked to go through the introduction (again). */
const INTRODUCE_PARAM = 'introduce'
const INTRODUCE_PATH = `/?${INTRODUCE_PARAM}=1`

/** The page header's title. The welcome and the ready Home carry their own heading and show no header. */
function titleFor(state: HomeState | undefined): string {
  if (state?.name === 'needs-login') return `One step before ${state.agent.name} can answer`
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

  // Always in view, but one quiet panel with the accent rail: offers to grow, never a second row of things to do.
  return (
    <section ref={section} id={DO_MORE_ID} aria-labelledby="home-do-more" className="flex scroll-mt-bakin-4 flex-col gap-bakin-4 pt-bakin-4">
      {/* The same header rhythm as the starters above, so the two read as separate sections. */}
      <h2 id="home-do-more" className="text-center text-bakin-text-muted">
        {suggestions.length === 1 ? "Want more out of your team? Here's an upgrade." : `Want more out of your team? Here are ${suggestions.length} upgrades.`}
      </h2>
      <Card tone="accent">
        <CardContent>
          <ListRows variant="separated" aria-labelledby="home-do-more">
            {suggestions.map((suggestion) => (
              <ListRow key={suggestion.id} className="flex flex-wrap items-center gap-bakin-2" data-suggestion={suggestion.id}>
                <span className="min-w-0 flex-1 basis-80">
                  <span className="font-bakin-typography-weight-semibold">{suggestion.title}.</span>{' '}
                  <span className="text-bakin-text-muted">{suggestion.payoff}</span>
                </span>
                <ListRowActions aria-label={suggestion.title} className="gap-bakin-1">
                  <Button size="xs" variant="ghost" disabled={putting !== null} onClick={() => { void notNow(suggestion) }}>Not now</Button>
                  <Button size="xs" variant="outline" render={<PluginLink to={suggestion.action.href} />}>{suggestion.action.label}</Button>
                </ListRowActions>
              </ListRow>
            ))}
          </ListRows>
        </CardContent>
      </Card>
    </section>
  )
}

/** What an area card says when its page did not answer: never a zero Home does not know to be true. */
const COULD_NOT_TELL = "Couldn't load this right now. Open it to see."

/** The color each area wears on Home: one signal token apiece, so the four doors are told apart at a glance. */
const AREA_COLOR = {
  tasks: 'var(--bakin-color-signal-accent)',
  projects: 'var(--bakin-color-signal-highlight)',
  schedule: 'var(--bakin-color-signal-info)',
  team: 'var(--bakin-color-action-primary-background)',
} as const

interface AreaCardProps {
  to: string
  icon: LucideIcon
  color: string
  title: string
  /** The headline number; null when there is nothing to count (the area is not set up). */
  count: number | null
  /** What the number counts. */
  unit: string
  action: string
  children?: ReactNode
}

/**
 * One area of the app as a door: its name, the one number that sums it up,
 * what is behind it, and the way in. Tinted with the area's color: a wash
 * from the top corner, a matching edge, and its icon large and faint behind.
 */
function AreaCard({ to, icon: Icon, color, title, count, unit, action, children }: AreaCardProps) {
  return (
    <Card
      interactive={{ label: `${title}: ${action}`, render: <PluginLink to={to} /> }}
      data-home-area={title}
      className="relative overflow-hidden"
      style={{
        borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
        backgroundImage: `radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, ${color} 20%, transparent), transparent 70%)`,
      }}
    >
      {/* Placed by style, not class: it must sit behind the content whatever the stylesheet carries. */}
      <Icon aria-hidden="true" style={{ position: 'absolute', insetBlockStart: '1rem', insetInlineEnd: '1rem', inlineSize: '1.5rem', blockSize: '1.5rem', color, opacity: 0.16, pointerEvents: 'none' }} strokeWidth={1.75} />
      <CardHeader>
        <CardTitle className="flex items-center gap-bakin-2">
          <Icon aria-hidden="true" className="size-bakin-4 shrink-0" style={{ color }} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-bakin-4">
        {count !== null ? (
          <p className="flex flex-col">
            <span className="text-[length:var(--bakin-typography-size-page-title)] font-bakin-typography-weight-semibold leading-tight">{count}</span>
            <span className="text-bakin-text-muted">{unit}</span>
          </p>
        ) : null}
        <div className="flex flex-1 flex-col text-bakin-text-muted">{children}</div>
        <span className="flex items-center gap-bakin-1 font-bakin-typography-weight-semibold text-bakin-text-primary">
          {action} <ChevronRight aria-hidden="true" className="size-bakin-4 text-bakin-signal-accent" />
        </span>
      </CardContent>
    </Card>
  )
}

interface ReadyViewProps {
  agent: { id: string; name: string }
  starters: HomeStarter[]
  /** What the person asked to be called, when Bakin knows. */
  person?: string
  suggestions: HomeSuggestion[]
  /** A suggestion was put away: Home should look again. */
  onSuggestionsChanged: () => void
  /** The introduction just finished and nothing has been asked yet. */
  firstDay: boolean
}

/** The first day is over once this is recorded; a failure only means it lasts until the next request. */
async function recordFirstRequest(): Promise<void> {
  try {
    await pluginFetch('home', 'first-request', { method: 'POST' })
  } catch {
    // Nothing is lost: Home is simply still on its first day next time.
  }
}

function ReadyView({ agent, person, starters, suggestions, onSuggestionsChanged, firstDay: firstDayRecorded }: ReadyViewProps) {
  const router = useRouter()
  // What is happening on this home, read on every visit. It also settles the first day: work done
  // anywhere (a chat opened from the sidebar, a task on the board) ends it, not only a request from here.
  const activity = useHomeActivity(true)
  const firstDay = firstDayRecorded && activity?.hasWork !== true
  useEffect(() => {
    if (firstDayRecorded && activity?.hasWork === true) void recordFirstRequest()
  }, [activity?.hasWork, firstDayRecorded])
  const [sending, setSending] = useState(false)
  // A second submit while the first is still creating its chat must not make a second chat.
  const inFlight = useRef(false)

  // Resolves true once the conversation is open; false when nothing was sent. Rejects when it failed.
  const start = useCallback(async (content: string): Promise<boolean> => {
    const text = content.trim()
    if (!text || inFlight.current) return false
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
      // The first thing asked, typed or picked from a card, ends the first day: Home greets a returning person from then on.
      if (firstDay) await recordFirstRequest()
      router.push(`/chat/${encodeURIComponent(result.chatId)}`)
      return true
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }, [agent.id, agent.name, firstDay, router])
  const send = useCallback(async (content: string) => { await start(content) }, [start])

  const pick = useCallback((starter: HomeStarter) => {
    if (starter.needsAttachment) {
      router.push(draftChatWith(agent.id, starter.prompt))
      return
    }
    void start(starter.prompt).then(
      (sent) => {
        // Tried is tried, once it really went: Home stops offering it. Losing the record only means it is offered again.
        if (sent) void pluginFetch('home', `starters/${encodeURIComponent(starter.id)}/used`, { method: 'POST' }).catch(() => undefined)
      },
      () => { /* reported by the toast above; the starter stays on offer */ },
    )
  }, [agent.id, router, start])

  const team = useAgentList()
  const headshot = team.find((member) => member.id === agent.id)?.headshot
  // Once there is work, Home shows what is happening instead of where to start. Until the first
  // read lands nothing below the prompt is drawn, so a returning person never sees the starters flash.
  const working = activity?.hasWork === true
  const settled = activity !== null

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-bakin-8 py-bakin-8" data-home-ready data-first-day={firstDay ? '' : undefined}>
      <div className="flex flex-col items-center gap-bakin-2 text-center">
        {/* The first day is Bakin's welcome, so it wears the pig. After that it is your agent greeting you, in its own face once it has one. */}
        <AgentFace size={7} src={firstDay ? undefined : headshot || undefined} />
        <Overline>{firstDay ? 'Your first day' : 'Home'}</Overline>
        <h1 className="text-balance text-[length:var(--bakin-typography-size-page-title)] font-bakin-typography-weight-semibold leading-tight">
          {firstDay ? "Well, look at that. We're all set." : person ? `Hey ${person}, welcome back.` : 'Hey, welcome back.'}
        </h1>
        <p className="max-w-xl text-balance text-bakin-text-muted">
          {firstDay
            ? "I'm ready when you are. Start with a question, a half-baked idea, or something ridiculously ambitious."
            : 'What are we getting into today?'}
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <Composer
          storageKey="home"
          onSend={send}
          busy={sending}
          inputLabel={`Ask ${agent.name}`}
          placeholder={`Ask ${agent.name} anything…`}
          autoFocus
        />
      </div>

      {working && activity ? (
        <>
          {/* Four doors into the app, each showing what is behind it. */}
          <div className="grid gap-bakin-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14.5rem, 1fr))' }} data-home-areas>
            {activity.tasks === 'unknown' ? (
              <AreaCard to="/tasks" icon={CheckSquare} color={AREA_COLOR.tasks} title="Tasks" action="Open the board" count={null} unit="">
                <p>{COULD_NOT_TELL}</p>
              </AreaCard>
            ) : (
              <AreaCard
                to="/tasks" icon={CheckSquare} color={AREA_COLOR.tasks} title="Tasks" action="Open the board"
                count={activity.tasks.planned + activity.tasks.inProgress + activity.tasks.completed + activity.tasks.blocked} unit="total tasks"
              >
                {/* Four across when the card is wide enough, two by two when it is not: a label never breaks mid-phrase. */}
                <dl className="grid gap-y-bakin-2 text-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(4.75rem, 1fr))' }}>
                  {([['Planned', activity.tasks.planned], ['In progress', activity.tasks.inProgress], ['Completed', activity.tasks.completed], ['Blocked', activity.tasks.blocked]] as const).map(([label, count]) => (
                    <div key={label} className="flex flex-col-reverse">
                      <dt className="whitespace-nowrap text-[length:var(--bakin-typography-size-meta)]">{label}</dt>
                      <dd className={count > 0 ? 'font-bakin-typography-weight-semibold text-bakin-text-primary' : 'font-bakin-typography-weight-semibold'}>{count}</dd>
                    </div>
                  ))}
                </dl>
              </AreaCard>
            )}
            {activity.projects === 'unknown' ? (
              <AreaCard to="/projects" icon={FolderKanban} color={AREA_COLOR.projects} title="Projects" action="Open projects" count={null} unit="">
                <p>{COULD_NOT_TELL}</p>
              </AreaCard>
            ) : activity.projects === null ? (
              <AreaCard to="/explore?tab=plugins&item=plugin:projects" icon={FolderKanban} color={AREA_COLOR.projects} title="Projects" action="Add Projects" count={null} unit="">
                <p>Keep a spec, its checklist and its tasks in one place.</p>
              </AreaCard>
            ) : (
              <AreaCard
                to="/projects" icon={FolderKanban} color={AREA_COLOR.projects} title="Projects" action={activity.projects === 0 ? 'Start a project' : 'Open projects'}
                count={activity.projects} unit={activity.projects === 1 ? 'active project' : 'active projects'}
              >
                {activity.projects === 0 ? <p>None yet. Good for anything bigger than one task.</p> : null}
              </AreaCard>
            )}
            {activity.scheduled === 'unknown' ? (
              <AreaCard to="/schedule" icon={CalendarClock} color={AREA_COLOR.schedule} title="Scheduled tasks" action="Open the schedule" count={null} unit="">
                <p>{COULD_NOT_TELL}</p>
              </AreaCard>
            ) : (
              <AreaCard
                to="/schedule" icon={CalendarClock} color={AREA_COLOR.schedule} title="Scheduled tasks" action="Open the schedule"
                count={activity.scheduled.comingUp} unit="upcoming this week"
              >
                <p>{activity.scheduled.jobs === 0 ? 'Nothing on autopilot yet.' : `${activity.scheduled.jobs} ${activity.scheduled.jobs === 1 ? 'job' : 'jobs'} on autopilot.`}</p>
              </AreaCard>
            )}
            <AreaCard
              to="/team" icon={Users} color={AREA_COLOR.team} title="Team" action={team.length <= 1 ? 'Add a teammate' : 'Meet the team'}
              count={team.length} unit={team.length === 1 ? 'agent on your team' : 'agents on your team'}
            >
              <div className="flex flex-wrap items-center gap-bakin-2" aria-hidden="true">
                {team.slice(0, 6).map((member) => (
                  <Avatar key={member.id} size="md">
                    {member.headshot ? <AvatarImage src={member.headshot} alt="" /> : null}
                    <AvatarFallback>{member.name.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                ))}
              </div>
            </AreaCard>
          </div>

          {activity.pickUp.length > 0 ? (
            <section aria-labelledby="home-pick-up" className="flex flex-col gap-bakin-3">
              <div className="flex items-baseline justify-between gap-bakin-3">
                <h2 id="home-pick-up" className="font-bakin-typography-weight-semibold">Recent activity</h2>
              </div>
              <ListRows variant="bordered" size="sm" aria-labelledby="home-pick-up">
                {activity.pickUp.map((item) => (
                  <ListRow key={item.key} interactive={{ label: item.title, render: <PluginLink to={item.href} /> }} className="flex items-center gap-bakin-3 px-bakin-3" data-home-pick-up={item.kind}>
                    {item.kind === 'chat' ? <MessageSquare aria-hidden="true" className="size-bakin-4 shrink-0 text-bakin-text-muted" /> : <CheckSquare aria-hidden="true" className="size-bakin-4 shrink-0 text-bakin-text-muted" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-semibold">{item.title}</span>
                      <span className="block truncate text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">{item.detail}</span>
                    </span>
                    <ChevronRight aria-hidden="true" className="size-bakin-4 shrink-0 text-bakin-text-muted" />
                  </ListRow>
                ))}
              </ListRows>
            </section>
          ) : null}
        </>
      ) : null}

      {settled && starters.length > 0 ? (
        <section aria-labelledby="home-starters" className="flex flex-col gap-bakin-4">
          <h2 id="home-starters" className="text-center text-bakin-text-muted">
            {working ? "A few things we haven't tried yet." : 'Not sure where to start? Try one of these.'}
          </h2>
          {/* However many are left, they share the row evenly: no empty column where a tried one used to be. */}
          <div className="grid gap-bakin-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
            {starters.slice(0, STARTER_LIMIT).map((starter) => (
              <Card key={starter.id} interactive={{ label: starter.title, onActivate: () => pick(starter) }} data-home-starter={starter.id}>
                <CardHeader>
                  <CardTitle>{starter.title}</CardTitle>
                  <CardDescription>{starter.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
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
  const [tour, setTour] = useQueryState(TOUR_PARAM)
  // Meeting the agent is a moment of its own: the app's chrome waits until it is done.
  // (The host ends this by itself when the page changes.)
  // An error is never shown without the app around it: Health, Settings and the rest stay one click away.
  const welcoming = (state?.name === 'meet-agent' || reopened) && !error
  const setFullscreen = useHostStore((store) => store.setFullscreen)
  useEffect(() => {
    if (!welcoming) return
    setFullscreen(window.location.pathname)
    return () => setFullscreen(null)
  }, [setFullscreen, welcoming])
  const lookAgain = useCallback(() => { void refresh() }, [refresh])
  // Put away in another tab or on another device: this one follows.
  usePluginEvent('home.suggestions_changed', lookAgain)
  // Back from the sign-in (the Terminal route, or their own shell): look again, once.
  useHandoffReturn(HOME_CONSUMER, lookAgain)

  return (
    <Page width={state?.name === 'ready' ? 'full' : 'standard'}>
      {/* The welcome and the ready Home carry their own heading, in the agent's voice; the other states use the page header. */}
      {welcoming || state?.name === 'ready' ? null : <PageHeader title={titleFor(state)} />}
      {/* No widows, ever: text-wrap is inherited, so every line of copy on Home balances. */}
      <PageBody label="Home" className="text-balance">
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
          <ReadyView agent={state.agent} person={data.person} starters={data.starters} suggestions={data.suggestions} onSuggestionsChanged={lookAgain} firstDay={data.firstDay} />
        ) : state.name === 'needs-login' ? (
          <LoginView agent={state.agent} login={data.login} starters={data.starters} onCheck={lookAgain} checking={loading} />
        ) : (
          <UnavailableView state={state} />
        )}
        {state && !reopened && (state.name === 'ready' || state.name === 'needs-login') ? (
          <p className={state.name === 'ready' ? 'text-center text-bakin-text-muted' : 'text-bakin-text-muted'}>
            {/* A pink sweep across the whole offer, so it is noticed without being a button. */}
            <PluginLink to={`/?${TOUR_PARAM}=${TOUR_START}`}>
              <ShimmerText highlight="accent" base="primary">New to Bakin? Take a two-minute tour of what is where.</ShimmerText>
            </PluginLink>
          </p>
        ) : null}
        <Tour slideId={tour ?? ''} onSlide={setTour} />
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
