import type { DashboardData } from "./types"

export type TimelineRow = {
  date: string
  total: number
  usage: Record<string, number>
  [key: string]: string | number | Record<string, number>
}

export function mergeTimeline(items: DashboardData["timeline"], models: string[]): TimelineRow[] {
  const dates = new Map<string, TimelineRow>()
  for (const item of items) {
    const row: TimelineRow = dates.get(item.date) ?? { date: item.date, total: 0, usage: {} }
    row[item.model] = item.cost
    row.usage[item.model] = (row.usage[item.model] ?? 0) + item.requests
    row.total += item.cost
    dates.set(item.date, row)
  }
  return Array.from(dates.values()).map((row) => {
    for (const model of models) row[model] ??= 0
    return row
  })
}

export function modelsUsedOnDay(row: TimelineRow, models: string[]) {
  return models.filter((model) => (row.usage[model] ?? 0) > 0)
}
