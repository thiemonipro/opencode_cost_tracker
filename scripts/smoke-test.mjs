import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { setTimeout } from "node:timers/promises"

const cli = fileURLToPath(new URL("../bin/opencode-cost-tracker.js", import.meta.url))
const directory = mkdtempSync(join(tmpdir(), "opencode-cost-smoke-"))
let child
let exited
let logs = ""

try {
  assert.match(execFileSync(process.execPath, [cli, "--help"], { cwd: directory, encoding: "utf8" }), /OPENCODE_DB_PATH/)
  const { default: metadata } = await import("../package.json", { with: { type: "json" } })
  assert.equal(execFileSync(process.execPath, [cli, "--version"], { cwd: directory, encoding: "utf8" }).trim(), metadata.version)

  const database = join(directory, "opencode.db")
  const db = new DatabaseSync(database)
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, directory TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    INSERT INTO project VALUES ('project', 'Smoke test');
    INSERT INTO session VALUES ('session', 'project', 'Test session', '/tmp/project');
    INSERT INTO message VALUES ('message', 'session', 1767268800000,
      '{"role":"assistant","providerID":"test","modelID":"test-model","cost":1.25,"tokens":{"input":100,"output":20}}');
  `)
  db.close()

  const socket = createServer()
  socket.listen(0, "127.0.0.1")
  await once(socket, "listening")
  const { port } = socket.address()
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()))

  child = spawn(process.execPath, [cli], {
    cwd: directory,
    env: { ...process.env, PORT: String(port), OPENCODE_DB_PATH: database },
    stdio: ["ignore", "pipe", "pipe"],
  })
  exited = once(child, "exit")
  child.stdout.on("data", (chunk) => { logs += chunk })
  child.stderr.on("data", (chunk) => { logs += chunk })

  const base = `http://127.0.0.1:${port}`
  let health
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      health = await fetch(`${base}/api/health`).then((response) => response.json())
      break
    } catch {
      if (child.exitCode !== null) break
      await setTimeout(100)
    }
  }
  assert.deepEqual(health, { ok: true, databasePath: database }, logs)
  const response = await fetch(`${base}/api/dashboard`)
  assert.equal(response.status, 200)
  const dashboard = await response.json()
  assert.equal(dashboard.overview.cost, 1.25)
  assert.equal(dashboard.overview.requests, 1)

  const html = await fetch(base).then((response) => response.text())
  assert.match(html, /<div id="root"><\/div>/)
  const asset = html.match(/src="(\/assets\/[^" ]+\.js)"/)[1]
  const script = await fetch(`${base}${asset}`)
  assert.equal(script.status, 200)
  assert.match(script.headers.get("content-type"), /javascript/)
  console.log("Production smoke test passed: CLI, database, API, dashboard, and assets.")
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM")
    await exited
  }
  rmSync(directory, { recursive: true, force: true })
}
