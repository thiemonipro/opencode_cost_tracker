import { describe, expect, it } from "vitest"
import { mergeTimeline, modelsUsedOnDay } from "./timeline"

describe("timeline chart data", () => {
  const models = ["test-provider/model-a", "test-provider/model-b"]

  it("keeps per-day usage separate from zero-filled chart costs", () => {
    const rows = mergeTimeline([
      { date: "2026-01-01", model: "test-provider/model-a", cost: 0, requests: 2 },
      { date: "2026-01-02", model: "test-provider/model-b", cost: 2.5, requests: 1 },
    ], models)

    expect(rows[0]).toMatchObject({
      date: "2026-01-01",
      "test-provider/model-a": 0,
      "test-provider/model-b": 0,
      total: 0,
      usage: { "test-provider/model-a": 2 },
    })
    expect(rows[1]).toMatchObject({
      date: "2026-01-02",
      "test-provider/model-a": 0,
      "test-provider/model-b": 2.5,
      total: 2.5,
      usage: { "test-provider/model-b": 1 },
    })
  })

  it("returns only models used on the hovered day, including zero-cost usage", () => {
    const [row] = mergeTimeline([
      { date: "2026-01-01", model: "test-provider/model-a", cost: 0, requests: 1 },
      { date: "2026-01-02", model: "test-provider/model-b", cost: 2.5, requests: 1 },
    ], models)

    expect(modelsUsedOnDay(row, models)).toEqual(["test-provider/model-a"])
  })
})
