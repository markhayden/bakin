import { cn } from '@/lib/utils'

interface PageLayoutProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function PageLayout({ title, subtitle, actions, className, children }: PageLayoutProps) {
  return (
    <div className={cn('flex flex-col flex-1 p-6', className)}>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
