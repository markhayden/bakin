'use client'

/**
 * HandoffCard — the one way Bakin hands a command to the operator when the
 * fix is theirs to run (self-healing PR1 slice 1.4c: install a runtime,
 * sign in to a provider, grant a scope, run `gh auth login`). The command is
 * shown exactly, copyable; when the host can open a terminal with it
 * prefilled, that action sits beside the copy. Never a "run it for you"
 * button — the operator runs it, in their own shell.
 */
import * as React from 'react'

import { CodeBlock } from '../content/code-block'
import { Button } from '../primitives/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../primitives/card'
import { cn } from '../utils'

export type HandoffCardHeadingLevel = 2 | 3 | 4

export interface HandoffCardProps {
  /** What the operator is being asked to do. Default: "Run this yourself". */
  title?: React.ReactNode
  /** Why, and what happens after. */
  description?: React.ReactNode
  /** The exact command — shown verbatim and copyable, never executed by Bakin. */
  command: string
  /** Where it should run, when it matters (a home, a repo). Shown, not enforced. */
  cwd?: string
  /** The command reached the clipboard — the operator took the handoff by hand. */
  onCopied?: () => void
  /**
   * Opens a terminal with the command prefilled (the host decides how, e.g.
   * the Terminal plugin's session). Omitted = copy only, which is the honest
   * state when no terminal is available here.
   */
  onOpenTerminal?: () => void
  terminalLabel?: string
  /** The terminal is being opened. */
  busy?: boolean
  /** The last attempt to open a terminal failed; the copy block still works. */
  error?: React.ReactNode
  headingLevel?: HandoffCardHeadingLevel
  className?: string
}

export function HandoffCard({
  title = 'Run this yourself',
  description,
  command,
  cwd,
  onCopied,
  onOpenTerminal,
  terminalLabel = 'Open in Terminal',
  busy = false,
  error,
  headingLevel = 3,
  className,
}: HandoffCardProps) {
  const headingId = React.useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  return (
    <Card
      role="region"
      data-slot="handoff-card"
      aria-labelledby={headingId}
      className={cn('border-bakin-border-subtle', className)}
    >
      <CardHeader>
        <CardTitle className="text-bakin-typography-size-body font-bakin-typography-weight-semibold">
          <Heading id={headingId} className="m-0 text-inherit font-inherit">
            {title}
          </Heading>
        </CardTitle>
        {description ? (
          <CardDescription className="mb-bakin-1 mt-bakin-1 max-w-3xl text-bakin-typography-size-meta leading-relaxed">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-bakin-3">
        <CodeBlock code={command} label="Command" copyable wrap onCopied={onCopied} />
        {cwd ? (
          <p className="m-0 text-bakin-typography-size-meta text-bakin-text-muted">
            Run it in <code className="font-bakin-typography-family-mono">{cwd}</code>.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-bakin-typography-size-meta text-bakin-signal-danger">{error}</p>
        ) : null}
        {onOpenTerminal ? (
          <div className="flex min-w-0 justify-start">
            <Button variant="outline" size="sm" disabled={busy} onClick={onOpenTerminal} data-handoff-terminal="">
              {busy ? 'Opening…' : terminalLabel}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
