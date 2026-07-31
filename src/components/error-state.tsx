import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  title?: string
  message: string
  retry?: () => void
  className?: string
}

export function ErrorState({ title = 'Something went wrong', message, retry, className }: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      <div className="mb-4 rounded-full bg-bakin-signal-danger/10 p-3">
        <AlertCircle className="size-6 text-bakin-signal-danger" />
      </div>
      <h3 className="text-sm font-medium text-bakin-text-primary">{title}</h3>
      <p className="mt-1 text-sm text-bakin-text-muted max-w-sm">{message}</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry} className="mt-4">
          Try again
        </Button>
      )}
    </div>
  )
}
