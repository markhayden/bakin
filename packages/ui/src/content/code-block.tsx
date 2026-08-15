'use client'

import * as React from 'react'

import { CopyButton } from '../patterns/copy-button'
import { cn } from '../utils'

export type CodeBlockLanguage = 'json' | 'text'

export interface CodeBlockProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Exact source to render. Never truncated or reflowed by this component. */
  code: string
  /**
   * `json` tokenizes keys, strings, numbers, and keyword literals. Anything
   * else renders verbatim in the mono frame — an unknown language is shown
   * honestly rather than mis-highlighted.
   */
  language?: CodeBlockLanguage
  /**
   * Names the block. A scrollable block becomes a focusable group carrying
   * this name; a wrapped block needs no name because it has no scroll region
   * to reach. Also used for the copy action's label.
   */
  label?: string
  /** Adds a copy action for the exact source. */
  copyable?: boolean
  /** Wraps long lines instead of scrolling horizontally. */
  wrap?: boolean
}

type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'plain'

const TOKEN_CLASSES: Record<TokenKind, string> = {
  key: 'text-bakin-syntax-key',
  string: 'text-bakin-syntax-string',
  number: 'text-bakin-syntax-number',
  literal: 'text-bakin-syntax-literal',
  plain: 'text-bakin-text-muted',
}

// Strings (with escapes), numbers, keyword literals, everything else. A key is
// a string immediately followed by a colon, which the consumer of this regex
// resolves by lookahead — enough for JSON without pulling in a parser.
const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g

interface Token {
  kind: TokenKind
  text: string
}

/**
 * Split JSON into display tokens. Returns a single plain token when the input
 * is not parseable, so malformed payloads still render exactly as received
 * rather than being silently mangled by a partial highlight.
 */
export function tokenizeJson(source: string): Token[] {
  try {
    JSON.parse(source)
  } catch {
    return [{ kind: 'plain', text: source }]
  }

  const tokens: Token[] = []
  let last = 0
  for (const match of source.matchAll(JSON_TOKEN)) {
    const index = match.index ?? 0
    if (index > last) tokens.push({ kind: 'plain', text: source.slice(last, index) })
    const [, str, colon, num, literal] = match
    if (str !== undefined) {
      tokens.push({ kind: colon ? 'key' : 'string', text: str })
      if (colon) tokens.push({ kind: 'plain', text: colon })
    } else if (num !== undefined) {
      tokens.push({ kind: 'number', text: num })
    } else if (literal !== undefined) {
      tokens.push({ kind: 'literal', text: literal })
    }
    last = index + match[0].length
  }
  if (last < source.length) tokens.push({ kind: 'plain', text: source.slice(last) })
  return tokens
}

/**
 * The one surface for rendering code and structured data.
 *
 * Highlighting is a property of this component rather than something each
 * consumer paints, so every code surface stays legible and consistent. Colors
 * come from the syntax token family, which is contrast-validated as normal
 * text — highlighting must never trade readability for decoration.
 */
export function CodeBlock({
  className,
  code,
  copyable = false,
  label,
  language = 'text',
  wrap = false,
  ...props
}: CodeBlockProps) {
  const tokens = React.useMemo(
    () => (language === 'json' ? tokenizeJson(code) : null),
    [code, language],
  )

  return (
    <div
      {...props}
      data-slot="code-block"
      data-language={language}
      className={cn(
        'relative min-w-0 rounded-bakin-control bg-bakin-canvas-default p-bakin-3',
        className,
      )}
    >
      {copyable ? (
        <CopyButton
          text={code}
          label={label ? `Copy ${label}` : 'Copy code'}
          className="absolute end-bakin-2 top-bakin-2"
        />
      ) : null}
      {/* A bare <pre> maps to ARIA `generic`, where naming is prohibited — an
          aria-label there is silently discarded. A scrollable region also has
          to be keyboard-reachable (WCAG 2.1.1), so when it can scroll it
          becomes a focusable, named group. */}
      <pre
        role={wrap ? undefined : 'group'}
        tabIndex={wrap ? undefined : 0}
        aria-label={wrap ? undefined : (label ?? 'Code')}
        className={cn(
          'm-0 min-w-0 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-primary',
          wrap
            ? 'whitespace-pre-wrap break-words'
            : 'overflow-x-auto focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
          copyable && 'pe-bakin-8',
        )}
      >
        {tokens
          ? tokens.map((token, index) => (
              <span key={index} className={TOKEN_CLASSES[token.kind]}>{token.text}</span>
            ))
          : code}
      </pre>
    </div>
  )
}
