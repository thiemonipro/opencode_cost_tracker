import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OpenCodeData } from "./data.js"

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
})
