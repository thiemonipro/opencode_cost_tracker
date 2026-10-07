#!/usr/bin/env node
import { readFileSync } from "node:fs"

const args = process.argv.slice(2)

if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  console.log(version)
} else if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log(`Usage: opencode-cost-tracker [--help | --version]

Start the local dashboard at http://localhost:4174.

Environment variables:
  PORT              Server port (default: 4174)
  OPENCODE_DB_PATH  Path to the OpenCode SQLite database

Without OPENCODE_DB_PATH, the database is discovered automatically.`)
} else if (args.length > 0) {
  console.error("Unknown arguments. Run opencode-cost-tracker --help for usage.")
  process.exitCode = 1
} else {
  process.env.NODE_ENV = "production"
  await import("../build/server/index.js")
}
