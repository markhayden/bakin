import type { ReactNode } from 'react'

interface HealthTabIntroProps {
  title: string
  description: string
  actions?: ReactNode
}

export function HealthTabIntro({
  title,
  description,
  actions,
}: HealthTabIntroProps) {
  return (
    <header
      className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3"
      data-slot="health-tab-intro"
    >
      <div className="min-w-0 flex-1 basis-80">
        <h2 className="sr-only">{title}</h2>
        <p
          className="m-0 max-w-3xl text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted"
          data-slot="health-tab-intro-description"
        >
          {description}
        </p>
      </div>
      {actions && (
        <div className="flex max-w-full flex-wrap items-center gap-bakin-2" data-slot="health-tab-intro-actions">
          {actions}
        </div>
      )}
    </header>
  )
}
