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

export function fillTimelineGaps(rows: TimelineRow[], from?: string, to?: string): TimelineRow[] {
  if (rows.length === 0 && (!from || !to)) return []

  const firstDate = from || rows[0].date
  const lastDate = to || rows[rows.length - 1].date
  const models = Array.from(new Set(rows.flatMap((row) => Object.keys(row.usage))))
  const rowsByDate = new Map(rows.map((row) => [row.date, row]))
  const start = new Date(`${firstDate}T00:00:00Z`)
  const end = new Date(`${lastDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return rows

  const result: TimelineRow[] = []
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const dateString = date.toISOString().slice(0, 10)
    const existing = rowsByDate.get(dateString)
    if (existing) {
      result.push(existing)
      continue
    }

    const emptyRow: TimelineRow = { date: dateString, total: 0, usage: {} }
    for (const model of models) emptyRow[model] = 0
    result.push(emptyRow)
  }
  return result
}

export function modelsUsedOnDay(row: TimelineRow, models: string[]) {
  return models.filter((model) => (row.usage[model] ?? 0) > 0)
}
