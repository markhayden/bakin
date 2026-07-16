/**
 * NotFound — the app's real 404 (routing overhaul PR3, task 3.4).
 *
 * Rendered by the `$` catch-all when no plugin route claims the path (so
 * it appears INSIDE the shell — sidebar and header stay usable) and
 * registered as the router's defaultNotFoundComponent as a backstop for
 * notFound() thrown in loaders.
 */
import { Link, useLocation } from '@tanstack/react-router'
import { Compass } from 'lucide-react'

export function NotFoundPage() {
  const location = useLocation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-testid="not-found">
      <div className="rounded-full bg-muted p-3">
        <Compass className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h1 className="text-sm font-medium text-foreground">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        <code className="break-all text-xs">{location.pathname}</code> doesn&apos;t match any page or installed plugin route.
      </p>
      <Link
        to="/tasks"
        className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        Back to Tasks
      </Link>
    </div>
  )
}
