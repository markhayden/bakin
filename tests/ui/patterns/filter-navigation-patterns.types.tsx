import {
  AgentFilter,
  FacetFilter,
  SearchInput,
  SegmentedControl,
  SortableHead,
  UnderlineTabs,
} from '@makinbakin/sdk/patterns'

export const validFilterNavigationPatterns = (
  <>
    <FacetFilter label="State" options={[]} selected={[]} onChange={() => {}} />
    <SearchInput label="Search tasks" value="" onValueChange={() => {}} busy />
    <AgentFilter ariaLabel="Agent" options={[]} value="all" onValueChange={() => {}} />
    <SegmentedControl ariaLabel="View" options={[{ value: 'board', label: 'Board' }]} value="board" onValueChange={() => {}} />
    <UnderlineTabs tabs={[{ id: 'overview', label: 'Overview' }]} value="overview" onValueChange={() => {}} />
    <table><thead><tr><SortableHead field="name" current="name" dir="asc" onSort={() => {}}>Name</SortableHead></tr></thead></table>
  </>
)

// @ts-expect-error segmented values remain one finite string union
export const invalidSegmentedValue = <SegmentedControl<'board'> ariaLabel="View" options={[{ value: 'board', label: 'Board' }]} value="timeline" onValueChange={() => {}} />
// @ts-expect-error sort direction is finite
export const invalidSortDirection = <table><thead><tr><SortableHead field="name" current="name" dir="up" onSort={() => {}}>Name</SortableHead></tr></thead></table>
// @ts-expect-error selected facet values are strings
export const invalidFacetSelection = <FacetFilter label="State" options={[]} selected={[42]} onChange={() => {}} />
