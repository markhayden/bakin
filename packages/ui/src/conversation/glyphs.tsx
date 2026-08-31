'use client'

import { Avatar, AvatarFallback, AvatarImage, type AvatarSize } from '../primitives/avatar'
import { Spinner, type SpinnerSize } from '../primitives/spinner'
import { CodeBlock } from '../content/code-block'
import type { ConversationTextFormat } from './fold'

/** Minimal author identity a default avatar needs; structurally satisfied by `ConversationAgent`. */
interface GlyphAgent {
  name: string
  avatarUrl?: string
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase()
}

/** Shared avatar fallback for turn and panel headers; each call site picks its size. */
export function DefaultAvatar({ agent, size }: { agent: GlyphAgent; size: AvatarSize }) {
  return (
    <Avatar size={size}>
      {agent.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt="" /> : null}
      <AvatarFallback>{initials(agent.name)}</AvatarFallback>
    </Avatar>
  )
}

/**
 * Busy glyph on the Spinner primitive; `md` matches the icon-button footprint.
 * Accepts (and deliberately drops) `className` so it slots into icon-component
 * props like `StatusBadge`'s — exactly as the fixed-footprint glyphs it joins.
 */
export function SpinnerIcon({ size = 'sm' }: { size?: SpinnerSize; className?: string }) {
  return <Spinner size={size} className="shrink-0" />
}

export function AlertIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 shrink-0 fill-none stroke-current stroke-[1.5]">
      <path d="M8 2 14 13H2L8 2Z" strokeLinejoin="round" />
      <path d="M8 6v3.5M8 11.75v.25" strokeLinecap="round" />
    </svg>
  )
}

export function RemoveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.5]">
      <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

/** Default `ConversationTextRenderer`: code and plain via CodeBlock, markdown as safe pre-wrapped text. */
export function DefaultText({ content, format }: { content: string; format: ConversationTextFormat }) {
  if (format === 'code') return <CodeBlock code={content} label="Code output" className="max-w-full" />
  if (format === 'plain') return <CodeBlock code={content} wrap />
  return <div className="whitespace-pre-wrap break-words leading-relaxed text-bakin-text-primary">{content}</div>
}
