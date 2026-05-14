'use client'

import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react'
import { Loader2, Send } from 'lucide-react'
import { AgentSelect } from '@makinbakin/sdk/components'
import { useAutoGrow } from './use-auto-grow'
import type { BrainstormStatus } from './use-brainstorm-state'

export interface InputRowHandle {
  focus: () => void
}

interface InputRowProps {
  placeholder: string
  disabled: boolean
  status: BrainstormStatus
  maxInputHeight: number
  agentId?: string
  onAgentChange?: (agentId: string) => void
  onSubmit: (text: string) => void | Promise<void>
  onAbort: () => void
}

export const InputRow = forwardRef<InputRowHandle, InputRowProps>(function InputRow(
  { placeholder, disabled, status, maxInputHeight, agentId, onAgentChange, onSubmit, onAbort },
  ref,
) {
  const [value, setValue] = useState('')
  const taRef = useAutoGrow(value, maxInputHeight)
  const composingRef = useRef(false)

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
  }))

  const busy = status !== 'idle'
  const hasText = value.trim().length > 0
  const canSend = !disabled && !busy && hasText
  // Button is hidden until the user starts typing (or a send is in flight,
  // where the spinner doubles as live feedback). Matches the claude.ai
  // pattern — keeps the empty state tidy.
  const showSendButton = hasText || busy

  const handleSend = () => {
    if (!canSend) return
    const toSend = value
    setValue('')
    onSubmit(toSend)
  }

  const isSendKey = (e: KeyboardEvent<HTMLTextAreaElement>) =>
    e.key === 'Enter' && !e.shiftKey && !composingRef.current

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return
    if (e.key === 'Escape' && busy) {
      e.preventDefault()
      onAbort()
      return
    }
    if (!isSendKey(e)) return
    e.preventDefault()
    handleSend()
  }

  return (
    <div className="flex items-stretch gap-2 shrink-0">
      {onAgentChange && agentId && (
        <AgentSelect
          value={agentId}
          onValueChange={onAgentChange}
          className="h-8 w-auto min-w-[130px] text-[11px] bg-zinc-900/60 border-[rgba(255,255,255,0.06)] shrink-0 self-start"
        />
      )}
      <div className="flex-1 min-w-0 relative flex">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={2}
          disabled={disabled}
          style={{ width: '100%' }}
          className="text-sm bg-zinc-900/60 border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-2 pr-11 text-foreground placeholder:text-zinc-500 focus:outline-none focus:border-[#5e6ad2]/40 transition-colors min-h-[60px] resize-none block disabled:opacity-60"
        />
        {showSendButton && (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send"
            className="absolute bottom-2 right-2 size-7 rounded-md flex items-center justify-center bg-[#5e6ad2] text-white hover:bg-[#6e7ae2] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm shadow-[#5e6ad2]/30"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </button>
        )}
      </div>
    </div>
  )
})
