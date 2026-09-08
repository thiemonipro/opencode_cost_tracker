import express from "express"
import type { DashboardFilters } from "./data.js"
import { OpenCodeData } from "./data.js"

function stringParam(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function createApp(data: OpenCodeData) {
  const app = express()

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, databasePath: data.databasePath })
  })

  app.get("/api/dashboard", (request, response, next) => {
    try {
      const filters: DashboardFilters = {
        from: stringParam(request.query.from),
        to: stringParam(request.query.to),
        project: stringParam(request.query.project),
        provider: stringParam(request.query.provider),
        model: stringParam(request.query.model),
      }
      response.json(data.dashboard(filters))
    } catch (error) {
      next(error)
    }
  })

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error)
    response.status(500).json({
      error: "Unable to read OpenCode usage data",
      detail: error instanceof Error ? error.message : String(error),
    })
  })

  return app
}
