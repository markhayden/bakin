/**
 * Projects plugin — type definitions.
 */

export type ProjectStatus = 'draft' | 'active' | 'completed' | 'archived'

export interface ProjectTask {
  id: string          // "t001", "t002" — auto-incrementing
  title: string
  description?: string
  taskId?: string     // linked board task ID (8-char hex)
  checked: boolean
}

export interface ProjectAsset {
  filename: string        // globally-unique asset filename (e.g., "20260327-hero-a1b2c3d4.png")
  label?: string          // optional human label / summary
}

export interface ProjectFrontmatter {
  id: string
  title: string
  status: ProjectStatus
  created: string
  updated: string
  owner: string
  tasks: ProjectTask[]
  assets: ProjectAsset[]
}

export interface Project extends ProjectFrontmatter {
  body: string        // markdown after frontmatter
  progress: number    // 0-100, derived from tasks
}

export interface ProjectSummary {
  id: string
  title: string
  status: ProjectStatus
  owner: string
  progress: number
  taskCount: number
  assetCount: number
  updated: string
}
