import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import { createApp } from "./app.js"
import { OpenCodeData } from "./data.js"

const port = Number(process.env.PORT ?? 4174)
const data = new OpenCodeData()
const app = createApp(data)

if (process.env.NODE_ENV === "production") {
  const dist = join(fileURLToPath(new URL("..", import.meta.url)), "dist")
  if (existsSync(dist)) {
    app.use(express.static(dist))
    app.get("/{*path}", (_request, response) => response.sendFile(join(dist, "index.html")))
  }
}

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`OpenCode Cost Tracker running at http://localhost:${port}`)
  console.log(`Reading ${data.databasePath}`)
})

function shutdown() {
  server.close(() => {
    data.close()
    process.exit(0)
  })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
