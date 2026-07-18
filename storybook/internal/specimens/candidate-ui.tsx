import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from 'react'
import { useId } from 'react'

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

import directionConfig from '../../../design-system/specimens/visual-direction-candidates.json'

export type DirectionId = 'operational-neutral' | 'product-character'
export type SystemStateKind =
  | 'loading'
  | 'initial-empty'
  | 'filtered-no-results'
  | 'error'
  | 'permission-denied'
  | 'success'

export const CANDIDATE_UI_CSS = `
.bakin-candidate-study {
  min-height: 100vh;
  padding: var(--bakin-layout-space-6);
  background: var(--bakin-color-canvas-default);
  color: var(--bakin-color-text-primary);
}
.bakin-candidate-study, .bakin-candidate-study * { box-sizing: border-box; }
.bakin-candidate-study__intro {
  width: min(100%, 88rem);
  margin: var(--bakin-layout-space-0) auto var(--bakin-layout-space-6);
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}
.bakin-candidate-study__intro h1 {
  margin: var(--bakin-layout-space-0);
  font-size: clamp(1.75rem, 5vw, 3.25rem);
  font-weight: 600;
  line-height: 1.04;
  letter-spacing: -0.04em;
}
.bakin-candidate-study__intro p {
  max-width: 64rem;
  margin: var(--bakin-layout-space-2) var(--bakin-layout-space-0) var(--bakin-layout-space-0);
  color: var(--bakin-color-text-muted);
  font-size: 0.88rem;
  line-height: 1.6;
}
.bakin-candidate-study__directions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--bakin-layout-space-4);
  width: min(100%, 88rem);
  margin: var(--bakin-layout-space-0) auto;
  align-items: start;
}
.bakin-candidate-study__directions--single { grid-template-columns: minmax(0, 1fr); max-width: 68rem; }
.bakin-candidate-direction {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--candidate-surface-radius);
  background: var(--bakin-color-surface-default);
  font-family: var(--candidate-font-sans);
  font-size: var(--candidate-body-size);
}
.bakin-candidate-direction__label {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--bakin-layout-space-2);
  padding: var(--bakin-layout-space-3) var(--bakin-layout-space-4);
  border-bottom: 1px solid var(--bakin-color-border-subtle);
}
.bakin-candidate-direction__label strong { font-size: var(--candidate-body-size); }
.bakin-candidate-direction__label span { color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); }
.bakin-page-shell { display: grid; gap: var(--candidate-page-gap); padding: var(--candidate-page-gap); }
.bakin-stack { display: grid; gap: var(--candidate-section-gap); min-width: 0; }
.bakin-stack[data-gap='item'] { gap: var(--candidate-item-gap); }
.bakin-stack[data-gap='page'] { gap: var(--candidate-page-gap); }
.bakin-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--candidate-item-gap);
  min-width: 0;
}
.bakin-inline[data-align='between'] { justify-content: space-between; }
.bakin-grid { display: grid; grid-template-columns: repeat(var(--bakin-grid-columns, 2), minmax(0, 1fr)); gap: var(--candidate-item-gap); }
.bakin-section { min-width: 0; }
.bakin-section__heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: end;
  gap: var(--candidate-item-gap);
  margin-bottom: var(--candidate-item-gap);
}
.bakin-section__heading h2 {
  margin: var(--bakin-layout-space-0);
  font-size: var(--candidate-section-title-size);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.bakin-section__heading p {
  margin: var(--bakin-layout-space-1) var(--bakin-layout-space-0) var(--bakin-layout-space-0);
  color: var(--bakin-color-text-muted);
  font-size: var(--candidate-meta-size);
  line-height: 1.5;
}
.bakin-bounded-overflow {
  max-width: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--candidate-control-radius);
}
.bakin-bounded-overflow:focus-visible,
.bakin-action:focus-visible {
  outline: 2px solid var(--bakin-color-focus-ring);
  outline-offset: 2px;
}
.bakin-action {
  min-height: var(--candidate-control-height);
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--candidate-control-radius);
  padding: var(--bakin-layout-space-0) var(--bakin-layout-space-3);
  background: transparent;
  color: var(--bakin-color-text-primary);
  font: 600 var(--candidate-meta-size)/1 var(--candidate-font-sans);
  cursor: pointer;
}
.bakin-action[data-tone='primary'] {
  border-color: var(--bakin-color-action-primary-background);
  background: var(--bakin-color-action-primary-background);
  color: var(--bakin-color-action-primary-foreground);
}
.bakin-action[aria-pressed='true'] { border-color: var(--bakin-color-signal-accent); }
.bakin-action:disabled { cursor: not-allowed; opacity: var(--bakin-state-opacity-disabled); }
.bakin-status { display: inline-flex; align-items: center; gap: var(--bakin-layout-space-2); min-width: 0; }
.bakin-status::before {
  flex: 0 0 auto;
  width: var(--bakin-layout-space-2);
  height: var(--bakin-layout-space-2);
  border-radius: var(--bakin-radius-pill);
  background: var(--bakin-color-action-primary-background);
  content: '';
}
.bakin-status[data-tone='attention']::before { background: var(--bakin-color-signal-highlight); }
.bakin-status[data-tone='danger']::before { background: var(--bakin-color-signal-danger); }
.bakin-status[data-tone='accent']::before { background: var(--bakin-color-signal-accent); }
.bakin-status[data-tone='muted']::before { background: var(--bakin-color-border-subtle); }
.bakin-system-state {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--candidate-item-gap);
  align-items: center;
  min-width: 0;
  padding: var(--candidate-section-gap) var(--bakin-layout-space-0);
  border-block: 1px solid var(--bakin-color-border-subtle);
}
.bakin-system-state__signal {
  width: var(--bakin-layout-space-2);
  height: 100%;
  min-height: var(--candidate-control-height);
  border-radius: var(--bakin-radius-pill);
  background: var(--bakin-color-border-subtle);
}
.bakin-system-state[data-kind='loading'] .bakin-system-state__signal,
.bakin-system-state[data-kind='success'] .bakin-system-state__signal { background: var(--bakin-color-action-primary-background); }
.bakin-system-state[data-kind='filtered-no-results'] .bakin-system-state__signal { background: var(--bakin-color-signal-highlight); }
.bakin-system-state[data-kind='error'] .bakin-system-state__signal,
.bakin-system-state[data-kind='permission-denied'] .bakin-system-state__signal { background: var(--bakin-color-signal-danger); }
.bakin-system-state h3 { margin: var(--bakin-layout-space-0); font-size: var(--candidate-body-size); }
.bakin-system-state p { margin: var(--bakin-layout-space-1) var(--bakin-layout-space-0) var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); line-height: 1.5; }
@media (max-width: 56rem) {
  .bakin-candidate-study { padding: var(--bakin-layout-space-4); }
  .bakin-candidate-study__directions { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 24rem) {
  .bakin-candidate-study { padding: var(--bakin-layout-space-3); }
  .bakin-page-shell { padding: var(--bakin-layout-space-3); }
  .bakin-grid { grid-template-columns: minmax(0, 1fr); }
  .bakin-system-state { grid-template-columns: auto minmax(0, 1fr); align-items: start; }
  .bakin-system-state .bakin-action { grid-column: 2; justify-self: start; }
}
`.trim()

