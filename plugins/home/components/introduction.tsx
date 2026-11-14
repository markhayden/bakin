/**
 * Meet your main agent: a welcome, three questions, one at a time.
 *
 * This is the first thing a new person does in Bakin, so it is staged as
 * meeting someone, not filling in settings: the agent's face is the
 * centerpiece, and a preview of the agent answers every choice as it is
 * made (its name, then its voice, then who it works with). The questions
 * are scripted by Bakin, with no model involved, so this works before any
 * provider login and behaves the same every time.
 *
 * Patterns: `primitives/card.stories.tsx` (CanonicalUsage for the preview;
 * InteractiveCard and SelectedAndTone for the personality choices),
 * `primitives/input.stories.tsx` (SizesAndVariants), `primitives/text.stories.tsx`
 * (OverlineLabels), `primitives/badge.stories.tsx`, `primitives/avatar.stories.tsx`,
 * `feedback/alert.stories.tsx` for a failed save. The agent's face is the
 * host's `/bakin-agent.png`.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import {
  Alert, AlertAction, AlertDescription, AlertTitle, Button, Card, CardHeader, CardTitle, Form, Input, Overline, Separator, SubmitButton, Text, Textarea,
} from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { AgentFace } from './agent-face'
import type { HomePersonality, IntroductionAnswers, IntroductionResult, IntroductionStep } from '../types'

type StepId = 'name' | 'personality' | 'you'
const STEPS: readonly StepId[] = ['name', 'personality', 'you']
/** The choice that means "I'll describe it myself". */
const OWN_WORDS = '__own__'

interface StepCopy {
  /** Shown top right: where the person is. */
  stage: string
  headline: string
  lead: string
  /** The one question this step asks. */
  question: string
}

function copyFor(step: StepId, agentName: string, again: boolean): StepCopy {
  // The agent speaks for itself: it is the one being met.
  if (step === 'name') {
    return {
      stage: 'Your agent',
      headline: again ? 'Back for a rethink?' : "Oh good, you're here.",
      lead: again
        ? 'Change my name, my voice or what I call you.'
        : "We've got a bit of a naming situation, though. I don't have one.",
      question: again ? 'What would you like to call me now?' : 'What would you like to call me?',
    }
  }
  if (step === 'personality') {
    return {
      stage: 'My voice',
      headline: `${agentName}. I like it.`,
      lead: `Now, what kind of ${agentName} are we talking about? Charming? Brutally efficient? A little sarcastic? Pick a personality that feels right, or tell me in your own words. No pressure, it's only my entire personality we're deciding here.`,
      question: 'How should I come across?',
    }
  }
  return {
    stage: 'You',
    headline: 'One last thing.',
    lead: "So I've got a name now, which is great. Slightly awkward that I still don't know yours.",
    question: 'What should I call you?',
  }
}

interface Draft {
  agentName: string
  /** A preset id, or OWN_WORDS. */
  personality: string
  ownWords: string
  userName: string
  /** The card last picked: clearing your own words goes back to it. */
  lastPreset: string
}

