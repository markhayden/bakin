import { SearchX } from 'lucide-react'
import { PluginLink } from '@makinbakin/sdk/components'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SearchUnavailableProps {
  /** Re-run the query that hit the unavailable state. */
  retry?: () => void
  className?: string
}

/**
 * Honest engine-down state (spec D11): search UIs show THIS — never a
 * silent client-side fallback whose quality degrades invisibly. Browse
 * and filter views keep working; only search is down.
 */
export function SearchUnavailable({ retry, className }: SearchUnavailableProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)} data-testid="search-unavailable">
      <div className="mb-4 rounded-full bg-amber-500/10 p-3">
        <SearchX className="size-6 text-amber-500" />
      </div>
      <h3 className="text-sm font-medium text-foreground">Search is unavailable</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm">
        The search engine is not responding. Browsing and filters still work while it recovers.
      </p>
      <div className="mt-4 flex items-center gap-2">
        {retry && (
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        )}
        <PluginLink
          to="/health"
          className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Open health
        </PluginLink>
      </div>
    </div>
  )
}
