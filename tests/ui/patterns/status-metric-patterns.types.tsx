import { StatTile, StatusBadge } from '@makinbakin/sdk/patterns'

export const validStatusMetricPatterns = (
  <>
    <StatusBadge tone="attention" variant="outline">Needs review</StatusBadge>
    <StatTile
      label="Coverage"
      value="91%"
      valueTone="success"
      progress={{ percent: 91, tone: 'success', label: 'Coverage' }}
    />
  </>
)

// @ts-expect-error focused status tones use the canonical attention vocabulary
export const invalidLegacyStatusTone = <StatusBadge tone="warning">Review</StatusBadge>
// @ts-expect-error metric progress tones use the canonical danger vocabulary
export const invalidLegacyProgressTone = <StatTile label="Failures" value={3} progress={{ percent: 60, tone: 'destructive' }} />
// @ts-expect-error metric variants are finite
export const invalidMetricVariant = <StatTile label="Tasks" value={42} variant="card" />
