import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-6 flex flex-col flex-1">
      <div className="mb-6">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-3 w-48 mt-1" />
      </div>
      <div className="flex gap-8">
        <div className="w-40 space-y-2">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-7 w-full rounded-md" />
          ))}
        </div>
        <div className="flex-1 max-w-lg space-y-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-3/4 rounded-md" />
        </div>
      </div>
    </div>
  )
}
