# xfyun-coding-proxy

[中文](./docs/README.zh-CN.md)

A local proxy that forwards OpenAI-compatible API requests to iFlytek Xingchen Coding Plan API, for use with OpenCode, Cursor, Trae, and other coding tools.

> **Current version:** `0.0.1-alpha`
>
> This project is currently in an alpha preview stage, so APIs, configuration, and behavior may still change before the first stable release.
>
> See [`CHANGELOG.md`](./CHANGELOG.md) for version history.

## How It Works

```
OpenCode / Cursor / Trae / Other tools
        ↓  http://localhost:3000/v1/chat/completions
   ┌─────────────────────────┐
   │   Fastify Proxy          │
   │                         │
   │  1. API Key injection   │
   │  2. Request logging     │
   │  3. Forward to iFlytek  │
   │  4. SSE stream passthru │
   │  5. 429/503 auto-retry  │
   └─────────────────────────┘
        ↓  https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions
   iFlytek Xingchen Coding Plan API
```

## Features

- **API Key Injection** — Clients don't need the real key; the proxy replaces the `Authorization` header on forwarding
- **Path Rewriting** — `/v1/` → iFlytek `/v2/` prefix
- **GET & POST Proxy** — Forwards both `POST /v1/*` (chat completions) and `GET /v1/*` (models listing)
- **SSE Stream Passthrough** — Real-time streaming with non-standard iFlytek events filtered out (`progress_notice`, `context_usage`)
- **Field Cleanup** — Automatically removes iFlytek-specific fields like `reasoning_content`, `plugins_content`
- **Auto Retry** — Exponential backoff on HTTP 429/503 and iFlytek business error codes 10012, 10010, 10006
- **Logging** — Console (one-line readable) + daily-rotating local files (7-day retention)
- **Session Summary** — Prints request count, token usage, retries, errors, and uptime on exit

## Runtime Requirements

Choose the workflow that matches how you use the project:

| Scenario | Required runtime | Why |
|---|---|---|
| Develop from this source repository | **Bun** + **Node.js 20+** | `pnpm start` and `pnpm dev` invoke Bun directly; Node.js 20+ is the supported target for build, packaging, and the compiled output in `dist/`. |
| Run the built output or published package | **Node.js 20+** | The distributable entrypoint is `dist/index.js`, so Bun is not required once you are no longer running from source. |

## Quick Start

The steps below assume you are working from a source checkout and already have Bun installed.

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env and fill in XFYUN_API_KEY

# Start
pnpm start

# Dev mode (hot reload)
pnpm dev
```

By default, the proxy listens on `127.0.0.1:3000` and exposes an OpenAI-compatible base URL at `http://127.0.0.1:3000/v1`.

## Global Install

Install globally via npm (no Bun required):

```bash
npm i -g xfyun-coding-proxy
```

Create a configuration file:

```bash
mkdir -p ~/.config/xfyun-coding-proxy
cp .env.example ~/.config/xfyun-coding-proxy/config.env
# Edit config.env and fill in XFYUN_API_KEY
```

Run the proxy:

```bash
xfyun-coding-proxy start
# or with inline options
xfyun-coding-proxy start --api-key sk-xxx --port 3000
```

Or use npx without installing:

```bash
npx xfyun-coding-proxy start --api-key sk-xxx
```

## Development

Source development requires Bun because the local start, watch, and test scripts all call Bun directly. Keep Node.js 20+ available as the supported runtime target for `pnpm build`, package verification, and running compiled `dist/` output.

```bash
pnpm dev          # Start with hot reload
pnpm test         # Run tests
pnpm test:watch   # Run tests in watch mode
pnpm lint         # Lint code
pnpm format       # Format code
pnpm build        # Compile TypeScript to dist/
```

## Release Automation

This repository uses a tag-driven GitHub Actions workflow to keep npm publishes and GitHub Releases in sync.

1. Add an `NPM_TOKEN` repository secret in GitHub Actions settings.
2. Keep the current `## [Unreleased]` notes up to date in `CHANGELOG.md` (or add the target version heading manually if you prefer).
3. Preview the release with `pnpm release:auto:dry-run <version-or-bump>` (or `pnpm release:dry-run <version-or-bump>` if you only want the changelog preview).
4. Run `pnpm release:auto <version-or-bump> --yes` to automatically run tests, build, version bump, changelog promotion, local release commit creation, tag creation, and post-prepare verification.
5. Add `--push --yes` if you also want the script to push the release commit and tag for you.

After the tag is pushed, GitHub Actions will install dependencies, extract the matching version section from `CHANGELOG.md`, run the package's `prepublishOnly` checks (`pnpm test && pnpm build`), publish to npm, and then create the matching GitHub Release. Tags containing `-` are automatically marked as GitHub prereleases.

The GitHub Release body is sourced from the `CHANGELOG.md` section that matches the pushed tag. `pnpm release:prepare` and `pnpm release:auto` will create that version heading from `## [Unreleased]` when it does not already exist.

For local preparation, the repository provides five helper commands:

