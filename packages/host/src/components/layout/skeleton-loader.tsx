import { useContentStore } from '@makinbakin/sdk/hooks'
import { Skeleton } from '@/components/ui/skeleton'

/** Full-page skeleton while initial data loads */
export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-3 w-32" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-lg border border-border bg-surface p-3 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Wrap a page component — shows skeleton until data loads */
export function WithLoading({ children }: { children: React.ReactNode }) {
  const loading = useContentStore((s) => s.loading)
  if (loading) return <PageSkeleton />
  return <>{children}</>
}
