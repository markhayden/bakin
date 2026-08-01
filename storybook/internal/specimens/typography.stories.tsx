import type { CSSProperties, ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/space-grotesk/latin-400.css'
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/space-grotesk/latin-600.css'
import '@fontsource/space-grotesk/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'

import candidateConfig from '../../../design-system/specimens/typography-candidates.json'

const STUDY_CSS = `
.bakin-type-study {
  min-height: 100vh;
  background: var(--bakin-color-canvas-default);
  color: var(--bakin-color-text-primary);
  padding: var(--bakin-layout-space-6);
}
.bakin-type-study, .bakin-type-study * { box-sizing: border-box; }
.bakin-type-study__intro {
  width: min(100%, 88rem);
  margin: 0 auto var(--bakin-layout-space-6);
}
.bakin-type-study__intro h1 {
  margin: 0;
  font: 600 clamp(1.8rem, 5vw, 3.25rem)/1.04 var(--bakin-typography-family-ui);
  letter-spacing: -.04em;
}
.bakin-type-study__intro p {
  max-width: 58rem;
  margin: var(--bakin-layout-space-2) 0 0;
  color: var(--bakin-color-text-muted);
  font: 400 .9rem/1.6 var(--bakin-typography-family-ui);
}
.bakin-type-study__directions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--bakin-layout-space-4);
  width: min(100%, 88rem);
  margin: 0 auto;
  align-items: start;
}
.bakin-type-study__directions--single { grid-template-columns: minmax(0, 1fr); max-width: 54rem; }
.bakin-type-study__fallbacks {
  display: grid;
  gap: var(--bakin-layout-space-4);
  width: min(100%, 64rem);
  margin: 0 auto;
}
.bakin-type-direction {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--bakin-radius-overlay);
  background: var(--bakin-color-surface-default);
  font-family: var(--specimen-sans);
}
.bakin-type-direction__label {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--bakin-layout-space-2);
  padding: var(--bakin-layout-space-3) var(--bakin-layout-space-4);
  border-bottom: 1px solid var(--bakin-color-border-subtle);
}
.bakin-type-direction__label strong { font-size: .8rem; letter-spacing: .01em; }
.bakin-type-direction__label span { color: var(--bakin-color-text-muted); font-size: .7rem; }
.bakin-type-direction__page { padding: var(--bakin-layout-space-4); }
.bakin-type-direction__eyebrow {
  margin: 0 0 var(--bakin-layout-space-2);
  color: var(--bakin-color-signal-accent);
  font-size: .67rem;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.bakin-type-direction__heading {
  max-width: 25ch;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: clamp(1.55rem, 4vw, 2.35rem);
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -.035em;
}
.bakin-type-direction__description {
  max-width: 58ch;
  margin: var(--bakin-layout-space-2) 0 0;
  color: var(--bakin-color-text-muted);
  font-size: .78rem;
  line-height: 1.55;
}
.bakin-type-direction__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bakin-layout-space-2);
  margin-top: var(--bakin-layout-space-3);
}
.bakin-type-direction__actions button {
  min-height: 2rem;
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--bakin-radius-control);
  padding: 0 var(--bakin-layout-space-3);
  background: transparent;
  color: var(--bakin-color-text-primary);
  font: 600 .72rem/1 var(--specimen-sans);
}
.bakin-type-direction__actions button:first-child {
  border-color: var(--bakin-color-action-primary-background);
  background: var(--bakin-color-action-primary-background);
  color: var(--bakin-color-action-primary-foreground);
}
.bakin-type-direction__actions button:focus-visible {
  outline: 2px solid var(--bakin-color-focus-ring);
  outline-offset: 2px;
}
.bakin-type-direction__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--bakin-layout-space-2);
  margin: var(--bakin-layout-space-4) 0;
  padding: var(--bakin-layout-space-3) 0;
  border-block: 1px solid var(--bakin-color-border-subtle);
}
.bakin-type-direction__metric span {
  display: block;
  color: var(--bakin-color-text-muted);
  font-size: .62rem;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.bakin-type-direction__metric strong {
  display: block;
  margin-top: var(--bakin-layout-space-1);
  font-family: var(--specimen-mono);
  font-size: .9rem;
  font-variant-numeric: tabular-nums;
}
.bakin-type-direction__section { margin-top: var(--bakin-layout-space-4); }
.bakin-type-direction__section h3 {
  margin: 0 0 var(--bakin-layout-space-2);
  font-size: .78rem;
  font-weight: 600;
  letter-spacing: -.01em;
}
.bakin-type-direction__status-list { display: grid; gap: var(--bakin-layout-space-2); }
.bakin-type-direction__status-row {
  display: grid;
  grid-template-columns: .5rem minmax(0, 1fr) auto;
  gap: var(--bakin-layout-space-2);
  align-items: baseline;
  min-width: 0;
  font-size: .7rem;
}
.bakin-type-direction__status-row i {
  width: .45rem;
  height: .45rem;
  border-radius: var(--bakin-radius-pill);
  background: var(--bakin-color-action-primary-background);
}
.bakin-type-direction__status-row span { min-width: 0; overflow-wrap: anywhere; }
.bakin-type-direction__status-row code,
.bakin-type-direction__route,
.bakin-type-direction table { font-family: var(--specimen-mono); }
.bakin-type-direction__status-row code { color: var(--bakin-color-text-muted); font-size: .62rem; }
.bakin-type-direction__route {
  margin: 0;
  overflow-wrap: anywhere;
  border-left: 2px solid var(--bakin-color-signal-highlight);
  padding-left: var(--bakin-layout-space-2);
  color: var(--bakin-color-text-muted);
  font-size: .66rem;
  line-height: 1.55;
}
.bakin-type-direction__table-wrap {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--bakin-radius-control);
}
.bakin-type-direction__table-wrap:focus-visible {
  outline: 2px solid var(--bakin-color-focus-ring);
  outline-offset: 2px;
}
.bakin-type-direction table {
  width: 100%;
  min-width: 31rem;
  border-collapse: collapse;
  font-size: .62rem;
  font-variant-numeric: tabular-nums;
}
.bakin-type-direction th,
.bakin-type-direction td { padding: var(--bakin-layout-space-2); text-align: left; white-space: nowrap; }
.bakin-type-direction th { color: var(--bakin-color-text-muted); font-weight: 500; }
.bakin-type-direction tbody tr + tr { border-top: 1px solid var(--bakin-color-border-subtle); }
.bakin-type-direction__glyphs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bakin-layout-space-2) var(--bakin-layout-space-3);
  margin-top: var(--bakin-layout-space-3);
  color: var(--bakin-color-text-muted);
  font-size: .68rem;
}
.bakin-type-direction__glyphs code { font-family: var(--specimen-mono); }
.bakin-type-fallback-note {
  padding: var(--bakin-layout-space-3) var(--bakin-layout-space-4);
  border-bottom: 1px solid var(--bakin-color-border-subtle);
  color: var(--bakin-color-text-muted);
  font-size: .72rem;
  line-height: 1.5;
}
@media (max-width: 56rem) {
  .bakin-type-study { padding: var(--bakin-layout-space-4); }
  .bakin-type-study__directions { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 24rem) {
  .bakin-type-study { padding: var(--bakin-layout-space-3); }
  .bakin-type-direction__page { padding: var(--bakin-layout-space-3); }
  .bakin-type-direction__metrics { grid-template-columns: 1fr; }
  .bakin-type-direction__actions button { flex: 1 1 auto; }
  .bakin-type-direction__status-row { grid-template-columns: .5rem minmax(0, 1fr); align-items: start; }
  .bakin-type-direction__status-row code { grid-column: 2; overflow-wrap: anywhere; }
}
`.trim()

type DirectionId = 'operational-neutral' | 'product-character'
type FallbackMode = 'none' | 'missing' | 'slow'

const directionFonts: Record<DirectionId, { sans: string; mono: string }> = {
  'operational-neutral': {
    sans: "Inter, ui-sans-serif, system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  'product-character': {
    sans: 'var(--bakin-typography-family-ui)',
    mono: 'var(--bakin-typography-family-mono)',
  },
}

const fallbackFonts: Record<Exclude<FallbackMode, 'none'>, { sans: string; mono: string }> = {
  missing: {
    sans: "'Bakin Missing Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'Bakin Missing Mono', ui-monospace, monospace",
  },
  slow: {
    sans: "'Bakin Pending Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'Bakin Pending Mono', ui-monospace, monospace",
  },
}

function directionStyle(direction: DirectionId, fallback: FallbackMode): CSSProperties {
  const fonts = fallback === 'none' ? directionFonts[direction] : fallbackFonts[fallback]
  return {
    '--specimen-sans': fonts.sans,
    '--specimen-mono': fonts.mono,
  } as CSSProperties
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div className="bakin-type-direction__metric"><span>{label}</span><strong>{children}</strong></div>
}

function DirectionSpecimen({
  direction,
  fallback = 'none',
}: {
  direction: DirectionId
  fallback?: FallbackMode
}) {
  const configured = candidateConfig.directions.find((candidate) => candidate.id === direction)
  if (!configured) throw new Error(`Unknown typography direction ${direction}`)
  const configuredSans = candidateConfig.fonts.find((font) => font.id === configured.sans)
  const label = fallback === 'none'
    ? configured.label
    : fallback === 'missing'
      ? 'Missing font fallback'
      : 'Slow-load fallback before swap'
  const fontNote = fallback === 'none'
    ? `${configuredSans?.family ?? configured.sans} + JetBrains Mono`
    : 'System UI + system monospace fallback'
  const approvalNote = direction === candidateConfig.selectedPair
    ? 'Selected default.'
    : 'Comparison evidence only.'

  return (
    <article className="bakin-type-direction" style={directionStyle(direction, fallback)} aria-label={label}>
      <div className="bakin-type-direction__label">
        <strong>{label}</strong>
        <span>{fontNote} · {approvalNote}</span>
      </div>
      {fallback !== 'none' && (
        <div className="bakin-type-fallback-note">
          {fallback === 'missing'
            ? 'The requested faces never resolve; all content must remain legible and operational in the declared fallback stacks.'
            : 'This captures the first paint while bundled faces are still pending. Compare line wraps and metric stability against the loaded candidates.'}
        </div>
      )}
      <div className="bakin-type-direction__page">
        <p className="bakin-type-direction__eyebrow">Health / runtime</p>
        <h2 className="bakin-type-direction__heading">OpenClaw runtime capability synchronization and provider fallback recovery</h2>
        <p className="bakin-type-direction__description">
          Check live coordination health, inspect the selected provider route, and recover safely without losing the last usable evidence.
        </p>
        <div className="bakin-type-direction__actions">
          <button type="button">Run checks</button>
          <button type="button">View runtime logs</button>
        </div>

        <div className="bakin-type-direction__metrics" aria-label="Runtime summary">
          <Metric label="Tokens today">1,284,330</Metric>
          <Metric label="Reported cost">$18.42</Metric>
          <Metric label="Availability">99.97%</Metric>
        </div>

        <section className="bakin-type-direction__section" aria-labelledby={`${direction}-${fallback}-pulse`}>
          <h3 id={`${direction}-${fallback}-pulse`}>System pulse</h3>
          <div className="bakin-type-direction__status-list">
            <div className="bakin-type-direction__status-row"><i aria-hidden="true" /><span>Coordination database and execution journal</span><code>healthy · 42 ms</code></div>
            <div className="bakin-type-direction__status-row"><i aria-hidden="true" /><span>Search index enrichment queue</span><code>7 pending · 00:18</code></div>
            <div className="bakin-type-direction__status-row"><i aria-hidden="true" /><span>OpenClaw gateway websocket</span><code>connected · 12m 08s</code></div>
          </div>
        </section>

        <section className="bakin-type-direction__section" aria-labelledby={`${direction}-${fallback}-route`}>
          <h3 id={`${direction}-${fallback}-route`}>Selected workflow route</h3>
          <p className="bakin-type-direction__route">workflow://video-social-post/assemble-video → provider/openai/gpt-5.2 · retry 02/03</p>
        </section>

        <section className="bakin-type-direction__section" aria-labelledby={`${direction}-${fallback}-activity`}>
          <h3 id={`${direction}-${fallback}-activity`}>Recent agent activity</h3>
          <div className="bakin-type-direction__table-wrap" tabIndex={0} role="region" aria-label="Scrollable recent agent activity table">
            <table>
              <thead><tr><th scope="col">Agent</th><th scope="col">Session</th><th scope="col">Context</th><th scope="col">Cost</th></tr></thead>
              <tbody>
                <tr><td>Patch</td><td>agent:patch:explicit:sess-01JZ9T4P6KE7</td><td>78.4%</td><td>$6.82</td></tr>
                <tr><td>Pixel</td><td>agent:pixel:workflow:asset-review</td><td>41.2%</td><td>$2.09</td></tr>
                <tr><td>Rolo</td><td>agent:rolo:scheduled:heartbeat</td><td>12.8%</td><td>unreported</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className="bakin-type-direction__glyphs" aria-label="Typography stress characters">
          <span>Il1 O0 8B rn m</span><code>0123456789</code><code>{'{}[]() => !=='}</code><span>Åéñø / ≥ 99.95%</span>
        </div>
      </div>
    </article>
  )
}

function StudyIntro({ title, description }: { title: string; description: string }) {
  return (
    <header className="bakin-type-study__intro">
      <h1>{title}</h1>
      <p>{description} Product Character is approved; the alternative remains as comparison evidence. All faces are locally bundled under OFL-1.1.</p>
    </header>
  )
}

function SideBySideStudy() {
  return (
    <main className="bakin-type-study">
      <style>{STUDY_CSS}</style>
      <StudyIntro title="Typography direction study" description="Compare hierarchy, compact operational data, identifiers, numerals, long labels, and technical punctuation using identical content." />
      <div className="bakin-type-study__directions">
        <DirectionSpecimen direction="operational-neutral" />
        <DirectionSpecimen direction="product-character" />
      </div>
    </main>
  )
}

function TextScaleStudy() {
  return (
    <main className="bakin-type-study bakin-type-study--text-200">
      <style>{STUDY_CSS}</style>
      <style>{'html { font-size: 200%; }'}</style>
      <StudyIntro title="Typography at 200% text" description="Text is doubled without enlarging the viewport so reflow, wrapping, bounded tables, and action availability are visible." />
      <div className="bakin-type-study__directions">
        <DirectionSpecimen direction="operational-neutral" />
        <DirectionSpecimen direction="product-character" />
      </div>
    </main>
  )
}

function FallbackStudy() {
  return (
    <main className="bakin-type-study">
      <style>{STUDY_CSS}</style>
      <StudyIntro title="Font fallback behavior" description="Simulated missing and pre-swap loading states verify that system fallbacks preserve readable hierarchy and usable controls." />
      <div className="bakin-type-study__fallbacks">
        <DirectionSpecimen direction="operational-neutral" fallback="missing" />
        <DirectionSpecimen direction="product-character" fallback="slow" />
      </div>
    </main>
  )
}

const meta = {
  title: 'Internal/Direction studies/Typography',
  tags: ['internal'],
  parameters: {
    layout: 'fullscreen',
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'fallback-missing', 'fallback-slow'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const SideBySide: Story = { render: () => <SideBySideStudy /> }
export const TextAt200Percent: Story = { render: () => <TextScaleStudy /> }
export const FontFallbacks: Story = { render: () => <FallbackStudy /> }
