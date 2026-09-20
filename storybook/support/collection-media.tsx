import { Grid, Inline } from '@makinbakin/sdk/layout'
import { Badge, Card, CardDescription, CardHeader, CardMedia, CardTitle } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from './index'

const brands = [
  { name: 'Daybreak Studio', mark: 'D', description: 'Editorial identity for a seasonal food journal.' },
  { name: 'Field Notes', mark: 'fn', description: 'A compact wordmark for a recipe collection.' },
] as const

export function CollectionMedia() {
  return (
    <StoryStage
      eyebrow="Card collections / preview review"
      title="Keep cards when the preview matters"
      description="Brand identity and visual assets can earn a gallery. These illustrative monograms use the existing CardMedia pattern; they are not production brand artwork."
      width="wide"
    >
      <StorySection title="Brand identities" description="The mark is part of what you browse, not decoration added to justify a card. Attached documents and version history can still use standard rows.">
        <Grid as="ul" layout="cards" gap="item" aria-label="Brand identity previews" className="m-0 list-none p-0">
          {brands.map((brand) => (
            <li key={brand.name} className="min-w-0">
              <Card className="h-full">
                <CardMedia>
                  <Inline align="center" justify="center" className="aspect-video bg-bakin-surface-elevated" aria-label={`${brand.name} monogram`} role="img">
                    <span className="text-bakin-typography-size-page-title font-bakin-typography-weight-semibold" aria-hidden="true">{brand.mark}</span>
                  </Inline>
                </CardMedia>
                <CardHeader>
                  <CardTitle>{brand.name}</CardTitle>
                  <CardDescription>{brand.description}</CardDescription>
                  <Badge size="xs" variant="solid" tone="neutral">Draft</Badge>
                </CardHeader>
              </Card>
            </li>
          ))}
        </Grid>
      </StorySection>
    </StoryStage>
  )
}
