# OpenCode Cost Tracker

A local-first dashboard for understanding the estimated LLM cost recorded by OpenCode.

## Screenshots

![Dashboard overview](assets/dashboard-overview.png)

![Model, project, and session breakdowns](assets/dashboard-breakdowns.png)

![Most expensive sessions](assets/dashboard-sessions.png)

## Features

- Estimated cost and token totals
- Daily cost timeline grouped by model
- Model and project cost breakdowns
- Most expensive sessions
- Date, project, provider, and model filters
- Read-only access to the local OpenCode SQLite database

The application does not read or expose prompt and response content. OpenCode's recorded cost can represent API-equivalent pricing for subscription providers, so the dashboard labels it as estimated cost rather than an invoice amount.

## Requirements

- Node.js 24 or newer
- OpenCode with local session history

## Homebrew

```sh
brew install thiemonipro/tap/opencode-cost-tracker
opencode-cost-tracker
```

Open `http://localhost:4174`. Homebrew installs the Node.js runtime automatically.

Use `opencode-cost-tracker --help` for configuration or `--version` to check the installed version.

## Development

```sh
npm install
npm run dev
```

Open `http://localhost:5173`.

## Production

```sh
npm run build
npm start
```

Open `http://localhost:4174`.

The production build compiles the server to `build/server` and the dashboard to `dist`; running it does not require TypeScript tooling.

## Database Discovery

The server runs `opencode db path` and opens the result in read-only mode. Set `OPENCODE_DB_PATH` to use a different database:

```sh
OPENCODE_DB_PATH=/path/to/opencode.db npm start
```

For Homebrew installations, use `OPENCODE_DB_PATH=/path/to/opencode.db opencode-cost-tracker`.
Set `PORT` to change the listening port, for example `PORT=4180 opencode-cost-tracker`.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

## Publishing a Homebrew release

The formula lives in [thiemonipro/homebrew-tap](https://github.com/thiemonipro/homebrew-tap).

1. Update `version` in `package.json` and refresh the lockfile with `npm install --package-lock-only`.
2. Run the verification commands above and `npm run test:production`, commit, and push the changes.
3. Tag the commit as `v<version>` and publish a GitHub release.
4. Update the formula's release archive URL and SHA-256 checksum in the tap.
5. Run `brew install --build-from-source thiemonipro/tap/opencode-cost-tracker`, `brew test thiemonipro/tap/opencode-cost-tracker`, and `brew audit --strict thiemonipro/tap/opencode-cost-tracker` before pushing the tap update.

The formula builds from the tagged source using `npm ci`, then keeps only production dependencies. Users update with `brew update && brew upgrade opencode-cost-tracker`.

## License

MIT — see [LICENSE](LICENSE).
