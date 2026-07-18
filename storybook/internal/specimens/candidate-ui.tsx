import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useEffect, useId, useRef } from 'react'

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
.bakin-action[data-tone='danger'] { border-color: var(--bakin-color-signal-danger); }
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
.bakin-field { display: grid; gap: var(--bakin-layout-space-2); min-width: 0; }
.bakin-field__label-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--bakin-layout-space-2); align-items: baseline; }
.bakin-field__label-row label, .bakin-checkbox-field__label { font-size: var(--candidate-body-size); font-weight: 600; }
.bakin-field__requirement { color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); font-weight: 400; }
.bakin-field__description, .bakin-field__message { margin: var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); line-height: 1.5; }
.bakin-field__message[data-error='true'] { border-left: 2px solid var(--bakin-color-signal-danger); padding-left: var(--bakin-layout-space-2); color: var(--bakin-color-text-primary); }
.bakin-field__control {
  width: 100%;
  min-width: 0;
  min-height: var(--candidate-control-height);
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--candidate-control-radius);
  padding: var(--bakin-layout-space-2) var(--bakin-layout-space-3);
  background: var(--bakin-color-canvas-default);
  color: var(--bakin-color-text-primary);
  font: 400 var(--candidate-body-size)/1.35 var(--candidate-font-sans);
}
textarea.bakin-field__control { min-height: calc(var(--candidate-control-height) * 2.5); resize: vertical; }
.bakin-field__control:focus-visible, .bakin-checkbox-field input:focus-visible {
  outline: 2px solid var(--bakin-color-focus-ring);
  outline-offset: 2px;
}
.bakin-field__control[aria-invalid='true'] { border-color: var(--bakin-color-signal-danger); }
.bakin-field__control:disabled { opacity: var(--bakin-state-opacity-disabled); cursor: not-allowed; }
.bakin-field__control:read-only { color: var(--bakin-color-text-muted); }
.bakin-checkbox-field { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--candidate-item-gap); align-items: start; min-width: 0; }
.bakin-checkbox-field input { width: var(--bakin-layout-space-4); height: var(--bakin-layout-space-4); margin: var(--bakin-layout-space-1) var(--bakin-layout-space-0) var(--bakin-layout-space-0); accent-color: var(--bakin-color-action-primary-background); }
.bakin-checkbox-field__copy { display: grid; gap: var(--bakin-layout-space-1); }
.bakin-checkbox-field__copy p { margin: var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); line-height: 1.5; }
.bakin-form-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--candidate-item-gap);
  padding-top: var(--candidate-section-gap);
  border-top: 1px solid var(--bakin-color-border-subtle);
}
.bakin-overlay {
  position: fixed;
  z-index: 100;
  inset: var(--bakin-layout-space-0);
  display: grid;
  place-items: center;
  overflow: auto;
  padding: var(--bakin-layout-space-4);
  background: color-mix(in srgb, var(--bakin-color-canvas-default) 78%, transparent);
}
.bakin-overlay__panel {
  display: grid;
  gap: var(--candidate-section-gap);
  width: min(100%, 32rem);
  max-height: calc(100vh - var(--bakin-layout-space-8));
  overflow: auto;
  border: 1px solid var(--bakin-color-border-subtle);
  border-radius: var(--candidate-surface-radius);
  padding: var(--candidate-section-gap);
  background: var(--bakin-color-surface-default);
  box-shadow: var(--candidate-overlay-shadow);
}
.bakin-overlay__header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--candidate-item-gap); align-items: start; }
.bakin-overlay__header h2 { margin: var(--bakin-layout-space-0); font-size: calc(var(--candidate-page-title-size) * 0.68); line-height: 1.1; }
.bakin-overlay__header p { margin: var(--bakin-layout-space-2) var(--bakin-layout-space-0) var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); line-height: 1.5; }
.bakin-overlay__close { min-width: var(--candidate-control-height); padding-inline: var(--bakin-layout-space-2); }
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
  .bakin-form-actions { position: sticky; z-index: 2; bottom: var(--bakin-layout-space-0); padding-block: var(--bakin-layout-space-3); background: var(--bakin-color-surface-default); }
  .bakin-form-actions .bakin-action { flex: 1 1 auto; }
  .bakin-overlay { place-items: end center; padding: var(--bakin-layout-space-3); }
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

