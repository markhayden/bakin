import * as React from 'react'

import { cn } from '../utils'
import type { FeedbackAnnouncement, SystemStateHeadingLevel } from './system-state'

export type BannerTone = 'info' | 'success' | 'attention' | 'danger'

type NativeBannerProps = Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'aria-describedby' | 'aria-labelledby' | 'aria-live' | 'children' | 'role' | 'title'
>

export interface BannerProps extends NativeBannerProps {
  action?: React.ReactNode
  announce?: FeedbackAnnouncement
  description?: React.ReactNode
  headingLevel?: SystemStateHeadingLevel
  title?: React.ReactNode
  tone?: BannerTone
}

const defaultTitles: Record<BannerTone, string> = {
  info: 'Heads up',
  success: 'Update complete',
  attention: 'Action may be needed',
  danger: 'Action failed',
}

const toneClasses: Record<BannerTone, string> = {
  info: 'border-bakin-signal-info/60 bg-bakin-signal-info/10',
  success: 'border-bakin-action-primary-background/60 bg-bakin-action-primary-background/10',
  attention: 'border-bakin-signal-highlight/60 bg-bakin-signal-highlight/10',
  danger: 'border-bakin-signal-danger/60 bg-bakin-signal-danger/10',
}

const signalClasses: Record<BannerTone, string> = {
  info: 'bg-bakin-signal-info',
  success: 'bg-bakin-action-primary-background',
  attention: 'bg-bakin-signal-highlight',
  danger: 'bg-bakin-signal-danger',
}

/** Persistent page or section notice. Announcements are opt-in because severity and urgency are different concerns. */
export function Banner({
  action,
  announce = 'off',
  className,
  description,
  headingLevel = 2,
  title,
  tone = 'info',
  ...props
}: BannerProps) {
  const titleId = React.useId()
  const descriptionId = React.useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  const liveRole = announce === 'off' ? undefined : announce === 'assertive' ? 'alert' : 'status'

  return (
    <section
      {...props}
      role={liveRole}
      aria-atomic={liveRole ? true : undefined}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-live={announce === 'off' ? undefined : announce}
      data-announcement={announce}
      data-slot="banner"
      data-tone={tone}
      className={cn(
        '@container/banner grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-bakin-3 gap-y-bakin-2 rounded-bakin-surface border px-bakin-4 py-bakin-3 font-bakin-typography-family-ui text-bakin-text-primary @lg/banner:grid-cols-[auto_minmax(0,1fr)_auto]',
        toneClasses[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-slot="banner-signal"
        className={cn('mt-bakin-1 size-bakin-3 shrink-0 rounded-bakin-pill', signalClasses[tone])}
      />
      <div data-slot="banner-copy" className="min-w-0">
        <Heading
          id={titleId}
          data-slot="banner-title"
          className="m-0 text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-semibold leading-snug"
        >
          {title ?? defaultTitles[tone]}
        </Heading>
        {description ? (
          <p
            id={descriptionId}
            data-slot="banner-description"
            className="m-0 max-w-prose text-[length:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-muted"
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <div
          data-slot="banner-actions"
          className="col-start-2 flex min-w-0 flex-wrap items-center gap-bakin-2 @lg/banner:col-start-3 @lg/banner:row-start-1 @lg/banner:row-span-2 @lg/banner:self-center"
        >
          {action}
        </div>
      ) : null}
    </section>
  )
}
