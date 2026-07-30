/**
 * Shared story scaffolding — the ONE home for stage/intro chrome, the overlay
 * backdrop, and the tiny inline icons that story files previously duplicated
 * (StoryHeader ×3, PatternStage ×3, WorkspaceBackdrop ×2, SignalIcon ×2).
 *
 * Rules of the house:
 * - Scaffolding never appears in a `CanonicalUsage` story — those stay
 *   minimal, copy-pasteable, and import only `@makinbakin/sdk/*`.
 * - This module may import only focused public SDK entrypoints; the public
 *   story boundary walk covers it like any story file.
 * - App code must never import from `storybook/` (architecture-test enforced).
 */
import type { ReactNode } from 'react'

import { PageShell, Stack, type PageShellProps } from '@makinbakin/sdk/layout'

import './support.css'

export interface StoryIntroProps {
  eyebrow: string
  title: string
  description: string
}

/** The eyebrow/title/description header block used by showcase stories. */
export function StoryIntro({ eyebrow, title, description }: StoryIntroProps) {
  return (
    <header className="bakin-story-stage__intro">
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}

export interface StoryStageProps extends StoryIntroProps {
  width?: PageShellProps['width']
  children: ReactNode
}

/**
 * Full showcase wrapper: canvas backdrop, PageShell measure, section stack,
 * and the intro header. Replaces the per-file StoryHeader/PatternStage copies.
 */
export function StoryStage({ eyebrow, title, description, width = 'content', children }: StoryStageProps) {
  return (
    <main className="bakin-story-stage">
      <PageShell width={width}>
        <Stack gap="section">
          <StoryIntro eyebrow={eyebrow} title={title} description={description} />
          {children}
        </Stack>
      </PageShell>
    </main>
  )
}

/**
 * Muted workspace silhouette rendered behind overlay stories (dialogs,
 * sheets, drawers) so focus, scrim, and elevation read against real chrome.
 */
export function OverlayBackdrop() {
  return (
    <div className="bakin-story-stage__overlay-workspace" aria-hidden="true">
      <div />
      <div />
      <div />
    </div>
  )
}

export function SignalIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4M8 11.5h.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

export function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 8h10M8.5 3.5 13 8l-4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  )
}