- `pnpm release:check` — verifies that `CHANGELOG.md` contains the heading for the current `package.json` version.
- `pnpm release:auto:dry-run patch` — previews the resolved version, planned checks, changelog migration, release notes source, and blockers without mutating the repository.
- `pnpm release:auto patch --yes` — runs the local automation workflow end to end: `pnpm test`, `pnpm build`, version bump, changelog preparation, release commit + tag creation, changelog verification, and `git diff --check`.
- `pnpm release:auto 0.0.2 --push --yes` — does the same local workflow and then runs `git push` plus `git push --tags`.
- `pnpm release:dry-run 0.0.2` — previews the target version, tag, changelog migration, release notes source, and blockers without mutating the repository.
- `pnpm release:prepare 0.0.2` — bumps the version, promotes the current `Unreleased` notes into `## [0.0.2] - YYYY-MM-DD` when needed, restores `## [Unreleased]` to the standard `Added / Changed / Fixed` template, validates `CHANGELOG.md`, creates a local `chore: release v0.0.2` commit, and creates the local tag `v0.0.2`.

`pnpm release:prepare` still does not push anything automatically; `pnpm release:auto` only pushes when you opt in with `--push`.

If you want the Release to be created automatically, publish through the tag workflow instead of running a local `npm publish` by itself.

## Configuration

Via `.env` file or environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Proxy listen port |
| `XFYUN_API_KEY` | Required | iFlytek Coding Plan API Key |
| `XFYUN_BASE_URL` | `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2` | iFlytek API Base URL |
| `MAX_RETRIES` | `3` | Max retry attempts |
| `RETRY_DELAY_MS` | `1000` | Initial retry delay (ms) |
| `XFYUN_LOG_DIR` | XDG state dir | Log output directory |
| `XFYUN_CODING_PROXY_CONFIG` | — | Path to a custom config file |

### CLI Options

You can also configure the proxy via CLI flags:

| Option | Description | Default |
|---|---|---|
| `-p, --port <port>` | Proxy listen port | `3000` |
| `-k, --api-key <key>` | iFlytek Coding Plan API key | none |
| `--base-url <url>` | iFlytek API base URL | `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2` |
| `--max-retries <n>` | Max retry attempts | `3` |
| `--retry-delay <ms>` | Initial retry delay in milliseconds | `1000` |
| `--log-dir <dir>` | Log output directory | XDG state dir |
| `-c, --config <path>` | Path to config file | auto-detected |
| `-v, --verbose` | Enable debug logging | `false` |

### Configuration Lookup Order

Configuration values are resolved with the following priority (highest first):

1. CLI flags (`--api-key`, `--port`, etc.)
2. Environment variables (`XFYUN_API_KEY`, `PORT`, etc.)
3. Config file specified by `--config` or `$XFYUN_CODING_PROXY_CONFIG`
4. `$XDG_CONFIG_HOME/xfyun-coding-proxy/config.env` (default: `~/.config/xfyun-coding-proxy/config.env`)
5. `.env` in the current working directory

## Client Configuration

### OpenCode

```json
{
  "provider": {
    "AstronCodingPlan": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "iFlytek Xingchen Coding Plan",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "local-proxy"
      }
    }
  }
}
```

### Cursor

Set Override OpenAI Base URL to `http://localhost:3000/v1`.

### Trae

When adding a custom OpenAI-compatible provider in Trae:

- set Custom URL to `http://127.0.0.1:3000/v1/chat/completions`;
- use any placeholder API key such as `local-proxy`;
- if Trae asks for a model name, you can keep a placeholder value — the proxy will override it to `astron-code-latest` before forwarding.

This proxy also includes Trae-specific compatibility handling:

- filters non-standard SSE events such as `progress_notice` and `context_usage` to avoid stream parsing errors;
- drops non-standard client headers that may be rejected by the upstream iFlytek service.

## Compatibility Notes

- The proxy listens on `127.0.0.1` by default and is intended for local use.
- Source checkout workflows use Bun for local development scripts; compiled `dist/` output and published packages target Node.js `>=20`.
- Incoming model values are overridden to `astron-code-latest` before forwarding upstream.
- String stream flags such as `"true"` are normalized to boolean `true` for upstream compatibility.
- Error responses are returned in an OpenAI-style `{ error: { message, type, code } }` structure.

## Project Structure

```
src/
├── index.ts    # CLI entry point (bin)
├── server.ts   # Fastify server creation + startup + graceful shutdown
├── proxy.ts    # Core proxy: forwarding + streaming + retry + SSE filter
├── cli.ts      # CLI argument parsing (commander subcommands)
├── config.ts   # Config: CLI args + env vars + config discovery + validation
├── stats.ts    # Session statistics tracking + exit summary
└── util.ts     # Token usage extraction + formatting
```

## Logging

- **Console**: One-line readable format via `@fastify/one-line-logger`
- **File**: Written to `<logDir>/proxy.log` via `pino-roll`, daily rotation, also rotates at 50MB, keeps last 7 files
  - Dev mode default: `./logs/proxy.log` (set `XFYUN_LOG_DIR=./logs` in `.env`)
  - Global install default: `~/.local/state/xfyun-coding-proxy/logs/proxy.log`

## Health Check

```
GET /health
```

Response:

```json
{ "status": "ok", "upstream": "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2" }
```

## License

MIT
