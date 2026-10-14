import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OpenCodeData, resolveDatabasePath } from "./data.js"

function createV2Schema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT,
      directory TEXT
    );
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `)
}

function addV2Message(
  db: DatabaseSync,
  id: string,
  session: string,
  date: string,
  model: string,
  cost: number,
  variant = "high",
) {
  const occurredAt = new Date(`${date}T12:00:00`).getTime()
  const data = {
    model: { providerID: "v2-provider", id: model, variant },
    cost,
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 40, write: 2 } },
    time: { created: occurredAt - 1_000, completed: occurredAt },
  }
  db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?)").run(
    id,
    session,
    "assistant",
    occurredAt,
    JSON.stringify(data),
  )
}

describe("resolveDatabasePath", () => {
  it("honors OPENCODE_DB_PATH without invoking the CLI", () => {
    const previous = process.env.OPENCODE_DB_PATH
    process.env.OPENCODE_DB_PATH = "/custom/opencode.db"
    try {
      expect(resolveDatabasePath(() => { throw new Error("should not run") })).toBe("/custom/opencode.db")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_DB_PATH
      else process.env.OPENCODE_DB_PATH = previous
    }
  })

  it("uses the V2 database path command first", () => {
    const previous = process.env.OPENCODE_DB_PATH
    delete process.env.OPENCODE_DB_PATH
    const calls: string[][] = []
    try {
      expect(resolveDatabasePath((args) => {
        calls.push(args)
        return "/v2/opencode.db\n"
      })).toBe("/v2/opencode.db")
      expect(calls).toEqual([["debug", "paths", "db"]])
    } finally {
      if (previous !== undefined) process.env.OPENCODE_DB_PATH = previous
    }
  })

  it("falls back to the legacy CLI command when needed", () => {
    const previous = process.env.OPENCODE_DB_PATH
    delete process.env.OPENCODE_DB_PATH
    const calls: string[][] = []
    try {
      expect(resolveDatabasePath((args) => {
        calls.push(args)
        if (args[0] === "debug") throw new Error("not a V2 CLI")
        return "/legacy/opencode.db"
      })).toBe("/legacy/opencode.db")
      expect(calls).toEqual([["debug", "paths", "db"], ["db", "path"]])
    } finally {
      if (previous !== undefined) process.env.OPENCODE_DB_PATH = previous
    }
  })
})

describe("OpenCodeData", () => {
  let directory: string
  let path: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "opencode-cost-test-"))
    path = join(directory, "opencode.db")
    const db = new DatabaseSync(path)
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        directory TEXT NOT NULL
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      INSERT INTO project VALUES ('project-a', NULL), ('project-b', 'Named project');
      INSERT INTO session VALUES
        ('session-a', 'project-a', 'First task', '/code/alpha'),
        ('session-b', 'project-b', 'Second task', '/code/beta');
    `)

    const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)")
    const add = (id: string, session: string, date: string, model: string, cost: number, cacheRead: number, variant?: string) => {
      const occurredAt = new Date(`${date}T12:00:00`).getTime()
      insert.run(id, session, occurredAt, JSON.stringify({
        role: "assistant",
        providerID: "test-provider",
        modelID: model,
        ...(variant ? { variant } : {}),
        cost,
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: cacheRead, write: 2 } },
        time: { created: occurredAt - 1_000, completed: occurredAt },
      }))
    }
    add("message-a", "session-a", "2026-01-01", "model-a", 1.25, 400, "high")
    add("message-b", "session-a", "2026-01-02", "model-b", 2.5, 100, "medium")
    add("message-c", "session-b", "2026-01-02", "model-a", 0.75, 0)
    db.close()
  })

  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  it("aggregates request-level costs and model usage", () => {
    const data = new OpenCodeData(path)
    const dashboard = data.dashboard()
    data.close()

    expect(dashboard.overview.cost).toBe(4.5)
    expect(dashboard.overview.requests).toBe(3)
    expect(dashboard.overview.sessions).toBe(2)
    expect(dashboard.models.map((model) => [model.model, model.cost])).toEqual([
      ["model-b", 2.5],
      ["model-a", 2],
    ])
    expect(dashboard.sessions[0]).toMatchObject({ id: "session-a", cost: 3.75, project: "alpha" })
    expect(dashboard.sessions[0].reasoningLevels).toEqual(expect.arrayContaining(["high", "medium"]))
    expect(dashboard.sessions.find((session) => session.id === "session-b")?.reasoningLevels).toEqual(["Not recorded"])
  })

  it("uses inclusive local calendar-day filters", () => {
    const data = new OpenCodeData(path)
    const dashboard = data.dashboard({ from: "2026-01-02", to: "2026-01-02" })
    data.close()

    expect(dashboard.overview.requests).toBe(2)
    expect(dashboard.overview.cost).toBe(3.25)
    expect(dashboard.timeline).toHaveLength(2)
    expect(dashboard.timeline.every((entry) => entry.date === "2026-01-02")).toBe(true)
  })

  it("supports a single calendar-day range", () => {
    const data = new OpenCodeData(path)
    const dashboard = data.dashboard({ from: "2026-01-01", to: "2026-01-01" })
    data.close()

    expect(dashboard.overview.requests).toBe(1)
    expect(dashboard.overview.cost).toBe(1.25)
    expect(dashboard.timeline).toEqual([
      expect.objectContaining({ date: "2026-01-01", model: "test-provider/model-a", cost: 1.25 }),
    ])
  })

  it("filters by project without changing filter options", () => {
    const data = new OpenCodeData(path)
    const dashboard = data.dashboard({ project: "project-b" })
    data.close()

    expect(dashboard.overview.cost).toBe(0.75)
    expect(dashboard.projects).toEqual([
      expect.objectContaining({ id: "project-b", name: "Named project" }),
    ])
    expect(dashboard.filters.projects).toHaveLength(2)
  })

  it("combines legacy and V2 messages without double-counting shared IDs", () => {
    const db = new DatabaseSync(path)
    createV2Schema(db)
    db.exec(`
      INSERT INTO project VALUES ('project-c', 'V2-only project');
      INSERT INTO session_v2 VALUES
        ('session-a', 'project-a', NULL, '/code/alpha-v2'),
        ('session-b', 'project-b', 'Updated V2 title', '/code/beta-v2'),
        ('session-c', 'project-c', 'V2-only session', '/code/gamma');
    `)
    addV2Message(db, "message-a", "session-a", "2026-01-01", "model-v2", 1.5, "low")
    addV2Message(db, "message-d", "session-a", "2026-01-03", "model-v2", 3, "high")
    addV2Message(db, "message-e", "session-c", "2026-01-03", "model-v2", 4, "medium")
    db.close()

    const data = new OpenCodeData(path)
    const dashboard = data.dashboard()
    expect(dashboard.overview).toMatchObject({ cost: 11.75, requests: 5, sessions: 3 })
    expect(dashboard.models.map((model) => [model.model, model.cost])).toEqual([
      ["model-v2", 8.5],
      ["model-b", 2.5],
      ["model-a", 0.75],
    ])
    expect(dashboard.sessions.find((session) => session.id === "session-a")).toMatchObject({
      title: "First task",
      cost: 7,
      requests: 3,
    })
    expect(dashboard.sessions.find((session) => session.id === "session-b")).toMatchObject({
      title: "Updated V2 title",
    })
    expect(dashboard.sessions.find((session) => session.id === "session-c")).toMatchObject({
      title: "V2-only session",
      cost: 4,
      project: "V2-only project",
    })

    const v2Project = data.dashboard({ project: "project-c" })
    expect(v2Project.overview).toMatchObject({ cost: 4, requests: 1, sessions: 1 })
    data.close()
  })

  it("reads a V2-only database", () => {
    const db = new DatabaseSync(path)
    db.exec("DROP TABLE message; DROP TABLE session;")
    createV2Schema(db)
    db.exec(`
      INSERT INTO session_v2 VALUES ('session-v2', 'project-a', 'V2 session', '/code/v2');
    `)
    addV2Message(db, "message-v2", "session-v2", "2026-01-04", "model-v2", 2.25)
    db.close()

    const data = new OpenCodeData(path)
    const dashboard = data.dashboard()
    data.close()

    expect(dashboard.overview).toMatchObject({ cost: 2.25, requests: 1, sessions: 1 })
    expect(dashboard.models[0]).toMatchObject({ provider: "v2-provider", model: "model-v2" })
  })
})
