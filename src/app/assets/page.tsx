'use client'

import { Suspense } from 'react'
import { AssetsPage } from '@/components/assets/assets-page'

export default function Assets() {
  return (
    <Suspense>
      <AssetsPage />
    </Suspense>
  )
}
