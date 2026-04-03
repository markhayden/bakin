'use client'

import { ProjectStatusBadge } from './project-status-badge'
import type { ProjectSummary } from '../types'

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div
        className="h-full rounded-full bg-blue-500 transition-all duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ProjectCard({ project, onClick }: { project: ProjectSummary; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left w-full rounded-lg border border-border bg-card p-4 hover:bg-[rgba(255,255,255,0.04)] transition-colors group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-sm font-medium text-foreground group-hover:text-white line-clamp-2">
          {project.title || 'Untitled project'}
        </h3>
        <ProjectStatusBadge status={project.status} />
      </div>

      <ProgressBar value={project.progress} />

      <div className="flex items-center justify-between mt-3 text-[11px] text-muted-foreground">
        <span>{project.progress}% complete</span>
        <span>{project.taskCount} items</span>
      </div>

      <div className="text-[11px] text-muted-foreground mt-1">
        Updated {formatDate(project.updated)}
      </div>
    </button>
  )
}
