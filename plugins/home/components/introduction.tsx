/**
 * Meet your main agent: three questions, laid out as a conversation.
 *
 * The questions are a data script driven by Bakin, with no model involved,
 * so this works before any provider login and behaves the same every time.
 * It is drawn with the conversation kit's own turns so a real agent turn
 * can replace the script later without changing the screen (spec D5a).
 *
 * Patterns: `conversation/turns.stories.tsx` (CanonicalUsage) for the
 * exchange, `forms/form-composition.stories.tsx` (CanonicalUsage) for the
 * answer, `primitives/radio-group.stories.tsx` for the personality choice,
 * `feedback/alert.stories.tsx` for a failed save.
 */
import { useCallback, useState } from 'react'
import { AgentTurn, UserMessage, type ConversationTurn } from '@makinbakin/sdk/conversation'
import {
  Alert, AlertDescription, AlertTitle, Button, Field, FieldControl, FieldDescription, FieldLabel, Form, FormActions, Input, Radio, RadioGroup, SubmitButton, Textarea,
} from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'
import type { HomePersonality, IntroductionAnswers, IntroductionResult, IntroductionStep } from '../types'

type StepId = 'name' | 'personality' | 'you'
const STEPS: readonly StepId[] = ['name', 'personality', 'you']
/** The choice that means "I'll describe it myself". */
const OWN_WORDS = '__own__'

/** What the agent asks at each step. The name asked for earlier is used once it is known. */
function questionFor(step: StepId, agentName: string): string {
  if (step === 'name') return "Hi. I don't have a name yet. What would you like to call me?"
  if (step === 'personality') return `${agentName}. I like it. How should I come across?`
  return 'Got it. And what should I call you?'
}

interface Draft {
  agentName: string
  /** A preset id, or OWN_WORDS. */
  personality: string
  ownWords: string
  userName: string
}

function draftFrom(resume: IntroductionAnswers | undefined, personalities: readonly HomePersonality[]): Draft {
  return {
    agentName: resume?.agentName ?? '',
    personality: resume ? (resume.personality.kind === 'preset' ? resume.personality.id : OWN_WORDS) : (personalities[0]?.id ?? OWN_WORDS),
    ownWords: resume?.personality.kind === 'custom' ? resume.personality.description : '',
    userName: resume?.userName ?? '',
  }
}

function answersFrom(draft: Draft): IntroductionAnswers {
  return {
    agentName: draft.agentName.trim(),
    personality: draft.personality === OWN_WORDS
      ? { kind: 'custom', description: draft.ownWords.trim() }
      : { kind: 'preset', id: draft.personality },
    userName: draft.userName.trim(),
  }
}

/** What the person answered at a finished step, as they would have said it. */
function answerText(step: StepId, draft: Draft, personalities: readonly HomePersonality[]): string {
  if (step === 'name') return draft.agentName.trim()
  if (step === 'you') return draft.userName.trim()
  if (draft.personality === OWN_WORDS) return draft.ownWords.trim()
  return personalities.find((preset) => preset.id === draft.personality)?.label ?? draft.personality
}

function stepIsAnswered(step: StepId, draft: Draft): boolean {
  if (step === 'name') return draft.agentName.trim().length > 0
  if (step === 'you') return draft.userName.trim().length > 0
  return draft.personality !== OWN_WORDS || draft.ownWords.trim().length > 0
}

const SAVE_FAILED: Record<IntroductionStep, string> = {
  identity: "The agent's name and personality could not be saved.",
  person: 'Your name could not be saved.',
  sync: 'Everything was saved, but your agents have not been told yet.',
}

export interface IntroductionProps {
  agent: { id: string; name: string }
  personalities: readonly HomePersonality[]
  /** Answers given earlier that were not all saved: finish from here. */
  resume?: IntroductionAnswers
  /** The introduction is done, or skipped: Home should look again. */
  onFinished: () => void
}

