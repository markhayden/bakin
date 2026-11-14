import { useEffect, useRef } from 'react'
import { usePageIntroduction } from '@makinbakin/sdk/hooks'
import { FirstVisitCallout } from '@makinbakin/sdk/patterns'

/**
 * The page a path lands on, when it is that area's own front door:
 * `/chat` is, `/chat/abc` (an open conversation) is not. Nobody is
 * introduced to a page while they are in the middle of something on it.
 */
export function landingPageOf(pathname: string): string | null {
  const match = /^\/([a-z][a-z0-9-]*)\/?$/.exec(pathname)
  return match ? match[1]! : null
}

/**
 * The first-visit welcome for the page being shown, floated at the bottom
 * middle of the content area, lifted well off its bottom edge: clear of the
 * page's own controls in every corner, and never moving the page it sits over. One place renders it for
 * every page; which pages have one, and what each says, is Home's curated
 * content (`usePageIntroduction`).
 */
export function PageIntroduction({ pathname }: { pathname: string }) {
  const page = landingPageOf(pathname)
  const { introduction, close } = usePageIntroduction(page ?? '')
  const card = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const shown = Boolean(page && introduction)

  // Arriving: the card slides up from below and settles with one small bounce, quickly, and the
  // scrim fades in behind it. Skipped for anyone who asked for less motion.
  useEffect(() => {
    if (!shown || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    card.current?.animate?.(
      [
        { transform: 'translateY(140%)', opacity: 0 },
        { transform: 'translateY(-14px)', opacity: 1, offset: 0.6 },
        { transform: 'translateY(5px)', offset: 0.8 },
        { transform: 'translateY(0)' },
      ],
      { duration: 620, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards', delay: 250 },
    )
    scrim.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out', fill: 'backwards', delay: 150 })
  }, [shown, page])
  if (!page || !introduction) return null
  return (
    // The layer lets clicks through; only the card itself takes them.
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-bakin-4" style={{ paddingBlockEnd: '4.75rem' }} data-page-introduction={page}>
      {/*
        A scrim across the whole bottom of the page, not a halo around the card: the page behind is
        blurred and darkened from the bottom edge up and fades out above the card, so the card reads
        clearly however busy the page is (charts, tables, a board).
      */}
      <div
        ref={scrim}
        aria-hidden="true"
        style={{
          position: 'absolute',
          insetInline: 0,
          insetBlockEnd: 0,
          blockSize: '32rem',
          background: 'linear-gradient(to top, color-mix(in srgb, var(--bakin-color-canvas-default) 92%, transparent) 35%, transparent)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          maskImage: 'linear-gradient(to top, #000 55%, transparent)',
          WebkitMaskImage: 'linear-gradient(to top, #000 55%, transparent)',
        }}
      />
      <div ref={card} className="relative w-full max-w-2xl">
        <FirstVisitCallout
          title={introduction.title}
          illustration={introduction.image}
          onDismiss={close}
          dismissLabel="Close this introduction"
          className="pointer-events-auto w-full"
          style={{ boxShadow: '0 24px 64px -12px #000, 0 0 0 1px color-mix(in srgb, var(--bakin-color-signal-accent) 35%, transparent), 0 0 48px -8px color-mix(in srgb, var(--bakin-color-signal-accent) 45%, transparent)' }}
        >
          <p>{introduction.body}</p>
        </FirstVisitCallout>
      </div>
    </div>
  )
}