function draftFrom(resume: IntroductionAnswers | undefined, personalities: readonly HomePersonality[], currentName: string): Draft {
  return {
    agentName: resume?.agentName ?? currentName,
    personality: resume ? (resume.personality.kind === 'preset' ? resume.personality.id : OWN_WORDS) : (personalities[0]?.id ?? OWN_WORDS),
    ownWords: resume?.personality.kind === 'custom' ? resume.personality.description : '',
    userName: resume?.userName ?? '',
    lastPreset: resume?.personality.kind === 'preset' ? resume.personality.id : (personalities[0]?.id ?? OWN_WORDS),
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
  /**
   * The introduction was reopened by the person: the agent already has the
   * name it goes by, and leaving is a plain cancel that records nothing.
   */
  again?: { onCancel: () => void }
  /** The introduction is done, or skipped: Home should look again. */
  onFinished: () => void
}

export function Introduction({ agent, personalities, resume, again, onFinished }: IntroductionProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(resume, personalities, again ? agent.name : ''))
  // Resuming lands on the last step, with every earlier answer kept.
  const [stepIndex, setStepIndex] = useState(resume ? STEPS.length - 1 : 0)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(
    resume ? "Your answers were saved, but setup didn't finish. Check them and finish again." : null,
  )
  const questionId = useId()
  const saved = useRef(false)
  const headline = useRef<HTMLHeadingElement>(null)
  const firstStep = useRef(true)
  const step = STEPS[stepIndex]!
  const typedName = draft.agentName.trim()
  const shownName = typedName || 'your agent'
  const copy = copyFor(step, shownName, again !== undefined)

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
        // Stays busy: Home is about to look again and replace this screen, and a second press must not save twice.
        saved.current = true
        onFinished()
        return
      }
      setFailure(body && !body.ok && 'step' in body ? `${SAVE_FAILED[body.step]} Try again; nothing you entered is lost.` : "Setup didn't finish. Try again; nothing you entered is lost.")
    } catch {
      setFailure("Bakin couldn't be reached. Try again; nothing you entered is lost.")
    } finally {
      if (!saved.current) setSaving(false)
    }
  }, [draft, onFinished])

  // Picking a card replaces any words of your own: one or the other, never a choice the screen hides.
  const choose = useCallback((presetId: string) => {
    setDraft((current) => ({ ...current, personality: presetId, lastPreset: presetId, ownWords: '' }))
  }, [])

  const moveChoice = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (step === 0 || personalities.length === 0) return
    event.preventDefault()
    const at = personalities.findIndex((preset) => preset.id === draft.personality)
    const nextPreset = personalities[(Math.max(at, 0) + step + personalities.length) % personalities.length]!
    choose(nextPreset.id)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-preset="${nextPreset.id}"]`)?.focus()
  }, [choose, draft.personality, personalities])

  // A new step is a new question: on the step with no field to type in, the heading takes focus so a
  // screen reader reads the question; the others' fields take it themselves.
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return }
    if (step === 'personality') headline.current?.focus()
  }, [step])

  const next = useCallback(() => {
    if (!stepIsAnswered(step, draft)) return
    if (stepIndex < STEPS.length - 1) setStepIndex(stepIndex + 1)
    else void finish()
  }, [draft, finish, step, stepIndex])

  const skip = useCallback(async () => {
    setSaving(true)
    try {
      const res = await pluginFetch('home', 'introduction/skip', { method: 'POST' })
      if (!res.ok) throw new Error(`skip answered ${res.status}`)
      onFinished()
    } catch {
      setFailure("Skipping couldn't be saved either. Bakin may be unreachable; try again in a moment.")
    } finally {
      setSaving(false)
    }
  }, [onFinished])

  const named = typedName.length > 0
  const submitLabel = step === 'name'
    ? (named ? `Call me ${typedName}` : 'Give me a name')
    : step === 'personality' ? "That's me" : "Let's get to work"
  const footnote = step === 'name'
    ? 'You can always change my name later.'
    : step === 'personality' ? 'You can change my voice later on the Team page.' : null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-bakin-8 py-bakin-6" data-home-introduction data-step={step}>
      <div className="flex flex-col gap-bakin-4">
        <div className="flex items-center justify-between gap-bakin-4">
          <Overline>Bakin / {again ? 'Your agent' : 'Getting started'}</Overline>
          <Overline aria-live="polite">Step 0{stepIndex + 1} · {copy.stage}</Overline>
        </div>
        <Separator />
      </div>

      <div className="flex flex-col items-center gap-bakin-2 pt-bakin-4 text-center">
        <AgentFace />
        <h1 ref={headline} tabIndex={-1} className="text-balance outline-none text-[length:var(--bakin-typography-size-page-title)] font-bakin-typography-weight-semibold leading-tight">
          {copy.headline}
        </h1>
        <p className="max-w-xl text-balance text-bakin-text-muted">{copy.lead}</p>
      </div>

      {failure ? (
        <Alert tone="danger">
          <AlertTitle>Setup didn't finish</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
          {/* The only way past the welcome without finishing it, and only when finishing is what failed:
              nobody is left stuck on a screen with no app around it. */}
          {again ? null : (
            <AlertAction>
              <Button type="button" size="xs" variant="outline" disabled={saving} onClick={() => { void skip() }}>Skip for now</Button>
            </AlertAction>
          )}
        </Alert>
      ) : null}

      <Form aria-labelledby={questionId} busy={saving} onFormSubmit={next} className="flex flex-col gap-bakin-6">
        <div className="flex flex-col gap-bakin-3">
          <h2 id={questionId} className="font-bakin-typography-weight-semibold">{copy.question}</h2>

          {step === 'name' ? (
            <>
              <Input
                size="lg"
                required
                autoFocus
                maxLength={40}
                aria-labelledby={questionId}
                placeholder="Give me a name…"
                value={draft.agentName}
                onChange={(event) => setDraft({ ...draft, agentName: event.target.value })}
              />
            </>
          ) : null}

          {step === 'personality' ? (
            <>
              {/* One choice of several: a radio group, one tab stop, arrow keys move the choice. */}
              <div className="grid gap-bakin-3 sm:grid-cols-2" role="radiogroup" aria-labelledby={questionId} onKeyDown={moveChoice}>
                {personalities.map((preset) => {
                  const chosen = draft.personality === preset.id
                  const focusable = chosen || (draft.personality === OWN_WORDS && preset.id === personalities[0]?.id)
                  return (
                    <Card
                      key={preset.id}
                      selected={chosen}
                      interactive={{
                        label: preset.label,
                        render: <button type="button" role="radio" aria-checked={chosen} tabIndex={focusable ? 0 : -1} data-preset={preset.id} onClick={() => choose(preset.id)} />,
                      }}
                    >
                      <CardHeader>
                        <CardTitle>{preset.label}</CardTitle>
                      </CardHeader>
                    </Card>
                  )
                })}
              </div>
              {/* Typing here is the choice: no card to press first. Emptying it goes back to a preset. */}
              <Textarea
                maxLength={600}
                aria-label="Or describe my personality in your own words"
                placeholder="Or tell me in your own words…"
                value={draft.ownWords}
                onChange={(event) => {
                  const ownWords = event.target.value
                  setDraft({ ...draft, ownWords, personality: ownWords.trim() ? OWN_WORDS : draft.lastPreset })
                }}
              />
            </>
          ) : null}

          {step === 'you' ? (
            <Input
              size="lg"
              required
              autoFocus
              maxLength={60}
              aria-labelledby={questionId}
              placeholder="Your name…"
              value={draft.userName}
              onChange={(event) => setDraft({ ...draft, userName: event.target.value })}
            />
          ) : null}
        </div>

        <div className="flex flex-col items-center gap-bakin-3">
          <SubmitButton size="lg" className="w-full" busyLabel="Saving…">{submitLabel} <ArrowRight aria-hidden="true" /></SubmitButton>
          {footnote ? <Text size="meta" tone="muted" as="p">{footnote}</Text> : null}
          <div className="flex items-center justify-center gap-bakin-2">
            {stepIndex > 0 ? <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setStepIndex(stepIndex - 1)}>Back</Button> : null}
            {again ? <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={again.onCancel}>Cancel</Button> : null}
          </div>
        </div>
      </Form>
    </div>
  )
}
