import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorBannerProps {
  message: string
  onRetry?: () => void
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-bakin-signal-danger/20 bg-bakin-signal-danger/10 px-4 py-3">
      <AlertCircle className="size-4 text-bakin-signal-danger shrink-0" />
      <span className="text-sm text-bakin-signal-danger flex-1">{message}</span>
      {onRetry && (
        <Button variant="outline" size="xs" onClick={onRetry}>Retry</Button>
      )}
    </div>
  )
}
