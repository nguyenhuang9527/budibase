import { generator } from "@budibase/backend-core/tests"
import { SearchFilters } from "@budibase/types"
import { removeInvalidFilters } from "../utils"

describe("view utils", () => {
  describe("removeInvalidFilters", () => {
    it("can filter empty queries", () => {
      const filters: SearchFilters = {}
      const result = removeInvalidFilters(filters, [])
      expect(result).toEqual({})
    })

    it("don't trim any valid field", () => {
      const filters: SearchFilters = {
        equal: { one: generator.word() },
        $or: {
          conditions: [
            {
              equal: { one: generator.word(), two: generator.word() },
              notEmpty: { one: null },
              $and: {
                conditions: [
                  {
                    equal: { three: generator.word() },
                    notEmpty: { forth: null },
                  },
                ],
              },
            },
          ],
        },
        $and: {
          conditions: [
            { equal: { one: generator.word() }, notEmpty: { one: null } },
          ],
        },
      }
      const result = removeInvalidFilters(filters, [
        "one",
        "two",
        "three",
        "forth",
      ])
      expect(result).toEqual(filters)
    })
  })
})
