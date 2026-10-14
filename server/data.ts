import { execFileSync } from "node:child_process"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { DatabaseSync } from "node:sqlite"

export interface DashboardFilters {
  from?: string
  to?: string
  project?: string
  provider?: string
  model?: string
}

type SqlValue = string | number | null
type Row = Record<string, SqlValue>

interface DatabaseFormats {
  legacy: boolean
  v2: boolean
}

function requestCte(formats: DatabaseFormats) {
  const sessionSources: string[] = []
  const requestSources: string[] = []

  if (formats.legacy) {
    sessionSources.push(`
      SELECT id, project_id, title, directory, 0 AS source_priority
      FROM session
    `)
    requestSources.push(`
      SELECT
        m.id AS request_id,
        m.session_id,
        COALESCE(
          json_extract(m.data, '$.time.completed'),
          json_extract(m.data, '$.time.created'),
          m.time_created
        ) AS occurred_at,
        json_extract(m.data, '$.providerID') AS provider,
        json_extract(m.data, '$.modelID') AS model,
        json_extract(m.data, '$.variant') AS reasoning_level,
        COALESCE(json_extract(m.data, '$.cost'), 0) AS cost,
        COALESCE(json_extract(m.data, '$.tokens.input'), 0) AS tokens_input,
        COALESCE(json_extract(m.data, '$.tokens.output'), 0) AS tokens_output,
        COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0) AS tokens_reasoning,
        COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0) AS cache_read,
        COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0) AS cache_write,
        CASE
          WHEN json_extract(m.data, '$.time.completed') IS NOT NULL
            THEN json_extract(m.data, '$.time.completed') - json_extract(m.data, '$.time.created')
          ELSE NULL
        END AS duration_ms,
        CASE WHEN json_extract(m.data, '$.error') IS NOT NULL THEN 1 ELSE 0 END AS is_error,
        0 AS source_priority
      FROM message m
      WHERE json_extract(m.data, '$.role') = 'assistant'
        AND json_extract(m.data, '$.providerID') IS NOT NULL
        AND json_extract(m.data, '$.modelID') IS NOT NULL
    `)
  }

  if (formats.v2) {
    sessionSources.push(`
      SELECT id, project_id, title, directory, 1 AS source_priority
      FROM session_v2
    `)
    requestSources.push(`
      SELECT
        m.id AS request_id,
        m.session_id,
        COALESCE(
          json_extract(m.data, '$.time.completed'),
          json_extract(m.data, '$.time.created'),
          m.time_created
        ) AS occurred_at,
        json_extract(m.data, '$.model.providerID') AS provider,
        json_extract(m.data, '$.model.id') AS model,
        json_extract(m.data, '$.model.variant') AS reasoning_level,
        COALESCE(json_extract(m.data, '$.cost'), 0) AS cost,
        COALESCE(json_extract(m.data, '$.tokens.input'), 0) AS tokens_input,
        COALESCE(json_extract(m.data, '$.tokens.output'), 0) AS tokens_output,
        COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0) AS tokens_reasoning,
        COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0) AS cache_read,
        COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0) AS cache_write,
        CASE
          WHEN json_extract(m.data, '$.time.completed') IS NOT NULL
            THEN json_extract(m.data, '$.time.completed') - json_extract(m.data, '$.time.created')
          ELSE NULL
        END AS duration_ms,
        CASE WHEN json_extract(m.data, '$.error') IS NOT NULL THEN 1 ELSE 0 END AS is_error,
        1 AS source_priority
      FROM session_message m
      WHERE m.type = 'assistant'
        AND json_extract(m.data, '$.model.providerID') IS NOT NULL
        AND json_extract(m.data, '$.model.id') IS NOT NULL
    `)
  }

  const sessionSelection = formats.legacy && formats.v2
    ? `
      SELECT
        current.id,
        current.project_id,
        CASE
          WHEN current.title IS NULL OR trim(current.title) = '' THEN (
            SELECT legacy.title FROM session legacy WHERE legacy.id = current.id
          )
          ELSE current.title
        END AS title,
        current.directory
      FROM ranked_sessions current
      WHERE current.source_rank = 1
    `
    : `
      SELECT id, project_id, title, directory
      FROM ranked_sessions
      WHERE source_rank = 1
    `

  return `
    WITH
      session_candidates AS (
        ${sessionSources.join("\n        UNION ALL\n")}
      ),
      ranked_sessions AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY source_priority DESC) AS source_rank
        FROM session_candidates
      ),
      sessions AS (
        ${sessionSelection}
      ),
      request_candidates AS (
        ${requestSources.join("\n        UNION ALL\n")}
      ),
      ranked_requests AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY session_id, request_id
          ORDER BY source_priority DESC
        ) AS source_rank
        FROM request_candidates
      ),
      requests AS (
        SELECT
          r.request_id,
          r.session_id,
          r.occurred_at,
          r.provider,
          r.model,
          r.reasoning_level,
          r.cost,
          r.tokens_input,
          r.tokens_output,
          r.tokens_reasoning,
          r.cache_read,
          r.cache_write,
          r.duration_ms,
          r.is_error,
          s.title AS session_title,
          s.directory,
          s.project_id,
          p.name AS project_name
        FROM ranked_requests r
        JOIN sessions s ON s.id = r.session_id
        LEFT JOIN project p ON p.id = s.project_id
        WHERE r.source_rank = 1
      )
  `
}

