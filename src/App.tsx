import { useEffect, useState } from "react"
import {
  Area,
  Bar,
  ComposedChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { DashboardData } from "./types"

const modelColors = ["#f56f46", "#e9b949", "#57a58c", "#678cc8", "#a578c4", "#cf6f8f", "#8fa65a", "#bc7c47"]

type Filters = {
  from: string
  to: string
  project: string
  provider: string
  model: string
}

type ModelSortKey = "model" | "cost" | "share" | "requests" | "averageCost" | "cacheRead"
type SortDirection = "asc" | "desc"

type ModelSort = {
  key: ModelSortKey
  direction: SortDirection
}

const initialFilters: Filters = { from: "", to: "", project: "", provider: "", model: "" }

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
const averageCost = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 3 })
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat("en-US")

function dateRange(days: number) {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days + 1)
  const local = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60_000
    return new Date(date.getTime() - offset).toISOString().slice(0, 10)
  }
  return { from: local(from), to: local(to) }
}

function mergeTimeline(items: DashboardData["timeline"], models: string[]) {
  const dates = new Map<string, Record<string, string | number>>()
  for (const item of items) {
    const row = dates.get(item.date) ?? { date: item.date }
    row[item.model] = item.cost
    row.total = Number(row.total ?? 0) + item.cost
    dates.set(item.date, row)
  }
  return Array.from(dates.values()).map((row) => {
    for (const model of models) row[model] ??= 0
    return row
  })
}

