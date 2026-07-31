import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

const ELEVATION_CSS = `
.bakin-elevation-doc {
  min-height: 100vh;
  background: var(--bakin-color-canvas-default);
  color: var(--bakin-color-text-primary);
  padding: var(--bakin-layout-space-8);
  font-family: var(--bakin-typography-family-ui);
}
.bakin-elevation-doc * { box-sizing: border-box; }
.bakin-elevation-doc__content { width: min(100%, 76rem); margin: 0 auto; }
.bakin-elevation-doc__eyebrow {
  margin: 0 0 var(--bakin-layout-space-2);
  color: var(--bakin-color-signal-accent);
  font-size: .75rem;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.bakin-elevation-doc h1 {
  margin: 0;
  font-size: clamp(2rem, 6vw, 3.75rem);
  line-height: 1;
  letter-spacing: -.045em;
}
.bakin-elevation-doc__lede {
  max-width: 46rem;
  margin: var(--bakin-layout-space-3) 0 0;
  color: var(--bakin-color-text-muted);
  font-size: 1rem;
  line-height: 1.65;
}
.bakin-elevation-ladder {
  display: grid;
  gap: var(--bakin-layout-space-4);
  margin-top: var(--bakin-layout-space-8);
}
.bakin-elevation-step {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--bakin-layout-space-3);
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--bakin-radius-surface);
  padding: var(--bakin-layout-space-4);
}
@media (min-width: 44rem) {
  .bakin-elevation-step { grid-template-columns: minmax(14rem, .6fr) minmax(0, 1fr); align-items: center; }
}
.bakin-elevation-step--canvas { background: var(--bakin-color-canvas-default); }
.bakin-elevation-step--surface { background: var(--bakin-color-surface-default); }
.bakin-elevation-step--elevated { background: var(--bakin-color-surface-elevated); }
.bakin-elevation-step--overlay {
  background: var(--bakin-color-surface-elevated);
  box-shadow: var(--bakin-elevation-overlay);
}
.bakin-elevation-step h2 { margin: 0; font-size: 1.125rem; letter-spacing: -.015em; }
.bakin-elevation-step code {
  font-family: var(--bakin-typography-family-mono);
  font-size: .78rem;
  overflow-wrap: anywhere;
  color: var(--bakin-color-text-primary);
}
.bakin-elevation-step p {
  margin: var(--bakin-layout-space-1) 0 0;
  color: var(--bakin-color-text-muted);
  font-size: .82rem;
  line-height: 1.5;
}
.bakin-elevation-doc__policy {
  margin-top: var(--bakin-layout-space-8);
  border-left: 2px solid var(--bakin-color-signal-highlight);
  padding-left: var(--bakin-layout-space-4);
  max-width: 46rem;
}
.bakin-elevation-doc__policy h2 { margin: 0 0 var(--bakin-layout-space-2); font-size: 1.125rem; }
.bakin-elevation-doc__policy p { margin: 0 0 var(--bakin-layout-space-3); color: var(--bakin-color-text-muted); font-size: .9rem; line-height: 1.6; }
@media (max-width: 44rem) {
  .bakin-elevation-doc { padding: var(--bakin-layout-space-4); }
}
@media (prefers-reduced-motion: reduce) {
  .bakin-elevation-doc *, .bakin-elevation-doc *::before, .bakin-elevation-doc *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
`.trim()

const STEPS = [
  {
    id: 'canvas',
    name: 'Canvas',
    token: 'semantic.color.canvas.default',
    cssVariable: '--bakin-color-canvas-default',
    utility: 'bg-bakin-canvas-default',
    intent: 'The application background behind every page. Nothing sits below it; page content and the shell chrome rest directly on it.',
  },
  {
    id: 'surface',
    name: 'Surface',
    token: 'semantic.color.surface.default',
    cssVariable: '--bakin-color-surface-default',
    utility: 'bg-bakin-surface-default',
    intent: 'The default bounded surface above the canvas: cards, panels, rows, and any container that groups content.',
  },
  {
    id: 'elevated',
    name: 'Surface / elevated',
    token: 'semantic.color.surface.elevated',
    cssVariable: '--bakin-color-surface-elevated',
    utility: 'bg-bakin-surface-elevated',
    intent: 'The single raised step above the default surface: nested panels inside a card, hover targets, and emphasized rows. The top solid step of the ladder.',
  },
  {
    id: 'overlay',
    name: 'Floating overlay',
    token: 'semantic.elevation.overlay',
    cssVariable: '--bakin-elevation-overlay',
    utility: 'shadow-bakin-elevation-overlay',
    intent: 'Dialogs, popovers, drawers, and menus do not get a lighter fill — they float on the overlay shadow instead. Depth beyond the elevated surface is expressed by shadow, never by another background step.',
  },
] as const

function ElevationLadder() {
  return (
    <main className="bakin-elevation-doc" aria-labelledby="elevation-title">
      <style>{ELEVATION_CSS}</style>
      <div className="bakin-elevation-doc__content">
        <header>
          <p className="bakin-elevation-doc__eyebrow">Foundation / public contract</p>
          <h1 id="elevation-title">Elevation</h1>
          <p className="bakin-elevation-doc__lede">
            Bakin expresses depth with a deliberately short ladder: two solid surface steps above the
            canvas, then shadow. Every container in product or plugin UI maps onto exactly one of these
            four levels — there are no intermediate tints.
          </p>
        </header>
        <div className="bakin-elevation-ladder" role="list" aria-label="Elevation ladder">
          {STEPS.map((step) => (
            <section
              key={step.id}
              role="listitem"
              aria-label={step.name}
              className={`bakin-elevation-step bakin-elevation-step--${step.id}`}
            >
              <div>
                <h2>{step.name}</h2>
                <p>{step.intent}</p>
              </div>
              <div>
                <code>{step.token}</code>
                <p>
                  <code>{step.cssVariable}</code> · <code>{step.utility}</code>
                </p>
              </div>
            </section>
          ))}
        </div>
        <aside className="bakin-elevation-doc__policy" aria-label="Extension policy">
          <h2>The ladder is intentionally this short</h2>
          <p>
            Canvas → surface → elevated surface → overlay shadow is the complete system. Do not mint
            higher surface steps, per-feature tints, or parallel elevation scales: a new elevation step
            is a gated public-contract extension that requires explicit approval and a token-pipeline
            change, exactly like any other new semantic token.
          </p>
          <p>
            If a design seems to need a fourth solid step, it is almost always a hierarchy problem —
            flatten the nesting or move the top layer onto the overlay shadow instead.
          </p>
        </aside>
      </div>
    </main>
  )
}

const meta = {
  title: 'Foundations/Elevation',
  component: ElevationLadder,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The documented elevation system: canvas (semantic.color.canvas.default) → surface (semantic.color.surface.default) → elevated surface (semantic.color.surface.elevated) → floating overlays on the overlay shadow (semantic.elevation.overlay). The ladder is deliberately three solid surfaces plus one shadow; new elevation steps are a gated extension of the public token contract, not a per-feature decision.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'reduced-motion'],
  },
} satisfies Meta<typeof ElevationLadder>

export default meta
type Story = StoryObj<typeof meta>

export const Ladder: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Elevation' })).toBeVisible()
    for (const step of STEPS) {
      await expect(canvas.getByRole('listitem', { name: step.name })).toBeVisible()
    }
    await expect(canvas.getByText('semantic.color.surface.elevated')).toBeVisible()
  },
}