export function Introduction({ agent, personalities, resume, onFinished }: IntroductionProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(resume, personalities))
  // Resuming lands on the last step, with every earlier answer shown.
  const [stepIndex, setStepIndex] = useState(resume ? STEPS.length - 1 : 0)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(
    resume ? "Your answers were saved, but setup didn't finish. Check them and finish again." : null,
  )
  const step = STEPS[stepIndex]!
  const shownName = draft.agentName.trim() || agent.name
  const speaker = { id: agent.id, name: stepIndex === 0 ? 'Your main agent' : shownName }

  const finish = useCallback(async () => {
    setSaving(true)
    setFailure(null)
    try {
      const res = await pluginFetch('home', 'introduction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answersFrom(draft)),
      })
      const body = await res.json().catch(() => null) as IntroductionResult | { ok: false; error: string } | null
      if (res.ok && body?.ok) {
        onFinished()
        return
      }
      setFailure(body && !body.ok && 'step' in body ? `${SAVE_FAILED[body.step]} Try again; nothing you entered is lost.` : "Setup didn't finish. Try again; nothing you entered is lost.")
    } catch {
      setFailure("Bakin couldn't be reached. Try again; nothing you entered is lost.")
    } finally {
      setSaving(false)
    }
  }, [draft, onFinished])

  const next = useCallback(() => {
    if (!stepIsAnswered(step, draft)) return
    if (stepIndex < STEPS.length - 1) setStepIndex(stepIndex + 1)
    else void finish()
  }, [draft, finish, step, stepIndex])

  const skip = useCallback(async () => {
    setSaving(true)
    setFailure(null)
    try {
      const res = await pluginFetch('home', 'introduction/skip', { method: 'POST' })
      if (!res.ok) throw new Error(`skip answered ${res.status}`)
      onFinished()
    } catch {
      setFailure("Skipping couldn't be saved. Try again.")
    } finally {
      setSaving(false)
    }
  }, [onFinished])

  const turn = (id: StepId): Extract<ConversationTurn, { kind: 'agent' }> => ({
    kind: 'agent',
    key: `intro-${id}`,
    status: 'complete',
    // 'markdown' is the kit's prose format; 'plain' is drawn as a code block.
    items: [{ type: 'text', format: 'markdown', content: questionFor(id, shownName) }],
  })

  return (
    <div className="flex flex-col gap-bakin-4" data-home-introduction data-step={step}>
      {STEPS.slice(0, stepIndex).map((done) => (
        <div key={done} className="flex flex-col gap-bakin-4">
          <AgentTurn turn={turn(done)} agent={speaker} />
          <UserMessage turn={{ kind: 'user', key: `intro-${done}-answer`, ts: '', content: answerText(done, draft, personalities) }} />
        </div>
      ))}
      <AgentTurn turn={turn(step)} agent={speaker} />

      {failure ? (
        <Alert tone="danger">
          <AlertTitle>Setup didn't finish</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}

      <Form aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`} busy={saving} onFormSubmit={next}>
        {step === 'name' ? (
          <Field name="agentName">
            <FieldLabel requirement="required">Your agent's name</FieldLabel>
            <FieldDescription>You can change it later on the Team page.</FieldDescription>
            <Input required autoFocus maxLength={40} value={draft.agentName} onChange={(event) => setDraft({ ...draft, agentName: event.target.value })} />
          </Field>
        ) : null}

        {step === 'personality' ? (
          <>
            <RadioGroup aria-label="How your agent comes across" value={draft.personality} onValueChange={(value) => setDraft({ ...draft, personality: String(value) })}>
              {personalities.map((preset) => (
                <label key={preset.id} className="flex items-start gap-bakin-2 text-[length:var(--bakin-typography-size-body)]">
                  <Radio value={preset.id} />
                  <span className="min-w-0">
                    <span className="block font-bakin-typography-weight-semibold">{preset.label}</span>
                    <span className="block text-bakin-text-muted">"{preset.sample}"</span>
                  </span>
                </label>
              ))}
              <label className="flex items-start gap-bakin-2 text-[length:var(--bakin-typography-size-body)]">
                <Radio value={OWN_WORDS} />
                <span className="block font-bakin-typography-weight-semibold">Describe it yourself</span>
              </label>
            </RadioGroup>
            {draft.personality === OWN_WORDS ? (
              <Field name="ownWords">
                <FieldLabel requirement="required">In your own words</FieldLabel>
                <FieldDescription>For example: like a patient senior engineer who explains things without talking down to me.</FieldDescription>
                <FieldControl render={<Textarea required maxLength={600} value={draft.ownWords} onChange={(event) => setDraft({ ...draft, ownWords: event.target.value })} />} />
              </Field>
            ) : null}
          </>
        ) : null}

        {step === 'you' ? (
          <Field name="userName">
            <FieldLabel requirement="required">Your name</FieldLabel>
            <FieldDescription>Every agent on your team will know it.</FieldDescription>
            <Input required autoFocus maxLength={60} value={draft.userName} onChange={(event) => setDraft({ ...draft, userName: event.target.value })} />
          </Field>
        ) : null}

        <FormActions align="between">
          <Button type="button" variant="ghost" disabled={saving} onClick={() => { void skip() }}>Skip for now</Button>
          {stepIndex > 0 ? <Button type="button" variant="outline" disabled={saving} onClick={() => setStepIndex(stepIndex - 1)}>Back</Button> : null}
          <SubmitButton busyLabel="Saving…">{stepIndex < STEPS.length - 1 ? 'Continue' : 'Finish'}</SubmitButton>
        </FormActions>
      </Form>
    </div>
  )
}