function parseDate(value: string, endOfDay = false) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + (endOfDay ? 1 : 0))
  return date.getTime()
}

function where(filters: DashboardFilters) {
  const clauses: string[] = []
  const params: SqlValue[] = []

  const from = filters.from ? parseDate(filters.from) : undefined
  if (from !== undefined) {
    clauses.push("occurred_at >= ?")
    params.push(from)
  }

  const to = filters.to ? parseDate(filters.to, true) : undefined
  if (to !== undefined) {
    clauses.push("occurred_at < ?")
    params.push(to)
  }

  if (filters.project) {
    clauses.push("project_id = ?")
    params.push(filters.project)
  }
  if (filters.provider) {
    clauses.push("provider = ?")
    params.push(filters.provider)
  }
  if (filters.model) {
    clauses.push("model = ?")
    params.push(filters.model)
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  }
}

function rows(db: DatabaseSync, sql: string, params: SqlValue[] = []) {
  return db.prepare(sql).all(...params) as Row[]
}

function first(db: DatabaseSync, sql: string, params: SqlValue[] = []) {
  return (db.prepare(sql).get(...params) ?? {}) as Row
}

function projectLabel(name: SqlValue, directory: SqlValue) {
  if (typeof name === "string" && name.trim()) return name
  if (typeof directory === "string" && directory) return basename(directory)
  return "Unknown project"
}

function number(value: SqlValue | undefined) {
  return typeof value === "number" ? value : Number(value ?? 0)
}

type DatabasePathCommandRunner = (args: string[]) => string

export function resolveDatabasePath(
  runCommand: DatabasePathCommandRunner = (args) =>
    execFileSync("opencode", args, { encoding: "utf8" }),
) {
  if (process.env.OPENCODE_DB_PATH) return process.env.OPENCODE_DB_PATH

  for (const args of [["debug", "paths", "db"], ["db", "path"]]) {
    try {
      const path = runCommand(args).trim()
      if (path) return path
    } catch {
      // Try the older CLI command before falling back to the default path.
    }
  }

  return join(homedir(), ".local", "share", "opencode", "opencode.db")
}

export class OpenCodeData {
  readonly databasePath: string
  private readonly db: DatabaseSync
  private readonly requestCte: string

  constructor(databasePath = resolveDatabasePath()) {
    this.databasePath = databasePath
    this.db = new DatabaseSync(databasePath, { readOnly: true })

    const tables = new Set(
      rows(this.db, "SELECT name FROM sqlite_master WHERE type = 'table'")
        .map((row) => row.name)
        .filter((name): name is string => typeof name === "string"),
    )
    const formats = {
      legacy: tables.has("message") && tables.has("session"),
      v2: tables.has("session_message") && tables.has("session_v2"),
    }

    if (!formats.legacy && !formats.v2) {
      this.db.close()
      throw new Error("The OpenCode database does not contain a supported session schema")
    }

    this.requestCte = requestCte(formats)
  }

  close() {
    this.db.close()
  }

