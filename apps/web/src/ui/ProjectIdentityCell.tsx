import React from 'react'
import { TextInput, Tooltip, ActionIcon } from '@mantine/core'
import { IconPencil, IconCheck, IconAlertCircle, IconLoader2 } from '@tabler/icons-react'

type CanvasSaveState = 'idle' | 'dirty' | 'saving' | 'failed'

type Props = {
  projectName: string
  canEdit: boolean
  onRename: (next: string) => Promise<void>
  canvasSaveState: CanvasSaveState
}

type NameSaveState = 'idle' | 'saving' | 'saved' | 'failed'

export default function ProjectIdentityCell(props: Props): JSX.Element {
  const { projectName, canEdit, onRename, canvasSaveState } = props
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [nameSaveState, setNameSaveState] = React.useState<NameSaveState>('idle')
  const [nameError, setNameError] = React.useState<string>('')
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const savedTimerRef = React.useRef<number | null>(null)

  const beginEdit = React.useCallback(() => {
    if (!canEdit) return
    setDraft(projectName)
    setEditing(true)
    setNameError('')
  }, [canEdit, projectName])

  const cancelEdit = React.useCallback(() => {
    setEditing(false)
    setDraft('')
    setNameError('')
  }, [])

  const commit = React.useCallback(async () => {
    const next = draft.trim()
    if (!next) {
      setNameError('Project name cannot be empty')
      return
    }
    if (next === projectName) {
      cancelEdit()
      return
    }
    setNameSaveState('saving')
    setNameError('')
    try {
      await onRename(next)
      setNameSaveState('saved')
      setEditing(false)
      setDraft('')
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current)
      savedTimerRef.current = window.setTimeout(() => setNameSaveState('idle'), 2000)
    } catch (err) {
      setNameSaveState('failed')
      setNameError(err instanceof Error ? err.message : 'Failed to save project name')
    }
  }, [draft, projectName, onRename, cancelEdit])

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  React.useEffect(() => () => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current)
  }, [])

  const canvasStatusLabel: Record<CanvasSaveState, string> = {
    idle: 'Saved',
    dirty: 'Unsaved',
    saving: 'Saving…',
    failed: 'Save failed',
  }
  const canvasStatusTone: Record<CanvasSaveState, string> = {
    idle: 'var(--tc-identity-status-muted, #9ca3af)',
    dirty: 'var(--tc-identity-status-dirty, #f59e0b)',
    saving: 'var(--tc-identity-status-muted, #9ca3af)',
    failed: 'var(--tc-identity-status-failed, #ef4444)',
  }

  return (
    <div className="app-project-identity">
      {editing ? (
        <TextInput
          ref={inputRef}
          className="app-project-identity__input"
          size="xs"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => { void commit() }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commit() }
            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
          }}
          error={nameError || undefined}
          placeholder="Project name"
          aria-label="Project name"
          data-tour="project-name"
        />
      ) : (
        <button
          type="button"
          className="app-project-identity__name"
          onClick={beginEdit}
          disabled={!canEdit}
          data-tour="project-name"
          title={canEdit ? 'Click to rename' : projectName || 'Untitled project'}
        >
          <span className="app-project-identity__name-text">
            {projectName || 'Untitled project'}
          </span>
          {canEdit && (
            <IconPencil className="app-project-identity__edit-hint" size={12} stroke={1.6} />
          )}
        </button>
      )}

      {nameSaveState === 'saving' && (
        <Tooltip label="Saving project name…">
          <IconLoader2 className="app-project-identity__name-status app-project-identity__name-status--saving" size={14} />
        </Tooltip>
      )}
      {nameSaveState === 'saved' && (
        <Tooltip label="Project name saved">
          <IconCheck className="app-project-identity__name-status app-project-identity__name-status--saved" size={14} />
        </Tooltip>
      )}
      {nameSaveState === 'failed' && (
        <Tooltip label={nameError || 'Failed to save project name'}>
          <ActionIcon
            className="app-project-identity__name-status-button"
            variant="subtle"
            size="xs"
            color="red"
            aria-label="Project name save failed"
            onClick={beginEdit}
          >
            <IconAlertCircle size={14} />
          </ActionIcon>
        </Tooltip>
      )}

      <span className="app-project-identity__divider" aria-hidden="true">·</span>

      <span
        className="app-project-identity__canvas-status"
        data-state={canvasSaveState}
        style={{ color: canvasStatusTone[canvasSaveState] }}
      >
        {canvasSaveState === 'saving' && (
          <IconLoader2 className="app-project-identity__canvas-spinner" size={12} />
        )}
        {canvasStatusLabel[canvasSaveState]}
      </span>
    </div>
  )
}
