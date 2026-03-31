interface PluginHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  meta?: React.ReactNode
}

export function PluginHeader({ title, subtitle, actions, meta }: PluginHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        {meta}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