function shortModel(value: string) {
  return value.includes("/") ? value.slice(value.indexOf("/") + 1) : value
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function Loading() {
  return (
    <main className="status-page">
      <div className="pulse" />
      <p>Reading OpenCode usage</p>
    </main>
  )
}

export function App() {
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [modelSort, setModelSort] = useState<ModelSort>({ key: "cost", direction: "desc" })
  const [data, setData] = useState<DashboardData>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => value && params.set(key, value))
    setLoading(true)
    fetch(`/api/dashboard?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).detail ?? "Request failed")
        return response.json() as Promise<DashboardData>
      })
      .then((result) => {
        setData(result)
        setError(undefined)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [filters])

  if (!data && loading) return <Loading />
  if (!data || error) {
    return (
      <main className="status-page error">
        <strong>Could not read OpenCode data</strong>
        <p>{error}</p>
      </main>
    )
  }

  const modelNames = data.models.map((item) => `${item.provider}/${item.model}`)
  const timeline = mergeTimeline(data.timeline, modelNames)
  const isSingleDay = timeline.length === 1
  const totalTokens = Object.values(data.overview.tokens).reduce((sum, value) => sum + value, 0)
  const modelRows = data.models.map((item, index) => {
    const cacheRead = item.tokens.input + item.tokens.cacheRead > 0 ? item.tokens.cacheRead / (item.tokens.input + item.tokens.cacheRead) : 0
    return {
      item,
      colorIndex: index,
      cost: item.cost,
      requests: item.requests,
      share: data.overview.cost ? item.cost / data.overview.cost : 0,
      averageCost: item.requests ? item.cost / item.requests : 0,
      cacheRead,
    }
  }).sort((a, b) => {
    const aValue = modelSort.key === "model" ? a.item.model : a[modelSort.key]
    const bValue = modelSort.key === "model" ? b.item.model : b[modelSort.key]
    const comparison = typeof aValue === "string" && typeof bValue === "string"
      ? aValue.localeCompare(bValue)
      : Number(aValue) - Number(bValue)
    if (comparison !== 0) return modelSort.direction === "asc" ? comparison : -comparison
    return `${a.item.provider}/${a.item.model}`.localeCompare(`${b.item.provider}/${b.item.model}`)
  })

  const update = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }))
  const setPeriod = (days?: number) => setFilters((current) => ({
    ...current,
    ...(days ? dateRange(days) : { from: "", to: "" }),
  }))
  const sortModels = (key: ModelSortKey) => setModelSort((current) => ({
    key,
    direction: current.key === key ? current.direction === "asc" ? "desc" : "asc" : key === "model" ? "asc" : "desc",
  }))
  const sortLabel = (key: ModelSortKey, label: string) => (
    <button
      className="sort-button"
      type="button"
      data-direction={modelSort.key === key ? modelSort.direction : undefined}
      onClick={() => sortModels(key)}
      aria-label={`Sort by ${label}`}
    >
      {label}<span className="sort-indicator" aria-hidden="true" />
    </button>
  )

  return (
    <main className="app-shell">
      <header className="masthead">
        <div>
          <div className="eyebrow"><span className="signal" /> Local usage ledger</div>
          <h1>OpenCode<br /><em>cost tracker</em></h1>
        </div>
        <div className="masthead-note">
          <span>Source</span>
          <code title={data.meta.databasePath}>{data.meta.databasePath.split("/").slice(-3).join("/")}</code>
          <small>Updated {new Date(data.meta.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
        </div>
      </header>

      <section className="filter-bar" aria-label="Dashboard filters">
        <div className="periods">
          <button onClick={() => setPeriod(1)}>TODAY</button>
          <button onClick={() => setPeriod(7)}>7D</button>
          <button onClick={() => setPeriod(30)}>30D</button>
          <button onClick={() => setPeriod(90)}>90D</button>
          <button onClick={() => setPeriod()}>ALL</button>
        </div>
        <label>From<input type="date" value={filters.from} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => update("from", event.target.value)} /></label>
        <label>To<input type="date" value={filters.to} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => update("to", event.target.value)} /></label>
        <label>Project<select value={filters.project} onChange={(event) => update("project", event.target.value)}><option value="">All projects</option>{data.filters.projects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Provider<select value={filters.provider} onChange={(event) => update("provider", event.target.value)}><option value="">All providers</option>{data.filters.providers.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Model<select value={filters.model} onChange={(event) => update("model", event.target.value)}><option value="">All models</option>{data.filters.models.map((item) => <option key={item}>{item}</option>)}</select></label>
        {Object.values(filters).some(Boolean) && <button className="clear" onClick={() => setFilters(initialFilters)}>Clear</button>}
      </section>

      <section className={`metrics ${loading ? "refreshing" : ""}`}>
        <Metric label="Estimated cost" value={money.format(data.overview.cost)} detail={`${money.format(data.overview.averageCostPerActiveDay)} / active day`} />
        <Metric label="Model requests" value={integer.format(data.overview.requests)} detail={`${money.format(data.overview.averageCostPerRequest)} average`} />
        <Metric label="Sessions" value={integer.format(data.overview.sessions)} detail={`${data.overview.activeDays} active days`} />
        <Metric label="Token volume" value={compact.format(totalTokens)} detail={`${(data.overview.cacheReadRatio * 100).toFixed(1)}% cache-read share`} />
      </section>

      <section className="panel timeline-panel">
        <div className="section-heading">
          <div><span>01 / Cost over time</span><h2>{isSingleDay ? "Today's model mix" : "Where the meter moved"}</h2></div>
          <div className="legend">
            {modelNames.slice(0, 6).map((model, index) => <span key={model}><i style={{ background: modelColors[index % modelColors.length] }} />{shortModel(model)}</span>)}
            <span><i className="total-legend" />Total / day</span>
          </div>
        </div>
        {timeline.length > 0 ? (
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              {isSingleDay ? (
                <ComposedChart data={timeline} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="#292723" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} tick={{ fill: "#89847b", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(value: number) => `$${value}`} tick={{ fill: "#89847b", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#181714", border: "1px solid #3b3832", borderRadius: 0 }} formatter={(value) => money.format(Number(value))} />
                  {modelNames.map((model, index) => <Bar key={model} dataKey={model} stackId="cost" fill={modelColors[index % modelColors.length]} />)}
                  <Line type="monotone" dataKey="total" name="Total / day" stroke="#f3e8d2" strokeWidth={2} dot={{ r: 3, fill: "#f3e8d2", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </ComposedChart>
              ) : (
                <ComposedChart data={timeline} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="#292723" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} tick={{ fill: "#89847b", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
                  <YAxis tickFormatter={(value: number) => `$${value}`} tick={{ fill: "#89847b", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#181714", border: "1px solid #3b3832", borderRadius: 0 }} formatter={(value) => money.format(Number(value))} />
                  {modelNames.map((model, index) => <Area key={model} type="monotone" dataKey={model} stackId="cost" stroke={modelColors[index % modelColors.length]} fill={modelColors[index % modelColors.length]} fillOpacity={0.72} />)}
                  <Line type="monotone" dataKey="total" name="Total / day" stroke="#f3e8d2" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          </div>
        ) : <div className="empty">No model requests in this period.</div>}
      </section>

      <section className="split-grid">
        <div className="panel">
           <div className="section-heading"><div><span>02 / Models</span><h2>Cost profile</h2></div></div>
           <div className="table-scroll">
             <table>
               <thead><tr>
                 <th aria-sort={modelSort.key === "model" ? modelSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortLabel("model", "Model")}</th>
                 <th aria-sort={modelSort.key === "cost" ? modelSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortLabel("cost", "Cost")}</th>
                 <th aria-sort={modelSort.key === "share" ? modelSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortLabel("share", "Share")}</th>
                 <th aria-sort={modelSort.key === "requests" ? modelSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortLabel("requests", "Requests")}</th>
                 <th aria-sort={modelSort.key === "averageCost" ? modelSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortLabel("averageCost", "Avg / req.")}</th>
                 <th aria-sort={modelSort.key === "cacheRead" ? modelSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortLabel("cacheRead", "Cache read")}</th>
               </tr></thead>
               <tbody>{modelRows.map(({ item, colorIndex, share, averageCost: average, cacheRead }) => <tr key={`${item.provider}/${item.model}`}><td><i className="model-dot" style={{ background: modelColors[colorIndex % modelColors.length] }} /><strong>{item.model}</strong><small>{item.provider}</small></td><td>{money.format(item.cost)}</td><td>{`${(share * 100).toFixed(1)}%`}</td><td>{integer.format(item.requests)}</td><td>{averageCost.format(average)}</td><td>{(cacheRead * 100).toFixed(1)}%</td></tr>)}</tbody>
             </table>
           </div>
        </div>

        <div className="panel projects-panel">
          <div className="section-heading"><div><span>03 / Projects</span><h2>Allocation</h2></div></div>
          <div className="project-list">{data.projects.map((project) => (
            <button key={project.id} onClick={() => update("project", project.id)}>
              <div><strong>{project.name}</strong><small>{project.sessions} sessions · {project.requests} requests</small></div>
              <div className="project-cost"><strong>{money.format(project.cost)}</strong><span>{data.overview.cost ? `${(project.cost / data.overview.cost * 100).toFixed(1)}%` : "0%"}</span></div>
              <span className="project-bar" style={{ width: `${data.overview.cost ? project.cost / data.overview.cost * 100 : 0}%` }} />
            </button>
          ))}</div>
        </div>
      </section>

      <section className="panel sessions-panel">
        <div className="section-heading"><div><span>04 / Sessions</span><h2>Most expensive work</h2></div><small>Top 25 by estimated cost</small></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Session</th><th>Project</th><th>Models</th><th>Reasoning</th><th>Requests</th><th>Tokens</th><th>Last active</th><th>Cost</th></tr></thead>
            <tbody>{data.sessions.map((session) => <tr key={session.id}><td><strong>{session.title}</strong><small>{session.id.slice(0, 14)}</small></td><td>{session.project}</td><td><div className="model-pills">{session.models.slice(0, 2).map((model) => <span key={model}>{shortModel(model)}</span>)}</div></td><td><div className="model-pills">{session.reasoningLevels.map((level) => <span key={level}>{level}</span>)}</div></td><td>{integer.format(session.requests)}</td><td>{compact.format(session.tokens)}</td><td>{new Date(session.lastActive).toLocaleDateString()}</td><td className="cost-cell">{money.format(session.cost)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <footer>
        <p><strong>Estimated cost</strong> uses the historical value recorded by OpenCode. Subscription providers may not bill this amount directly.</p>
        <span>Read-only · Localhost · No prompt content</span>
      </footer>
    </main>
  )
}
