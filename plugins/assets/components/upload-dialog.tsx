'use client'

import { useState, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
import { Upload, X, FileText, Image, Video, Music, Map, Database, Package, Loader2 } from 'lucide-react'
import { toast } from "@makinbakin/sdk/hooks"

const TYPE_ICONS: Record<string, typeof FileText> = {
  text: FileText,
  images: Image,
  video: Video,
  audio: Music,
  plans: Map,
  data: Database,
  other: Package,
}

const EXTENSION_TO_TYPE: Record<string, string> = {
  '.md': 'text', '.txt': 'text', '.rtf': 'text',
  '.png': 'images', '.jpg': 'images', '.jpeg': 'images', '.gif': 'images', '.webp': 'images', '.svg': 'images',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.avi': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.ogg': 'audio',
  '.yaml': 'plans', '.yml': 'plans',
  '.json': 'data', '.csv': 'data', '.xml': 'data',
  '.pdf': 'other',
}

function detectType(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase()
  return EXTENSION_TO_TYPE[ext] || 'other'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface QueuedFile {
  file: File
  type: string
}

interface UploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTaskId?: string
}

export function UploadDialog({ open, onOpenChange, defaultTaskId }: UploadDialogProps) {
  const [files, setFiles] = useState<QueuedFile[]>([])
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [taskId, setTaskId] = useState(defaultTaskId || '')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const queued: QueuedFile[] = Array.from(newFiles).map(file => ({
      file,
      type: detectType(file.name),
    }))
    setFiles(prev => [...prev, ...queued])
  }, [])

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }, [addFiles])

  const handleUpload = async () => {
    if (files.length === 0) return
    setUploading(true)

    let successCount = 0
    let failCount = 0

    for (const { file } of files) {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('source', 'upload')
      if (taskId) formData.append('taskId', taskId)
      if (description) formData.append('description', description)
      if (tags) formData.append('tags', tags)

      try {
        const res = await fetch('/api/plugins/assets/upload', { method: 'POST', body: formData })
        if (res.ok) {
          successCount++
        } else {
          const data = await res.json().catch(() => ({ error: 'Upload failed' }))
          toast(`Failed to upload "${file.name}": ${data.error}`, 'error')
          failCount++
        }
      } catch {
        toast(`Failed to upload "${file.name}"`, 'error')
        failCount++
      }
    }

    setUploading(false)

    if (successCount > 0) {
      toast(`Uploaded ${successCount} file${successCount > 1 ? 's' : ''}`, 'success')
    }

    // Close on full success
    if (failCount === 0) {
      setFiles([])
      setDescription('')
      setTags('')
      setTaskId(defaultTaskId || '')
      onOpenChange(false)
    }
  }

  const handleClose = (isOpen: boolean) => {
    if (!isOpen && !uploading) {
      setFiles([])
      setDescription('')
      setTags('')
      setTaskId(defaultTaskId || '')
    }
    if (!uploading) onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Assets</DialogTitle>
        </DialogHeader>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors ${
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50'
          }`}
        >
          <Upload className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop files here or <span className="text-primary font-medium">browse</span>
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
            {files.map((qf, i) => {
              const Icon = TYPE_ICONS[qf.type] || Package
              return (
                <div key={i} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded bg-muted/50">
                  <Icon className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{qf.file.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatSize(qf.file.size)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Optional fields */}
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Task ID (optional)</label>
            <Input
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              placeholder="Link to a task..."
              className="bg-surface"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Description (optional)</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are these files?"
              className="bg-surface"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tags (optional, comma-separated)</label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="reference, design, brief"
              className="bg-surface"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={files.length === 0 || uploading}>
            {uploading ? (
              <>
                <Loader2 className="size-4 animate-spin mr-1.5" />
                Uploading...
              </>
            ) : (
              `Upload ${files.length > 0 ? `(${files.length})` : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
