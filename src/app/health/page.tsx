'use client'

import { Suspense } from 'react'
import { HealthPage } from '@bakin/health/components/health-page'

export default function Page() {
  return (
    <Suspense>
      <HealthPage />
    </Suspense>
  )
}
