'use client'

import type { ComponentType, ReactNode } from 'react'

import { Overline, Text } from '../primitives/text'
import { Card, CardContent, CardDescription, CardTitle } from '../primitives/card'
import { cn } from '../utils'

export interface GuideCardPoint {
  /** Short overline-style heading for one consideration. */
  heading: string
  /** One or two sentences a new user can act on. */
  body: ReactNode
}

export type GuideCardHeadingLevel = 2 | 3

export interface GuideCardProps {
  /** Optional icon drawn in a tinted gutter that indents the whole card body. */
  icon?: ComponentType<{ className?: string }>
  title: ReactNode
  /** What this surface controls and why it exists — always visible. */
  lead: ReactNode
  /** The things worth weighing before changing anything; rendered as a railed strip. */
  points?: ReadonlyArray<GuideCardPoint>
  /** Page-level actions that belong to this surface (kept one visual weight below the page header's). */
  actions?: ReactNode
  /** Document-outline level for the title; the card sits directly under a page title by default. */
  headingLevel?: GuideCardHeadingLevel
  className?: string
}

/**
 * The plain-words opener for a settings surface: what it controls, why it
 * exists, and what to think about before touching it. One icon gutter
 * indents title, lead and the points together; the points read as a railed
 * strip (the stat-strip rhythm with prose in place of numbers) that stacks
 * on narrow containers. Prose stays prose — the accessible outline gets one
 * heading for the card and an overline per point.
 */
export function GuideCard({
  icon: Icon,
  title,
  lead,
  points = [],
  actions,
  headingLevel = 2,
  className,
}: GuideCardProps) {
  return (
    <Card data-slot="guide-card" className={cn('bg-bakin-surface-subtle', className)}>
      <CardContent className="flex min-w-0 items-start gap-bakin-3">
        {Icon ? (
          <span
            aria-hidden="true"
            data-slot="guide-card-icon"
            className="mt-bakin-1 flex size-bakin-8 shrink-0 items-center justify-center rounded-bakin-pill bg-bakin-action-primary-background/10 text-bakin-action-primary-background"
          >
            <Icon className="size-bakin-4" />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-bakin-4">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3">
            <div className="min-w-0">
              <CardTitle as={headingLevel === 3 ? 'h3' : 'h2'}>{title}</CardTitle>
              <CardDescription className="mt-bakin-1 max-w-prose leading-relaxed">{lead}</CardDescription>
            </div>
            {actions ? (
              <div data-slot="guide-card-actions" className="flex flex-wrap items-center gap-bakin-2">
                {actions}
              </div>
            ) : null}
          </div>
          {points.length > 0 ? (
            <div
              data-slot="guide-card-points"
              className="grid min-w-0 gap-bakin-4 @2xl/page-shell:grid-cols-3"
            >
              {points.map((point) => (
                <div key={point.heading} className="min-w-0 border-s border-bakin-border-subtle py-bakin-2 ps-bakin-4">
                  <Overline className="text-bakin-text-primary">{point.heading}</Overline>
                  <Text as="p" size="meta" tone="muted" className="mt-bakin-3 leading-relaxed">
                    {point.body}
                  </Text>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
