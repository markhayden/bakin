import { useId, useState, type FormEvent } from 'react'

import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Input } from '../primitives/input'
import { Radio, RadioGroup } from '../primitives/radio-group'
import { cn } from '../utils'
import { formatQuestionAnswer, type QuestionAnswer, type TurnItem } from './fold'

type QuestionItem = Extract<TurnItem, { type: 'question' }>

const OTHER = 'other'
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
 * options (its recommendation labelled, never preselected), "Something
 * else", "Not sure", and an optional note; settled cards collapse to the
 * answer the transcript recorded.
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
  const [other, setOther] = useState('')
  const [note, setNote] = useState('')
  const interactive = Boolean(onAnswer) && !busy

  const answer: QuestionAnswer | null = choice === null
    ? null
    : choice === UNSURE ? { kind: 'unsure' }
      : choice === OTHER ? (other.trim() ? { kind: 'other', text: other } : null)
        : { kind: 'option', index: Number(choice) }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!interactive || !answer) return
    onAnswer!(formatQuestionAnswer(question, answer, note))
  }

  return (
    <form
      data-conv-question=""
      data-state="open"
      aria-labelledby={`${id}-question`}
      onSubmit={submit}
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
        {question.allowOther ? (
          <label className={optionRow}>
            <Radio value={OTHER} />
            <span className="min-w-0">Something else…</span>
          </label>
        ) : null}
        <label className={optionRow}>
          <Radio value={UNSURE} />
          <span className="min-w-0">Not sure — help me choose</span>
        </label>
      </RadioGroup>
      {choice === OTHER ? (
        <Input
          aria-label="Your answer"
          value={other}
          onChange={event => setOther(event.target.value)}
          disabled={!interactive}
          autoFocus
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-bakin-2 @sm/question:flex-row @sm/question:items-center">
        <Input
          aria-label="Add a note (optional)"
          placeholder="Add a note (optional)"
          value={note}
          onChange={event => setNote(event.target.value)}
          disabled={!interactive}
          className="min-w-0 flex-1"
        />
        {onAnswer ? (
          <Button type="submit" size="sm" disabled={!interactive || !answer}>Answer</Button>
        ) : null}
      </div>
    </form>
  )
}
