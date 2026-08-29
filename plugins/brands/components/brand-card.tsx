/**
 * Cover-art brand card (UX cleanup spec §5, layout B): tinted logo cover with
 * the palette as its base edge, then name/status/completeness/meta. The
 * brand's OWN colors are the only strong color — chrome stays neutral.
 */
import { PluginLink } from '@makinbakin/sdk/navigation'
import { StatusBadge } from '@makinbakin/sdk/patterns'
import { Avatar, AvatarFallback, Card, CardAction, CardContent, CardHeader, CardMedia, CardTitle, Text } from '@makinbakin/sdk/ui'
import { Progress, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@makinbakin/sdk/ui'
import type { BrandManifest } from '../types'

export type ListedBrand = BrandManifest & {
  counts?: { guidelines: number; lessons: number; assets: number }
  completeness?: { percent: number; missing: string[] }
}

/**
 * Human labels for completeness keys. The keys are a server contract pinned by
 * tests/plugins/brands/completeness.test.ts — a new key must be added here too.
 */
export const COMPLETENESS_LABELS: Record<string, string> = {
  logo: 'a logo',
  palette: 'at least 3 colors',
  description: 'a description',
  voice: 'the voice guide',
  'style-guide': 'the style guide',
  rules: 'a rule',
  terminology: 'terminology',
  'reference-assets': 'reference assets',
}

const isHex = (h: string) => /^#[0-9a-fA-F]{6}$/.test(h)

/** Initials-on-tinted-disc fallback when a brand has no logo (AgentAvatar convention). */
export function Monogram({ name, tint, size = 'lg' }: { name: string; tint?: string; size?: 'sm' | 'lg' }) {
  return (
    <Avatar size={size === 'lg' ? 'xl' : 'lg'} data-brand-monogram>
      <AvatarFallback
        className="text-bakin-text-primary"
        style={tint ? { backgroundColor: `${tint}33` } : undefined}
      >
        {(name.trim()[0] ?? '?').toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

export function BrandCoverCard({ brand }: { brand: ListedBrand }) {
  const swatches = brand.palette.filter((c) => isHex(c.hex))
  const primary = swatches[0]?.hex
  const logo = brand.logos[0]
  const completeness = brand.completeness

  return (
    <Card
      className="h-full"
      interactive={{
        label: `Open ${brand.name}`,
        render: <PluginLink to={`/brands/${encodeURIComponent(brand.id)}`} />,
      }}
      data-brand-card={brand.id}
    >
      {/* Cover + palette strip: one full-bleed media unit. */}
      <CardMedia>
        {/* Cover: ambient tint from the brand's primary color, logo centered. */}
        <div
          className="flex h-28 items-center justify-center"
          style={primary ? { backgroundColor: `${primary}1f` } : undefined}
        >
          {logo ? (
            <img
              src={`/api/assets/${logo.assetId}`}
              alt=""
              className="max-h-16 max-w-1/2 object-contain drop-shadow-sm"
              data-brand-logo
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <Monogram name={brand.name} tint={primary} />
          )}
        </div>
        {/* Palette strip = the cover's base edge. */}
        <div className="flex h-bakin-2">
          {swatches.length > 0 ? (
            swatches.map((c, i) => (
              <div key={`${c.name}-${i}`} style={{ backgroundColor: c.hex, flexGrow: swatches.length - i }}>
                <span className="sr-only">{c.name} {c.hex}</span>
              </div>
            ))
          ) : (
            <div className="w-full bg-bakin-border-subtle/40" />
          )}
        </div>
      </CardMedia>

      <CardHeader>
        <CardTitle className="truncate">{brand.name}</CardTitle>
        <CardAction>
          <StatusBadge tone={brand.draft ? 'attention' : 'success'} className="shrink-0">
            {brand.draft ? 'Draft' : 'Published'}
          </StatusBadge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex-1 space-y-bakin-2" data-brand-card-body>
        {brand.description ? (
          <Text size="body" tone="muted" as="p" className="line-clamp-2">{brand.description}</Text>
        ) : (
          <Text size="body" tone="muted" as="p">No description yet.</Text>
        )}

        {completeness && (
          <TooltipProvider delay={200}>
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="flex items-center gap-bakin-2" tabIndex={0} data-brand-completeness={completeness.percent}>
                  <Progress
                    value={completeness.percent}
                    className="flex-1"
                    aria-label={`Brand kit ${completeness.percent}% complete`}
                  />
                  <Text size="meta" tone="muted" className="shrink-0 tabular-nums">
                    {completeness.percent}% complete
                  </Text>
                </div>
              }
            />
            <TooltipContent side="bottom" className="max-w-64">
              {completeness.missing.length === 0
                ? 'Kit complete — every checklist item is filled in.'
                : `Still missing: ${completeness.missing.map((k) => COMPLETENESS_LABELS[k] ?? k).join(', ')}.`}
            </TooltipContent>
          </Tooltip>
          </TooltipProvider>
        )}

        {brand.counts && (
          <Text size="meta" tone="muted" as="p">
            {brand.counts.guidelines} docs · {brand.counts.lessons} lessons · {brand.counts.assets} assets
            {brand.source ? ' · imported' : ''}
          </Text>
        )}
      </CardContent>
    </Card>
  )
}
