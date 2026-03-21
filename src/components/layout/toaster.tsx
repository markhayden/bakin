'use client'

import { useToastStore } from '@/hooks/use-toast'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
} as const

const COLORS = {
  success: 'border-green-500/30 bg-green-500/10 text-green-400',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-accent/30 bg-accent/10 text-accent',
} as const

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => {
        const Icon = ICONS[t.type]
        return (
          <div
            key={t.id}
            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 ${COLORS[t.type]}`}
          >
            <Icon className="size-4 shrink-0 mt-0.5" />
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
