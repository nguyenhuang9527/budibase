import { isLogicalSearchOperator, SearchFilters } from "@budibase/types"
import { cloneDeep } from "lodash/fp"

export const removeInvalidFilters = (
  filters: SearchFilters,
  validFields: string[]
) => {
  const result = cloneDeep(filters)

  validFields = validFields.map(f => f.toLowerCase())
  for (const filterKey of Object.keys(result) as (keyof SearchFilters)[]) {
    if (typeof result[filterKey] !== "object") {
      continue
    }
    if (isLogicalSearchOperator(filterKey)) {
      for (let i = 0; i < result[filterKey].conditions.length; i++) {
        result[filterKey].conditions[i] = removeInvalidFilters(
          result[filterKey].conditions[i],
          validFields
        )
      }
      continue
    }

    const filter = result[filterKey]
    for (const columnKey of Object.keys(filter)) {
      if (
        !validFields.map(f => f.toLowerCase()).includes(columnKey.toLowerCase())
      ) {
        delete filter[columnKey]
      }
    }
  }

  return result
}
