'use client'

import { useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  ConfirmDialog,
  ListRow,
  ListRows,
  ModelSelect,
  PageBody,
  Pagination,
} from '@makinbakin/sdk/patterns'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Form,
  FormActions,
  SubmitButton,
  SystemState,
} from '@makinbakin/sdk/ui'

import { BrandIcon } from './brand-icon'
import type { ModelsData } from './use-models-data'

const PAGE_SIZE = 8

export interface AliasesTabProps {
  m: ModelsData
  query: string
  pageValue: string
  showAllValue: string
  onQueryChange: (query: string) => void
  onPageChange: (page: string) => void
  onShowAllChange: (showAll: string) => void
}

function humanizeProvider(provider: string): string {
  return provider.replace(/[-_]/g, ' ')
}

export function AliasesTab({
  m,
  query,
  pageValue,
  showAllValue,
  onQueryChange,
  onPageChange,
  onShowAllChange,
}: AliasesTabProps) {
  const {
    aliases,
    modelOptions,
    modelsReady,
    newAliasName,
    setNewAliasName,
    newAliasTarget,
    setNewAliasTarget,
    addAlias,
    deleteAlias,
    saving,
  } = m

  const [pendingDelete, setPendingDelete] = useState<{ name: string; target: string } | null>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)
  const aliasBusy = saving === 'aliases'
  const entries = useMemo(() => Object.entries(aliases)
    .sort(([left], [right]) => left.localeCompare(right)), [aliases])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(() => entries.filter(([name, target]) => {
    const model = modelOptions.find((candidate) => candidate.id === target)
    const searchable = [
      name,
      target,
      model?.name,
      model?.providerLabel,
      model?.provider,
    ].filter(Boolean).join(' ').toLocaleLowerCase()
    return !normalizedQuery || searchable.includes(normalizedQuery)
  }), [entries, modelOptions, normalizedQuery])

  const parsedPage = Number.parseInt(pageValue, 10)
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE))
  const page = Math.min(requestedPage, pageCount)
  const showAll = showAllValue === 'true'
  const visibleEntries = showAll
    ? filteredEntries
    : filteredEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const state = entries.length === 0 ? (
    <SystemState
      kind="initial-empty"
      title="No aliases yet"
      description="Create an alias below, or add Bakin’s recommended names from the page header."
    />
  ) : filteredEntries.length === 0 ? (
    <SystemState
      kind="no-results"
      title="No aliases match this search"
      description="Clear the current search to return to every configured alias."
      action={(
        <Button type="button" variant="outline" size="sm" onClick={() => onQueryChange('')}>
          Clear search
        </Button>
      )}
    />
  ) : undefined

  const createAliasCard = (
        <Card>
          <CardHeader>
            <CardTitle>Create alias</CardTitle>
            <CardDescription>
              Choose a short, memorable name and the model it should resolve to.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form<Record<string, string>>
              aria-label="Create model alias"
              busy={aliasBusy}
              onFormSubmit={addAlias}
            >
              <div className="grid min-w-0 gap-bakin-4 @lg/form:grid-cols-2">
                <Field name="aliasName">
                  <FieldLabel>Alias name</FieldLabel>
                  <FieldDescription>Use a short name such as fast, sonnet, or deep.</FieldDescription>
                  <FieldControl
                    required
                    value={newAliasName}
                    onChange={(event) => setNewAliasName(event.target.value)}
                    placeholder="e.g. opus"
                  />
                </Field>

                <Field name="targetModel">
                  <FieldLabel htmlFor="alias-target-model">Target model</FieldLabel>
                  <FieldDescription>The model this alias selects wherever the name is used.</FieldDescription>
                  <ModelSelect
                    id="alias-target-model"
                    name="targetModel"
                    ariaLabel="Target model"
                    required
                    value={newAliasTarget}
                    onValueChange={setNewAliasTarget}
                    models={modelOptions}
                    disabled={!modelsReady || aliasBusy}
                  />
                </Field>
              </div>

              <FormActions>
                <SubmitButton
                  busyLabel="Adding alias…"
                  disabled={!newAliasName.trim() || !newAliasTarget.trim() || !modelsReady}
                >
                  Add alias
                </SubmitButton>
              </FormActions>
            </Form>
          </CardContent>
        </Card>
  )

  return (
    <>
      <div className="grid min-w-0 gap-bakin-2">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-bakin-2">
          <h2>Configured aliases</h2>
          <span className="text-bakin-typography-size-meta text-bakin-text-muted">
            {entries.length} {entries.length === 1 ? 'alias' : 'aliases'}
          </span>
        </div>
        <p className="max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
          Aliases give agents and routing rules a stable short name even when the underlying model changes.
        </p>
      </div>

      <PageBody label="Configured model aliases" busy={aliasBusy}>
        {state ?? (
        <>
        <ListRows
          aria-label="Configured model aliases"
          variant="bordered"
          columns="minmax(10rem,.35fr) minmax(0,1fr) auto"
          columnsAt="lg"
        >
          {visibleEntries.map(([name, target]) => {
            const model = modelOptions.find((candidate) => candidate.id === target)
            const provider = model?.provider ?? target.split('/')[0] ?? 'model'
            const providerName = model?.providerLabel ?? humanizeProvider(provider)

            return (
              <ListRow key={name} data-alias-row className="px-bakin-4 py-bakin-3">
                <code className="min-w-0 truncate font-bakin-typography-family-mono text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">
                  {name}
                </code>

                <div className="flex min-w-0 items-center gap-bakin-3">
                  <BrandIcon
                    slug={model?.brandIconSlug ?? model?.providerBrandIconSlug}
                    fallbackText={providerName}
                    fallbackColor={model?.providerBrandColor}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-bakin-typography-size-body text-bakin-text-primary">
                      {model?.name ?? 'Model not in the current catalog'}
                    </p>
                    <p className="mt-bakin-1 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                      {target}
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="danger"
                  size="icon-sm"
                  className="justify-self-end"
                  aria-label={`Delete ${name} alias`}
                  disabled={aliasBusy}
                  onClick={(event) => {
                    deleteTriggerRef.current = event.currentTarget
                    setPendingDelete({ name, target })
                  }}
                >
                  <Trash2 />
                </Button>
              </ListRow>
            )
          })}
        </ListRows>

        <Pagination
          ariaLabel="Model alias pagination"
          page={page}
          pageSize={PAGE_SIZE}
          showAll={showAll}
          total={filteredEntries.length}
          onPageChange={(nextPage) => onPageChange(String(nextPage))}
          onShowAllChange={(nextShowAll) => {
            onShowAllChange(String(nextShowAll))
            onPageChange('1')
          }}
        />
        </>
        )}

        {createAliasCard}
      </PageBody>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete “${pendingDelete.name}” alias?` : 'Delete alias?'}
        description={pendingDelete
          ? `This alias currently points to ${pendingDelete.target}. Routing rules and agent settings that reference “${pendingDelete.name}” may stop resolving.`
          : undefined}
        confirmLabel="Delete alias"
        busyLabel="Deleting alias…"
        confirmTone="danger"
        busy={aliasBusy}
        finalFocus={deleteTriggerRef}
        onConfirm={() => {
          if (!pendingDelete) return
          void deleteAlias(pendingDelete.name).then(() => setPendingDelete(null))
        }}
        onCancel={() => setPendingDelete(null)}
      />

    </>
  )
}
