import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { Radio, RadioGroup } from '../primitives/radio-group'
import { cn } from '../utils'
import { formatQuestionAnswer, type QuestionAnswer, type TurnItem } from './fold'

type QuestionItem = Extract<TurnItem, { type: 'question' }>

const UNSURE = 'unsure'

export interface QuestionCardProps {
  item: QuestionItem
  /** Sends the formatted answer; absent (or not answerable) renders read-only. */
  onAnswer?: (text: string) => void
  /** The turn is still streaming — show the card but hold input. */
  busy?: boolean
}

const optionRow = cn(
  'flex min-w-0 cursor-pointer items-start gap-bakin-3 rounded-bakin-control border border-bakin-border-subtle px-bakin-3 py-bakin-2',
  'has-[[data-checked]]:border-bakin-action-primary-background',
  'has-[[data-disabled]]:cursor-not-allowed',
)
const meta = 'text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted'

/**
 * One structured question an agent asked. Open cards offer the agent's
 * options (its recommendation labelled, never preselected), "Not sure", and
 * ONE text field — the user's own answer when nothing is picked (if the
 * agent allows one), a note on the choice otherwise; settled cards collapse
 * to the answer the transcript recorded.
 */
export function QuestionCard({ item, onAnswer, busy = false }: QuestionCardProps) {
  const { question } = item

  if (item.state !== 'open') {
    return (
      <div
        data-conv-question=""
        data-state={item.state}
        className="min-w-0 break-words rounded-bakin-control border border-bakin-border-subtle px-bakin-3 py-bakin-2"
      >
        <span className="font-bakin-typography-weight-medium">{question.question}</span>
        <span className={cn(meta, 'ml-bakin-2')}>
          {item.state === 'answered' ? `→ ${item.answer ?? ''}` : 'Skipped'}
        </span>
      </div>
    )
  }

  return <OpenQuestionCard item={item} onAnswer={item.answerable ? onAnswer : undefined} busy={busy} />
}

function OpenQuestionCard({ item, onAnswer, busy }: QuestionCardProps) {
  const { question } = item
  const id = useId()
  const [choice, setChoice] = useState<string | null>(null)
  const [text, setText] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const interactive = Boolean(onAnswer) && !busy
  const trimmed = text.trim()

  // One field. With a choice picked it travels as the note; with nothing
  // picked it IS the answer (when the agent allows one).
  const answer: QuestionAnswer | null = choice === null
    ? (question.allowOther && trimmed ? { kind: 'other', text: trimmed } : null)
    : choice === UNSURE ? { kind: 'unsure' }
      : { kind: 'option', index: Number(choice) }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!interactive || !answer) return
    onAnswer!(formatQuestionAnswer(question, answer, answer.kind === 'other' ? undefined : text))
  }

  // Arrows select, Enter submits (D3). Base UI radios swallow Enter's
  // default — a radio activates only with Space — so implicit form
  // submission never fires from the group; the text field submits through
  // the same explicit path so one Enter is exactly one submission whatever
  // other buttons the form holds. Both go through the same guard.
  const submitOnEnter = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    const target = event.target as HTMLElement
    if (target.getAttribute('role') !== 'radio' && target !== field.current) return
    event.preventDefault()
    event.currentTarget.requestSubmit()
  }

  // The button unmounts on clear; hand focus to the field so a keyboard
  // user keeps typing their own answer.
  const clearChoice = () => {
    setChoice(null)
    field.current?.focus()
  }

  const fieldLabel = question.allowOther
    ? 'Write your own answer, or add a note to your choice'
    : 'Add a note to your choice (optional)'

  return (
    <form
      data-conv-question=""
      data-state="open"
      // Unnamed on purpose: a named form is a landmark, and a transcript of
      // cards would fill the page with duplicates. The radiogroup carries the name.
      onSubmit={submit}
      onKeyDown={submitOnEnter}
      className="@container/question grid min-w-0 gap-bakin-3 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-4"
    >
      <p id={`${id}-question`} className="min-w-0 break-words font-bakin-typography-weight-medium">
        {question.question}
      </p>
      <RadioGroup
        aria-labelledby={`${id}-question`}
        value={choice}
        onValueChange={(value: string) => setChoice(value)}
        disabled={!interactive}
      >
        {question.options.map((option, index) => (
          <label key={option.label} className={optionRow}>
            <Radio value={String(index)} />
            <span className="grid min-w-0 gap-bakin-1">
              <span className="flex min-w-0 flex-wrap items-center gap-bakin-2 break-words">
                {option.label}
                {question.recommended === index ? <Badge tone="accent" variant="soft" size="xs">Recommended</Badge> : null}
              </span>
              {option.description ? <span className={cn(meta, 'break-words')}>{option.description}</span> : null}
            </span>
          </label>
        ))}
        <label className={optionRow}>
          <Radio value={UNSURE} />
          <span className="min-w-0">Not sure — help me choose</span>
        </label>
      </RadioGroup>
      <div className="grid min-w-0 gap-bakin-1">
        <Label htmlFor={`${id}-text`} className={cn(meta, 'font-bakin-typography-weight-regular')}>{fieldLabel}</Label>
        <div className="flex min-w-0 flex-col gap-bakin-2 @sm/question:flex-row @sm/question:items-center">
          <Input
            ref={field}
            id={`${id}-text`}
            value={text}
            onChange={event => setText(event.target.value)}
            disabled={!interactive}
            className="min-w-0 flex-1"
          />
          {/* A radio cannot be unchecked by itself; clearing hands typed text back its answer role. */}
          {choice !== null && question.allowOther ? (
            <Button type="button" size="sm" variant="ghost" disabled={!interactive} onClick={clearChoice}>Clear choice</Button>
          ) : null}
          {onAnswer ? (
            <Button type="submit" size="sm" disabled={!interactive || !answer}>Answer</Button>
          ) : null}
        </div>
      </div>
    </form>
  )
}
