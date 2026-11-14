import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { closeIcon } from '../primitives/modal-context'
import { cn } from '../utils'

export type FirstVisitCalloutHeadingLevel = 2 | 3 | 4

export interface FirstVisitCalloutProps extends Omit<ComponentPropsWithoutRef<'aside'>, 'title' | 'children'> {
  /** The small label above the headline. */
  eyebrow?: string
  /** One short sentence that names the place. */
  title: string
  /** A sentence or two on what the place is for. */
  children: ReactNode
  /** A picture for the place; decorative, and dropped where there is no room for it. */
  illustration?: string
  /** The person closed it. The owner decides that it stays closed. */
  onDismiss: () => void
  dismissLabel?: string
  headingLevel?: FirstVisitCalloutHeadingLevel
}

/**
 * The welcome a place gives the first time someone arrives: an eyebrow, a
 * headline, a line or two, a picture, and a way to close it. It is
 * onboarding, not feedback: nothing is wrong and nothing needs doing, so it
 * carries no status tone and no action beyond closing. It is presentational:
 * the owner decides where it sits (see the story for the floating layer) and
 * remembers that it was closed.
 */
export function FirstVisitCallout({
  eyebrow = 'First time here',
  title,
  children,
  illustration,
  onDismiss,
  dismissLabel = 'Close',
  headingLevel = 2,
  className,
  ...props
}: FirstVisitCalloutProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <aside
      {...props}
      data-slot="first-visit-callout"
      aria-label={title}
      className={cn(
        'relative flex min-w-0 items-stretch overflow-hidden rounded-bakin-overlay border border-bakin-signal-accent/55 bg-bakin-surface-elevated text-balance shadow-bakin-elevation-overlay',
        // The accent carries Bakin's identity here; the wash keeps the card from reading as an alert.
        'bg-[radial-gradient(120%_140%_at_100%_100%,color-mix(in_srgb,var(--bakin-color-signal-accent)_18%,transparent),transparent_70%)]',
        className,
      )}
    >
      {illustration ? (
        <img
          data-slot="first-visit-callout-illustration"
          src={illustration}
          alt=""
          // Leads the card, clear of the close control, and only when there is room beside the words;
          // the left of the picture is where its subject is.
          className="hidden w-1/4 shrink-0 self-stretch object-cover object-left sm:block"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-bakin-2 p-bakin-6">
        <Badge tone="accent" variant="solid" size="xs">{eyebrow}</Badge>
        <Heading className="pr-bakin-8 text-[length:var(--bakin-typography-size-title)] font-bakin-typography-weight-semibold leading-tight text-bakin-text-primary">
          {title}
        </Heading>
        <div className="text-[length:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-muted">{children}</div>
      </div>
      <Button variant="ghost" size="icon-sm" className="absolute right-bakin-3 top-bakin-3 z-10" aria-label={dismissLabel} onClick={onDismiss}>
        {closeIcon(dismissLabel)}
      </Button>
    </aside>
  )
}
