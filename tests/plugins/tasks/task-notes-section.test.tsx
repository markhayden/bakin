// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { useState } from 'react'
import '../../rtl-settle'

import { TaskNotesSection } from '../../../plugins/tasks/components/task-notes-section'
import type { Task } from '../../../plugins/tasks/types'

afterEach(() => document.body.replaceChildren())

function NotesHarness({ onAddLog }: { onAddLog: () => void }) {
  const [message, setMessage] = useState('')
  const task = { id: 'task-1', title: 'Test task', checked: false, log: [] } as Task

  return (
    <TaskNotesSection
      task={task}
      logMessage={message}
      setLogMessage={setMessage}
      addingLog={false}
      onAddLog={onAddLog}
      showAllNotes={false}
      setShowAllNotes={() => {}}
    />
  )
}

describe('TaskNotesSection', () => {
  it('encapsulates the note field and its local submit action in one input group', () => {
    const onAddLog = mock(() => {})
    render(<NotesHarness onAddLog={onAddLog} />)

    const input = screen.getByRole('textbox', { name: 'Task note' })
    const submit = screen.getByRole('button', { name: 'Add note' })
    const group = input.closest('[data-slot="input-group"]')

    expect(group).toBeTruthy()
    expect(group?.contains(submit)).toBe(true)
    expect(submit.getAttribute('type')).toBe('submit')
    expect(submit.className).toContain('size-bakin-6')
    expect(submit).toHaveProperty('disabled', true)

    fireEvent.change(input, { target: { value: 'Follow up with the owner' } })
    expect(submit).toHaveProperty('disabled', false)
    fireEvent.click(submit)
    expect(onAddLog).toHaveBeenCalledTimes(1)
  })
})