export function Action({ tone = 'secondary', className, buttonRef, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'secondary' | 'danger'; buttonRef?: Ref<HTMLButtonElement> }) {
  return <button className={classes('bakin-action', className)} data-tone={tone} type="button" ref={buttonRef} {...props} />
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

interface FieldCopy {
  label: string
  description?: string
  error?: string
  optional?: boolean
}

function FieldFrame({ id, label, description, error, optional, required, children }: FieldCopy & { id: string; required?: boolean; children: ReactNode }) {
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className="bakin-field">
      <div className="bakin-field__label-row">
        <label htmlFor={id}>{label}</label>
        {(required || optional) && <span className="bakin-field__requirement">{required ? 'Required' : 'Optional'}</span>}
      </div>
      {description && <p className="bakin-field__description" id={descriptionId}>{description}</p>}
      {children}
      {error && <p className="bakin-field__message" id={errorId} data-error="true">{error}</p>}
    </div>
  )
}

export function TextField({ label, description, error, optional, id: providedId, required, readOnly, disabled, className, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, ...props }: FieldCopy & InputHTMLAttributes<HTMLInputElement>) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const describedBy = [description && `${id}-description`, error && `${id}-error`, ariaDescribedBy].filter(Boolean).join(' ') || undefined
  return (
    <FieldFrame id={id} label={label} description={description} error={error} optional={optional} required={required}>
      <input className={classes('bakin-field__control', className)} id={id} required={required} readOnly={readOnly} disabled={disabled} aria-invalid={error ? 'true' : ariaInvalid} aria-describedby={describedBy} {...props} />
    </FieldFrame>
  )
}

export function TextAreaField({ label, description, error, optional, id: providedId, required, readOnly, disabled, className, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, ...props }: FieldCopy & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const describedBy = [description && `${id}-description`, error && `${id}-error`, ariaDescribedBy].filter(Boolean).join(' ') || undefined
  return (
    <FieldFrame id={id} label={label} description={description} error={error} optional={optional} required={required}>
      <textarea className={classes('bakin-field__control', className)} id={id} required={required} readOnly={readOnly} disabled={disabled} aria-invalid={error ? 'true' : ariaInvalid} aria-describedby={describedBy} {...props} />
    </FieldFrame>
  )
}

export function SelectField({ label, description, error, optional, id: providedId, required, disabled, className, children, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, ...props }: FieldCopy & SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const describedBy = [description && `${id}-description`, error && `${id}-error`, ariaDescribedBy].filter(Boolean).join(' ') || undefined
  return (
    <FieldFrame id={id} label={label} description={description} error={error} optional={optional} required={required}>
      <select className={classes('bakin-field__control', className)} id={id} required={required} disabled={disabled} aria-invalid={error ? 'true' : ariaInvalid} aria-describedby={describedBy} {...props}>{children}</select>
    </FieldFrame>
  )
}

export function CheckboxField({ label, description, id: providedId, className, 'aria-describedby': ariaDescribedBy, ...props }: Omit<FieldCopy, 'error' | 'optional'> & InputHTMLAttributes<HTMLInputElement>) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const descriptionId = description ? `${id}-description` : undefined
  const describedBy = [descriptionId, ariaDescribedBy].filter(Boolean).join(' ') || undefined
  return (
    <div className="bakin-checkbox-field">
      <input className={className} id={id} type="checkbox" aria-describedby={describedBy} {...props} />
      <div className="bakin-checkbox-field__copy">
        <label className="bakin-checkbox-field__label" htmlFor={id}>{label}</label>
        {description && <p id={descriptionId}>{description}</p>}
      </div>
    </div>
  )
}

export function FormActions({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes('bakin-form-actions', className)} {...props}>{children}</div>
}

export function Overlay({ open, title, description, onClose, children, footer }: { open: boolean; title: string; description: string; onClose: () => void; children?: ReactNode; footer?: ReactNode }) {
  const titleId = useId()
  const descriptionId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => previousFocus?.focus()
  }, [open])
  if (!open) return null
  return (
    <div
      className="bakin-overlay"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose()
          return
        }
        if (event.key !== 'Tab' || !panelRef.current) return
        const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <section ref={panelRef} className="bakin-overlay__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <header className="bakin-overlay__header">
          <div><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div>
          <Action className="bakin-overlay__close" aria-label="Close dialog" onClick={onClose} buttonRef={closeRef}>Close</Action>
        </header>
        {children}
        {footer && <FormActions>{footer}</FormActions>}
      </section>
    </div>
  )
}