  dashboard(filters: DashboardFilters = {}) {
    const filtered = where(filters)
    const overview = first(
      this.db,
      `${this.requestCte}
       SELECT
         COUNT(*) AS requests,
         COUNT(DISTINCT session_id) AS sessions,
         COALESCE(SUM(cost), 0) AS cost,
         COALESCE(SUM(tokens_input), 0) AS tokens_input,
         COALESCE(SUM(tokens_output), 0) AS tokens_output,
         COALESCE(SUM(tokens_reasoning), 0) AS tokens_reasoning,
         COALESCE(SUM(cache_read), 0) AS cache_read,
         COALESCE(SUM(cache_write), 0) AS cache_write,
         COALESCE(AVG(duration_ms), 0) AS avg_duration_ms,
         COALESCE(SUM(is_error), 0) AS errors,
         COUNT(DISTINCT date(occurred_at / 1000, 'unixepoch', 'localtime')) AS active_days
       FROM requests ${filtered.sql}`,
      filtered.params,
    )

    const timeline = rows(
      this.db,
      `${this.requestCte}
       SELECT
         date(occurred_at / 1000, 'unixepoch', 'localtime') AS date,
         provider || '/' || model AS model,
         SUM(cost) AS cost,
         COUNT(*) AS requests
       FROM requests ${filtered.sql}
       GROUP BY date, provider, model
       ORDER BY date, cost DESC`,
      filtered.params,
    )

    const models = rows(
      this.db,
      `${this.requestCte}
       SELECT
         provider,
         model,
         COUNT(*) AS requests,
         SUM(cost) AS cost,
         SUM(tokens_input) AS tokens_input,
         SUM(tokens_output) AS tokens_output,
         SUM(tokens_reasoning) AS tokens_reasoning,
         SUM(cache_read) AS cache_read,
         SUM(cache_write) AS cache_write,
         AVG(duration_ms) AS avg_duration_ms,
         SUM(is_error) AS errors
       FROM requests ${filtered.sql}
       GROUP BY provider, model
       ORDER BY cost DESC`,
      filtered.params,
    )

    const projects = rows(
      this.db,
      `${this.requestCte}
       SELECT
         project_id,
         project_name,
         directory,
         COUNT(DISTINCT session_id) AS sessions,
         COUNT(*) AS requests,
         SUM(cost) AS cost,
         MAX(occurred_at) AS last_active
       FROM requests ${filtered.sql}
       GROUP BY project_id, project_name, directory
       ORDER BY cost DESC`,
      filtered.params,
    )

    const sessions = rows(
      this.db,
      `${this.requestCte}
       SELECT
         session_id,
         session_title,
         project_id,
          project_name,
          directory,
          COUNT(*) AS requests,
          SUM(cost) AS cost,
          SUM(tokens_input + tokens_output + tokens_reasoning + cache_read + cache_write) AS tokens,
          GROUP_CONCAT(DISTINCT provider || '/' || model) AS models,
          GROUP_CONCAT(DISTINCT COALESCE(reasoning_level, 'Not recorded')) AS reasoning_levels,
          MAX(occurred_at) AS last_active
       FROM requests ${filtered.sql}
       GROUP BY session_id, session_title, project_id, project_name, directory
       ORDER BY cost DESC
       LIMIT 25`,
      filtered.params,
    )

    const options = {
      projects: rows(
        this.db,
        `${this.requestCte}
         SELECT project_id, project_name, directory, SUM(cost) AS cost
         FROM requests
         GROUP BY project_id, project_name, directory
         ORDER BY cost DESC`,
      ).map((row) => ({ id: String(row.project_id), label: projectLabel(row.project_name, row.directory) })),
      providers: rows(
        this.db,
        `${this.requestCte} SELECT DISTINCT provider FROM requests ORDER BY provider`,
      ).map((row) => String(row.provider)),
      models: rows(
        this.db,
        `${this.requestCte} SELECT DISTINCT model FROM requests ORDER BY model`,
      ).map((row) => String(row.model)),
    }

    const cost = number(overview.cost)
    const requests = number(overview.requests)
    const cacheRead = number(overview.cache_read)
    const input = number(overview.tokens_input)

    return {
      meta: {
        databasePath: this.databasePath,
        generatedAt: Date.now(),
        currency: "USD",
        costKind: "estimated",
      },
      filters: options,
      overview: {
        cost,
        sessions: number(overview.sessions),
        requests,
        activeDays: number(overview.active_days),
        averageCostPerRequest: requests > 0 ? cost / requests : 0,
        averageCostPerActiveDay: number(overview.active_days) > 0 ? cost / number(overview.active_days) : 0,
        tokens: {
          input,
          output: number(overview.tokens_output),
          reasoning: number(overview.tokens_reasoning),
          cacheRead,
          cacheWrite: number(overview.cache_write),
        },
        cacheReadRatio: input + cacheRead > 0 ? cacheRead / (input + cacheRead) : 0,
        averageDurationMs: number(overview.avg_duration_ms),
        errorRate: requests > 0 ? number(overview.errors) / requests : 0,
      },
      timeline: timeline.map((row) => ({
        date: String(row.date),
        model: String(row.model),
        cost: number(row.cost),
        requests: number(row.requests),
      })),
      models: models.map((row) => ({
        provider: String(row.provider),
        model: String(row.model),
        requests: number(row.requests),
        cost: number(row.cost),
        tokens: {
          input: number(row.tokens_input),
          output: number(row.tokens_output),
          reasoning: number(row.tokens_reasoning),
          cacheRead: number(row.cache_read),
          cacheWrite: number(row.cache_write),
        },
        averageDurationMs: number(row.avg_duration_ms),
        errorRate: number(row.requests) > 0 ? number(row.errors) / number(row.requests) : 0,
      })),
      projects: projects.map((row) => ({
        id: String(row.project_id),
        name: projectLabel(row.project_name, row.directory),
        directory: String(row.directory ?? ""),
        sessions: number(row.sessions),
        requests: number(row.requests),
        cost: number(row.cost),
        lastActive: number(row.last_active),
      })),
      sessions: sessions.map((row) => ({
        id: String(row.session_id),
        title: String(row.session_title || "Untitled session"),
        project: projectLabel(row.project_name, row.directory),
        requests: number(row.requests),
        cost: number(row.cost),
        tokens: number(row.tokens),
        models: String(row.models ?? "").split(",").filter(Boolean),
        reasoningLevels: String(row.reasoning_levels ?? "Not recorded").split(",").filter(Boolean),
        lastActive: number(row.last_active),
      })),
    }
  }
}
