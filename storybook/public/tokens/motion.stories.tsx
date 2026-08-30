import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { GENERATED_TOKENS } from '../../support/tokens.data'

const cssVar = (path: string) => `--bakin-${path.replace(/^semantic\./, '').replace(/\./g, '-')}`
const pub = GENERATED_TOKENS.filter((token) => token.visibility === 'public' && token.layer === 'semantic')
const DURATIONS = pub.filter((token) => token.type === 'duration')
const EASINGS = pub.filter((token) => token.type === 'cubicBezier')
const printable = (value: unknown) => Array.isArray(value) ? `cubic-bezier(${value.join(', ')})` : (value && typeof value === 'object' && 'value' in (value as object)) ? `${(value as { value: number }).value}${(value as { unit?: string }).unit ?? ''}` : String(value)

const CSS = `
.bakin-motion-doc { min-height: 100vh; background: var(--bakin-color-canvas-default); color: var(--bakin-color-text-primary); padding: var(--bakin-layout-space-8); font-family: var(--bakin-typography-family-ui); }
.bakin-motion-doc__content { width: min(100%, 64rem); margin: 0 auto; }
.bakin-motion-doc h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.75rem); line-height: 1; letter-spacing: -.045em; }
.bakin-motion-doc h2 { margin: var(--bakin-layout-space-8) 0 var(--bakin-layout-space-3); font-size: 1.125rem; }
.bakin-motion-doc ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--bakin-layout-space-3); }
.bakin-motion-row { display: grid; grid-template-columns: minmax(16rem, .55fr) minmax(0, 1fr); gap: var(--bakin-layout-space-3); align-items: center; }
.bakin-motion-row code { font-family: var(--bakin-typography-family-mono); font-size: .75rem; overflow-wrap: anywhere; display: block; }
.bakin-motion-row small { color: var(--bakin-color-text-muted); }
.bakin-motion-track { block-size: 1.25rem; border-radius: var(--bakin-radius-pill); background: var(--bakin-color-surface-default); border: 1px solid var(--bakin-color-border-subtle); overflow: hidden; }
.bakin-motion-dot { inline-size: 1.25rem; block-size: 100%; border-radius: inherit; background: var(--bakin-color-signal-accent); animation: bakin-motion-demo 2.4s infinite alternate; }
@keyframes bakin-motion-demo { from { transform: translateX(0); } to { transform: translateX(min(24rem, 60vw)); } }
@media (prefers-reduced-motion: reduce) { .bakin-motion-dot { animation: none; } }
@media (max-width: 44rem) { .bakin-motion-doc { padding: var(--bakin-layout-space-4); } .bakin-motion-row { grid-template-columns: 1fr; } }
`

function MotionDoc() {
  return (
    <div className="bakin-motion-doc">
      <style>{CSS}</style>
      <div className="bakin-motion-doc__content">
        <h1>Motion</h1>
        <h2>Durations</h2>
        <ul>
          {DURATIONS.map((token) => (
            <li key={token.path} className="bakin-motion-row" aria-label={token.path}>
              <span>
                <code>{cssVar(token.path)}</code>
                <small>{printable(token.value)}</small>
              </span>
              <span className="bakin-motion-track" aria-hidden="true">
                <span className="bakin-motion-dot" style={{ animationDuration: `var(${cssVar(token.path)})`, animationTimingFunction: 'var(--bakin-motion-easing-standard, ease)' }} />
              </span>
            </li>
          ))}
        </ul>
        <h2>Easings</h2>
        <ul>
          {EASINGS.map((token) => (
            <li key={token.path} className="bakin-motion-row" aria-label={token.path}>
              <span>
                <code>{cssVar(token.path)}</code>
                <small>{printable(token.value)}</small>
              </span>
              <span className="bakin-motion-track" aria-hidden="true">
                <span className="bakin-motion-dot" style={{ animationTimingFunction: `var(${cssVar(token.path)})` }} />
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
        component: 'The public motion durations and easings, demonstrated on a live loop that respects prefers-reduced-motion. Transitions compose these tokens; never hard-code a millisecond value.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'reduced-motion'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Timings: Story = {
  render: () => <MotionDoc />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Motion', level: 1 })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Durations' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Easings' })).toBeVisible()
  },
}
