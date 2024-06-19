import { writable, derived, get } from "svelte/store"
import { fetchData } from "../../../fetch"
import { NewRowID, RowPageSize } from "../lib/constants"
import { getCellID, parseCellID } from "../lib/utils"
import { tick } from "svelte"
import { Helpers } from "@budibase/bbui"

export const createStores = () => {
  const pages = writable({})
  const loading = writable(false)
  const loaded = writable(false)
  const refreshing = writable(false)
  const rowChangeCache = writable({})
  const inProgressChanges = writable({})
  const hasNextPage = writable(false)
  const error = writable(null)
  const fetch = writable(null)
  const totalRows = writable(0)

  // Derive how many pages we will need for this amount of rows
  const totalPages = derived(totalRows, $totalRows =>
    Math.ceil($totalRows / RowPageSize)
  )

  // Derive how many rows we have loaded into memory
  const loadedRows = derived(pages, $pages => {
    let count = 0
    for (let page of Object.keys($pages)) {
      count += $pages[page]?.length || 0
    }
    return count
  })

  const enrichedPages = derived(
    [pages, totalPages],
    ([$pages, $totalPages]) => {
      let enriched = {}
      let idx = 0

      for (let i = 0; i < $totalPages; i++) {
        if (i in $pages) {
          // If we do have this page, enrich and count all rows that we have
          enriched[i] = $pages[i].map((row, pageIdx) => ({
            ...row,
            __idx: idx++, // Overal index in dataset
            __page: i, // Page number
            __pageIdx: pageIdx, // Index within the page
          }))
        } else {
          // If we haven't loaded this page, increment the idx by a full page size
          idx += RowPageSize
        }
      }

      return enriched
    }
  )

  // Generate a lookup map to quick find a row by ID
  const rowLookupMap = derived(enrichedPages, $enrichedPages => {
    let map = {}
    for (let page of Object.keys($enrichedPages)) {
      for (let row of $enrichedPages[page]) {
        map[row._id] = row
      }
    }
    return map
  })

  // Generate a lookup map to quick find a row by ID
  const rowIndexLookupMap = derived(enrichedPages, $enrichedPages => {
    let map = {}
    for (let page of Object.keys($enrichedPages)) {
      for (let row of $enrichedPages[page]) {
        map[row.__idx] = row
      }
    }
    return map
  })

  // Mark loaded as true if we've ever stopped loading
  let hasStartedLoading = false
  loading.subscribe($loading => {
    if ($loading) {
      hasStartedLoading = true
    } else if (hasStartedLoading) {
      loaded.set(true)
    }
  })

  const hasRow = id => {
    if (id === NewRowID) {
      return true
    }
    return get(rowLookupMap)[id] != null
  }

  const updateRowState = (id, row) => {
    const oldRow = get(rowLookupMap)[id]
    if (!oldRow) {
      return null
    }
    pages.update(state => {
      state[oldRow.__page][oldRow.__pageIdx] = row
      return { ...state }
    })
  }

  return {
    rows: {
      actions: { hasRow, updateRowState },
    },
    pages: {
      ...pages,
      subscribe: enrichedPages.subscribe,
    },
    fetch,
    rowLookupMap,
    rowIndexLookupMap,
    loaded,
    refreshing,
    loading,
    rowChangeCache,
    inProgressChanges,
    hasNextPage,
    error,
    totalRows,
    loadedRows,
  }
}

