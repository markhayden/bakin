import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { tokenLabel } from '../../support/token-label'
import { GENERATED_TOKENS } from '../../support/tokens.data'

const cssVar = (path: string) => `--bakin-${path.replace(/^semantic\./, '').replace(/\./g, '-')}`
const pub = GENERATED_TOKENS.filter((token) => token.visibility === 'public' && token.layer === 'semantic')
const DURATIONS = pub.filter((token) => token.type === 'duration')
const EASINGS = pub.filter((token) => token.type === 'cubicBezier')
const printable = (value: unknown) => Array.isArray(value)
  ? `cubic-bezier(${value.join(', ')})`
  : value && typeof value === 'object' && 'value' in (value as object)
    ? `${(value as { value: number }).value}${(value as { unit?: string }).unit ?? ''}`
    : String(value)

const CSS = `
.bakin-motion-doc {
.bakin-token-label { display: block; font-size: .875rem; font-weight: 600; line-height: 1.2; margin-bottom: .125rem; }
 min-height: 100vh; background: var(--bakin-color-canvas-default); color: var(--bakin-color-text-primary); padding: var(--bakin-layout-space-8); font-family: var(--bakin-typography-family-ui); }
.bakin-motion-doc__content { width: min(100%, 64rem); margin: 0 auto; }
.bakin-motion-doc h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.75rem); line-height: 1; letter-spacing: -.045em; }
.bakin-motion-doc__lede { max-width: 46rem; margin: var(--bakin-layout-space-3) 0 0; color: var(--bakin-color-text-muted); line-height: 1.65; }
.bakin-motion-doc h2 { margin: var(--bakin-layout-space-8) 0 var(--bakin-layout-space-3); font-size: 1.125rem; }
.bakin-motion-doc ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--bakin-layout-space-3); }
.bakin-motion-row { display: grid; grid-template-columns: minmax(16rem, .55fr) minmax(0, 1fr); gap: var(--bakin-layout-space-3); align-items: center; }
.bakin-motion-row code { font-family: var(--bakin-typography-family-mono); font-size: .75rem; overflow-wrap: anywhere; display: block; }
.bakin-motion-row small { color: var(--bakin-color-text-muted); }
.bakin-motion-track { display: block; position: relative; block-size: 1.25rem; border-radius: var(--bakin-radius-pill); background: var(--bakin-color-surface-default); border: 1px solid var(--bakin-color-border-subtle); }
.bakin-motion-dot { display: block; position: absolute; inset-block: 0; inset-inline-start: 0; inline-size: 1.25rem; border-radius: inherit; background: var(--bakin-color-signal-accent); transition-property: transform; }
.bakin-motion-track[data-away='true'] .bakin-motion-dot { transform: translateX(min(22rem, 52vw)); }
@media (prefers-reduced-motion: reduce) { .bakin-motion-dot { transition: none; } }
@media (max-width: 44rem) { .bakin-motion-doc { padding: var(--bakin-layout-space-4); } .bakin-motion-row { grid-template-columns: 1fr; } }
`

/**
 * The dot hops to the other end of the track every 1.6s; each hop TAKES the
 * demonstrated token's time (durations) or curve (easings). Honest by
 * construction: the transition consumes the live custom property, so 0ms
 * really is instant and 120ms really is a fast hop. Reduced motion pins the
 * dot in place.
 */
function useShuttle(): boolean {
  const [away, setAway] = useState(false)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setAway((current) => !current), 1600)
    return () => window.clearInterval(timer)
  }, [])
  return away
}

function MotionDoc() {
  const away = useShuttle()
  return (
    <div className="bakin-motion-doc">
      <style>{CSS}</style>
      <div className="bakin-motion-doc__content">
        <h1>Motion</h1>
        <p className="bakin-motion-doc__lede">
          Every 1.6s the dot hops to the other end of its track. A duration row spends exactly its
          token on the hop — instant really is instant. An easing row takes a fixed 600ms so the
          curves compare. Reduced motion pins the dots.
        </p>
        <h2>Durations</h2>
        <ul>
          {DURATIONS.map((token) => (
            <li key={token.path} className="bakin-motion-row" aria-label={token.path}>
              <span>
                <strong className="bakin-token-label">{tokenLabel(token.path)}</strong>
                <code>{cssVar(token.path)}</code>
                <small>{printable(token.value)}</small>
              </span>
              <span className="bakin-motion-track" data-away={away} aria-hidden="true">
                <span
                  className="bakin-motion-dot"
                  style={{
                    transitionDuration: `var(${cssVar(token.path)})`,
                    transitionTimingFunction: 'var(--bakin-motion-easing-standard, ease)',
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
        <h2>Easings</h2>
        <ul>
          {EASINGS.map((token) => (
            <li key={token.path} className="bakin-motion-row" aria-label={token.path}>
              <span>
                <strong className="bakin-token-label">{tokenLabel(token.path)}</strong>
                <code>{cssVar(token.path)}</code>
                <small>{printable(token.value)}</small>
              </span>
              <span className="bakin-motion-track" data-away={away} aria-hidden="true">
                <span
                  className="bakin-motion-dot"
                  style={{ transitionDuration: '600ms', transitionTimingFunction: `var(${cssVar(token.path)})` }}
                />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const meta = {
  title: 'Tokens/Motion',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'The public motion durations and easings, demonstrated by a periodic hop that consumes the live custom property — a duration row spends exactly its token on the move, an easing row shows its curve over a fixed hop. Respects prefers-reduced-motion. Transitions compose these tokens; never hard-code a millisecond value.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'reduced-motion'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Timings: Story = {
  render: () => <MotionDoc />,
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { name: 'Motion', level: 1 })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Durations' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Easings' })).toBeVisible()
    // The dot must be a real box — an inline span here collapses to nothing.
    const dot = canvasElement.querySelector('.bakin-motion-dot') as HTMLElement
    await expect(dot).not.toBeNull()
    expect(dot.getBoundingClientRect().width).toBeGreaterThan(0)
  },
}
