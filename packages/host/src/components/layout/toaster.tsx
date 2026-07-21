import { useToastStore } from '@makinbakin/sdk/hooks'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
} as const

const COLORS = {
  success: 'border-success/50 bg-success/80 text-white',
  error: 'border-destructive/50 bg-destructive/80 text-white',
  info: 'border-muted-foreground/50 bg-muted text-foreground',
} as const

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => {
        const Icon = ICONS[t.type]
        return (
          <div
            key={t.id}
            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 ${COLORS[t.type]}`}
          >
            <Icon className="size-4 shrink-0 mt-0.5" />
            {/* min-w-0: without it the automatic flex minimum inherits the
                width of nowrap content (e.g. the reply toast's truncated
                preview line) and the row paints past the toast's box. */}
            <div className="flex-1 min-w-0">{t.message}</div>
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