const styleKeys = {
  fontSans: '--candidate-font-sans',
  fontMono: '--candidate-font-mono',
  pageGap: '--candidate-page-gap',
  sectionGap: '--candidate-section-gap',
  itemGap: '--candidate-item-gap',
  surfaceRadius: '--candidate-surface-radius',
  controlRadius: '--candidate-control-radius',
  pageTitleSize: '--candidate-page-title-size',
  sectionTitleSize: '--candidate-section-title-size',
  bodySize: '--candidate-body-size',
  metaSize: '--candidate-meta-size',
  controlHeight: '--candidate-control-height',
  rowMinHeight: '--candidate-row-min-height',
  overlayShadow: '--candidate-overlay-shadow',
} as const

function directionStyle(direction: DirectionId): CSSProperties {
  const configured = directionConfig.directions.find((candidate) => candidate.id === direction)
  if (!configured) throw new Error(`Unknown visual direction ${direction}`)
  return Object.fromEntries(
    Object.entries(styleKeys).map(([token, property]) => [property, configured.tokens[token as keyof typeof configured.tokens]]),
  ) as CSSProperties
}

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base
}

export function CandidateStyles({ css }: { css?: string }) {
  return <style>{`${CANDIDATE_UI_CSS}\n${css ?? ''}`}</style>
}

