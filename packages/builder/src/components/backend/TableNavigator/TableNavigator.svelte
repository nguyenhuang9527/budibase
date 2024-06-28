<script>
  import {
    views,
    viewsV2,
    userSelectedResourceMap,
  } from "stores/builder"
  import NavItem from "components/common/NavItem.svelte"
  import { goto, isActive } from "@roxi/routify"
  import TableNavItem from './TableNavItem/TableNavItem.svelte'
  import ViewNavItem from './ViewNavItem/ViewNavItem.svelte'

  export let tables
  export let selectTable

  $: sortedTables = tables.sort(alphabetical)

  const alphabetical = (a, b) => {
    return a.name?.toLowerCase() > b.name?.toLowerCase() ? 1 : -1
  }

  const isViewActive = (view, isActive, views, viewsV2) => {
    return (
      (isActive("./view/v1") && views.selected?.name === view.name) ||
      (isActive("./view/v2") && viewsV2.selected?.id === view.id)
    )
  }
</script>

<div class="hierarchy-items-container">
  {#each sortedTables as table, idx}
    <TableNavItem
      {table}
      {idx}
      on:click={() => selectTable(table._id)}
    />
    {#each [...Object.entries(table.views || {})].sort() as [name, view], idx (idx)}
      <ViewNavItem
        {view}
        {name}
        on:click={() => {
          if (view.version === 2) {
            $goto(`./view/v2/${encodeURIComponent(view.id)}`)
          } else {
            $goto(`./view/v1/${encodeURIComponent(name)}`)
          }
        }}
      />
    {/each}
  {/each}
</div>
