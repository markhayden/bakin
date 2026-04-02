'use client'

import { Suspense } from 'react'
import { AssetsPage } from '@bakin/assets/components/assets-page'

export default function Assets() {
  return (
    <Suspense>
      <AssetsPage />
    </Suspense>
  )
}