export function CandidateIntro({ title, children }: { title: string; children: ReactNode }) {
  return <header className="bakin-candidate-study__intro"><h1>{title}</h1><p>{children}</p></header>
}

export function CandidateDirection({ direction, children }: { direction: DirectionId; children: ReactNode }) {
  const configured = directionConfig.directions.find((candidate) => candidate.id === direction)
  if (!configured) throw new Error(`Unknown visual direction ${direction}`)
  return (
    <article className="bakin-candidate-direction" data-direction={direction} style={directionStyle(direction)} aria-label={`${configured.label} direction`}>
      <header className="bakin-candidate-direction__label">
        <strong>{configured.label}</strong>
        <span>{configured.composition} Candidate, not selected.</span>
      </header>
      {children}
    </article>
  )
}

export function PageShell({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes('bakin-page-shell', className)} {...props}>{children}</div>
}

export function Stack({ children, className, gap = 'section', ...props }: HTMLAttributes<HTMLDivElement> & { gap?: 'item' | 'section' | 'page' }) {
  return <div className={classes('bakin-stack', className)} data-gap={gap} {...props}>{children}</div>
}

export function Inline({ children, className, align = 'start', ...props }: HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'between' }) {
  return <div className={classes('bakin-inline', className)} data-align={align} {...props}>{children}</div>
}

export function Grid({ children, className, columns = 2, style, ...props }: HTMLAttributes<HTMLDivElement> & { columns?: number }) {
  return <div className={classes('bakin-grid', className)} style={{ '--bakin-grid-columns': columns, ...style } as CSSProperties} {...props}>{children}</div>
}

export function Section({ title, description, actions, children, className, ...props }: HTMLAttributes<HTMLElement> & { title: string; description?: string; actions?: ReactNode }) {
  const headingId = useId()
  return (
    <section className={classes('bakin-section', className)} aria-labelledby={headingId} {...props}>
      <header className="bakin-section__heading">
        <div><h2 id={headingId}>{title}</h2>{description && <p>{description}</p>}</div>
        {actions}
      </header>
      {children}
    </section>
  )
}

export function BoundedOverflow({ label, children, className, ...props }: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return <div className={classes('bakin-bounded-overflow', className)} role="region" aria-label={label} tabIndex={0} {...props}>{children}</div>
}

export function Action({ tone = 'secondary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'secondary' }) {
  return <button className={classes('bakin-action', className)} data-tone={tone} type="button" {...props} />
}

export function Status({ tone = 'positive', children }: { tone?: 'positive' | 'attention' | 'danger' | 'accent' | 'muted'; children: ReactNode }) {
  return <span className="bakin-status" data-tone={tone}>{children}</span>
}

export function SystemState({ kind, title, description, action }: { kind: SystemStateKind; title: string; description: string; action?: ReactNode }) {
  const role = kind === 'error' || kind === 'permission-denied' ? 'alert' : 'status'
  return (
    <section className="bakin-system-state" data-kind={kind} role={role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
      <span className="bakin-system-state__signal" aria-hidden="true" />
      <div><h3>{title}</h3><p>{description}</p></div>
      {action}
    </section>
  )
}
