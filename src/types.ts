export interface DashboardData {
  meta: {
    databasePath: string
    generatedAt: number
    currency: string
    costKind: "estimated"
  }
  filters: {
    projects: Array<{ id: string; label: string }>
    providers: string[]
    models: string[]
  }
  overview: {
    cost: number
    sessions: number
    requests: number
    activeDays: number
    averageCostPerRequest: number
    averageCostPerActiveDay: number
    tokens: {
      input: number
      output: number
      reasoning: number
      cacheRead: number
      cacheWrite: number
    }
    cacheReadRatio: number
    averageDurationMs: number
    errorRate: number
  }
  timeline: Array<{ date: string; model: string; cost: number; requests: number }>
  models: Array<{
    provider: string
    model: string
    requests: number
    cost: number
    tokens: DashboardData["overview"]["tokens"]
    averageDurationMs: number
    errorRate: number
  }>
  projects: Array<{
    id: string
    name: string
    directory: string
    sessions: number
    requests: number
    cost: number
    lastActive: number
  }>
  sessions: Array<{
    id: string
    title: string
    project: string
    requests: number
    cost: number
    tokens: number
    models: string[]
    lastActive: number
  }>
}