export const createActions = context => {
  const {
    pages,
    rows,
    definition,
    allFilters,
    loading,
    sort,
    datasource,
    API,
    scroll,
    validation,
    focusedCellId,
    columns,
    rowChangeCache,
    inProgressChanges,
    hasNextPage,
    error,
    notifications,
    fetch,
    hasBudibaseIdentifiers,
    rowLookupMap,
    refreshing,
    totalRows,
  } = context
  const instanceLoaded = writable(false)

  // Local cache of row IDs to speed up checking if a row exists
  let rowCacheMap = {}

  // Reset everything when datasource changes
  let unsubscribe = null
  let lastResetKey = null
  datasource.subscribe(async $datasource => {
    // Unsub from previous fetch if one exists
    unsubscribe?.()
    unsubscribe = null
    fetch.set(null)
    instanceLoaded.set(false)
    loading.set(true)

    // Abandon if we don't have a valid datasource
    if (!datasource.actions.isDatasourceValid($datasource)) {
      error.set("Datasource is invalid")
      return
    }

    // Tick to allow other reactive logic to update stores when datasource changes
    // before proceeding. This allows us to wipe filters etc if needed.
    await tick()
    const $allFilters = get(allFilters)
    const $sort = get(sort)

    // Create new fetch model
    const newFetch = fetchData({
      API,
      datasource: $datasource,
      options: {
        filter: $allFilters,
        sortColumn: $sort.column,
        sortOrder: $sort.order,
        limit: RowPageSize,
        paginate: true,
        countRows: true,

        // Disable client side limiting, so that for queries and custom data
        // sources we don't impose fake row limits. We want all the data.
        clientSideLimiting: false,
      },
    })

    // Subscribe to changes of this fetch model
    unsubscribe = newFetch.subscribe(async $fetch => {
      if ($fetch.error) {
        // Present a helpful error to the user
        let message = "An unknown error occurred"
        if ($fetch.error.status === 403) {
          message = "You don't have access to this data"
        } else if ($fetch.error.message) {
          message = $fetch.error.message
        }
        error.set(message)
      } else if ($fetch.loaded && !$fetch.loading) {
        error.set(null)
        hasNextPage.set($fetch.hasNextPage)
        const $instanceLoaded = get(instanceLoaded)
        const resetRows = $fetch.resetKey !== lastResetKey
        const previousResetKey = lastResetKey
        lastResetKey = $fetch.resetKey

        // If resetting rows due to a datasource change, wipe data and wait for
        // derived stores to compute. This prevents stale data being passed
        // to cells when we save the new schema.
        if (!$instanceLoaded && previousResetKey) {
          pages.set({})
          await tick()
        }

        // Reset state properties when dataset changes
        if (!$instanceLoaded || resetRows) {
          totalRows.set($fetch.totalRows || 0)
          definition.set($fetch.definition)
        }

        // Reset scroll state when data changes
        if (!$instanceLoaded) {
          // Reset both top and left for a new datasource ID
          instanceLoaded.set(true)
          scroll.set({ top: 0, left: 0 })
        } else if (resetRows) {
          // Only reset top scroll position when resetting rows
          scroll.update(state => ({ ...state, top: 0 }))
        }

        // Process new rows
        handleNewRows({
          rows: $fetch.rows,
          page: $fetch.pageNumber,
          reset: resetRows,
        })

        // Notify that we're loaded
        loading.set(false)
      }

      // Update refreshing state
      refreshing.set($fetch.loading)
    })

    fetch.set(newFetch)
  })

  // Handles validation errors from the rows API and updates local validation
  // state, storing error messages against relevant cells
  const handleValidationError = (rowId, error) => {
    let errorString
    if (typeof error === "string") {
      errorString = error
    } else if (typeof error?.message === "string") {
      errorString = error.message
    }

    // If the server doesn't reply with a valid error, assume that the source
    // of the error is the focused cell's column
    if (!error?.json?.validationErrors && errorString) {
      const { field: focusedColumn } = parseCellID(get(focusedCellId))
      if (focusedColumn) {
        error = {
          json: {
            validationErrors: {
              [focusedColumn]: error.message,
            },
          },
        }
      }
    }
    if (error?.json?.validationErrors) {
      // Normal validation errors
      const keys = Object.keys(error.json.validationErrors)
      const $columns = get(columns)

      // Filter out missing columns from columns that we have
      let erroredColumns = []
      let missingColumns = []
      for (let column of keys) {
        if (datasource.actions.canUseColumn(column)) {
          erroredColumns.push(column)
        } else {
          missingColumns.push(column)
        }
      }

      // Process errors for columns that we have
      for (let column of erroredColumns) {
        // Ensure we have a valid error to display
        let err = error.json.validationErrors[column]
        if (Array.isArray(err)) {
          err = err[0]
        }
        if (typeof err !== "string" || !err.length) {
          error = "Something went wrong"
        }
        // Set error against the cell
        validation.actions.setError(
          getCellID(rowId, column),
          Helpers.capitalise(err)
        )
        // Ensure the column is visible
        const index = $columns.findIndex(x => x.name === column)
        if (index !== -1 && !$columns[index].visible) {
          columns.update(state => {
            state[index].visible = true
            return state.slice()
          })
        }
      }

      // Notify about missing columns
      for (let column of missingColumns) {
        get(notifications).error(`${column} is required but is missing`)
      }

      // Focus the first cell with an error
      if (erroredColumns.length) {
        focusedCellId.set(getCellID(rowId, erroredColumns[0]))
      }
    } else {
      get(notifications).error(errorString || "An unknown error occurred")
    }
  }

  // Adds a new row
  const addRow = async (row, page, idx, bubble = false) => {
    try {
      // Create row. Spread row so we can mutate and enrich safely.
      let newRow = { ...row }
      newRow = await datasource.actions.addRow(newRow)

      // Update state
      handleNewRows({ rows: [newRow] })

      // Refresh row to ensure data is in the correct format
      get(notifications).success("Row created successfully")
      return newRow
    } catch (error) {
      if (bubble) {
        throw error
      } else {
        handleValidationError(NewRowID, error)
      }
    }
  }

  // Duplicates a row, inserting the duplicate row after the existing one
  const duplicateRow = async row => {
    let clone = { ...row }
    delete clone._id
    delete clone._rev
    delete clone.__idx
    try {
      return await addRow(clone, row.__page, row.__idx + 1, true)
    } catch (error) {
      handleValidationError(row._id, error)
    }
  }

  // Replaces a row in state with the newly defined row, handling updates,
  // addition and deletion
  const replaceRow = (id, row) => {
    // Get index of row to check if it exists
    const existingRow = get(rowLookupMap)[id]

    // Process as either an update, addition or deletion
    if (row) {
      if (existingRow) {
        // An existing row was updated
        rows.actions.updateRowState(id, { ...row })
      } else {
        // A new row was created
        handleNewRows({ rows: [row] })
      }
    } else if (existingRow) {
      // A row was removed
      handleRemoveRows([existingRow])
    }
  }

  // Refreshes a specific row
  const refreshRow = async id => {
    try {
      const row = await datasource.actions.getRow(id)
      replaceRow(id, row)
    } catch {
      // Do nothing - we probably just don't support refreshing individual rows
    }
  }

  // Refreshes all data
  const refreshData = () => {
    get(fetch)?.getInitialData()
  }

  // Checks if a changeset for a row actually mutates the row or not
  const changesAreValid = (row, changes) => {
    const columns = Object.keys(changes || {})
    if (!row || !columns.length) {
      return false
    }

    // Ensure there is at least 1 column that creates a difference
    return columns.some(column => row[column] !== changes[column])
  }

  // Patches a row with some changes in local state, and returns whether a
  // valid pending change was made or not
  const stashRowChanges = (rowId, changes) => {
    // Check this is a valid change
    const row = get(rowLookupMap)[rowId]
    if (!row || !changesAreValid(row, changes)) {
      return false
    }

    // Add change to cache
    rowChangeCache.update(state => ({
      ...state,
      [rowId]: {
        ...state[rowId],
        ...changes,
      },
    }))
    return true
  }

  // Saves any pending changes to a row
  const applyRowChanges = async rowId => {
    const row = get(rowLookupMap)[rowId]
    if (row == null) {
      return
    }

    // Save change
    try {
      // Increment change count for this row
      inProgressChanges.update(state => ({
        ...state,
        [rowId]: (state[rowId] || 0) + 1,
      }))

      // Update row
      const changes = get(rowChangeCache)[rowId]
      const newRow = { ...cleanRow(row), ...changes }
      const saved = await datasource.actions.updateRow(newRow)

      // Update row state after a successful change
      if (saved?._id) {
        rows.actions.updateRowState(rowId, saved)
      } else if (saved?.id) {
        // Handle users table edge case
        await refreshRow(saved.id)
      }

      // Wipe row change cache for any values which have been saved
      const liveChanges = get(rowChangeCache)[rowId]
      rowChangeCache.update(state => {
        Object.keys(changes || {}).forEach(key => {
          if (changes[key] === liveChanges?.[key]) {
            delete state[rowId][key]
          }
        })
        return state
      })
    } catch (error) {
      handleValidationError(rowId, error)
    }

    // Decrement change count for this row
    inProgressChanges.update(state => ({
      ...state,
      [rowId]: (state[rowId] || 1) - 1,
    }))
  }

  // Updates a value of a row
  const updateValue = async ({ rowId, column, value, apply = true }) => {
    const success = stashRowChanges(rowId, { [column]: value })
    if (success && apply) {
      await applyRowChanges(rowId)
    }
  }

  // Deletes an array of rows
  const deleteRows = async rowsToDelete => {
    if (!rowsToDelete?.length) {
      return
    }

    // Actually delete rows
    const cleanedRows = rowsToDelete.map(cleanRow)
    await datasource.actions.deleteRows(cleanedRows)

    // Update state
    handleRemoveRows(rowsToDelete)
  }

  // Local handler to process new rows inside the fetch, and append any new
  // rows to state that we haven't encountered before
  const handleNewRows = ({ rows, page, idx, reset }) => {
    if (reset) {
      rowCacheMap = {}
    }
    if (page == null) {
      page = 0
    }

    // Enrich all rows before adding to state, and strip out any rows we have
    // already cached
    let enrichedNewRows = []
    const $hasBudibaseIdentifiers = get(hasBudibaseIdentifiers)
    for (let i = 0; i < rows.length; i++) {
      if (rowCacheMap[rows[i]._id]) {
        return
      }

      // Enrich with idx
      let newRow = { ...rows[i] }

      // Ensure we have a unique _id.
      // This means generating one for non DS+, overwriting any that may already
      // exist as we cannot allow duplicates.
      if (!$hasBudibaseIdentifiers) {
        newRow._id = Helpers.uuid()
      }

      // Cache this ID
      rowCacheMap[newRow._id] = true
      enrichedNewRows.push(newRow)
    }

    if (reset) {
      pages.set({
        [page]: enrichedNewRows,
      })
    } else {
      pages.update(state => {
        if (!state[page]) {
          state[page] = []
        }
        if (enrichedNewRows.length === 1 && idx != null) {
          state[page].splice(idx, 0, enrichedNewRows[0])
        } else {
          state[page] = [...state[page], ...enrichedNewRows]
        }
        return { ...state }
      })
    }
  }

  // Local handler to remove rows from state
  const handleRemoveRows = rowsToRemove => {
    // We deliberately do not remove IDs from the cache map as the data may
    // still exist inside the fetch, but we don't want to add it again
    let removals = {}
    rowsToRemove.forEach(row => {
      removals[row.__page] = [...(removals[row.__page] || []), row._id]
    })
    pages.update(state => {
      Object.keys(removals).forEach(page => {
        state[page] = state[page].filter(
          row => !removals[page].includes(row._id)
        )
      })
      return { ...state }
    })
  }

  // Loads the next page of data if available
  const loadNextPage = async () => {
    get(fetch)?.nextPage()
  }

  const loadPage = async number => {
    // Skip if we've already loaded this page
    if (number in get(pages)) {
      return
    }
    await get(fetch)?.goToPage(number)
  }

  // Cleans a row by removing any internal grid metadata from it.
  // Call this before passing a row to any sort of external flow.
  const cleanRow = row => {
    let clone = { ...row }
    delete clone.__idx
    delete clone.__page
    delete clone.__pageIdx
    if (!get(hasBudibaseIdentifiers)) {
      delete clone._id
    }
    return clone
  }

  return {
    rows: {
      ...rows,
      actions: {
        ...rows.actions,
        addRow,
        duplicateRow,
        updateValue,
        applyRowChanges,
        deleteRows,
        loadNextPage,
        loadPage,
        refreshRow,
        replaceRow,
        refreshData,
        cleanRow,
      },
    },
  }
}

export const initialise = context => {
  const {
    rowChangeCache,
    inProgressChanges,
    previousFocusedRowId,
    previousFocusedCellId,
    rows,
    validation,
  } = context

  // Wipe the row change cache when changing row
  previousFocusedRowId.subscribe(id => {
    if (id && !get(inProgressChanges)[id]) {
      rowChangeCache.update(state => {
        delete state[id]
        return state
      })
    }
  })

  // Ensure any unsaved changes are saved when changing cell
  previousFocusedCellId.subscribe(async id => {
    if (!id) {
      return
    }
    const { id: rowId, field } = parseCellID(id)
    const hasChanges = field in (get(rowChangeCache)[rowId] || {})
    const hasErrors = validation.actions.rowHasErrors(rowId)
    const isSavingChanges = get(inProgressChanges)[rowId]
    if (rowId && !hasErrors && hasChanges && !isSavingChanges) {
      await rows.actions.applyRowChanges(rowId)
    }
  })
}
