'use client'

import { TeamGrid } from '@/components/team/team-grid'
import { PageLayout } from '@/components/page-layout'

export default function TeamPage() {
  return (
    <PageLayout title="Team">
      <TeamGrid />
    </PageLayout>
  )
}
