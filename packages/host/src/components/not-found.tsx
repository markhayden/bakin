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
import { buttonVariants, SystemState } from '@makinbakin/sdk/ui'

export function NotFoundPage() {
  const location = useLocation()
  return (
    <div className="flex h-full flex-col items-center justify-center p-6" data-testid="not-found">
      <SystemState
        kind="error"
        scope="page"
        announce="off"
        icon={<Compass className="size-6" aria-hidden="true" />}
        title="Page not found"
        description={<><code className="break-all text-xs">{location.pathname}</code> doesn&apos;t match any page or installed plugin route.</>}
        action={
          <Link to="/tasks" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Back to Tasks
          </Link>
        }
      />
    </div>
  )
}
