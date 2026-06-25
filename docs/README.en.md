# maas-coding-proxy

[![npm](https://img.shields.io/npm/v/maas-coding-proxy.svg)](https://www.npmjs.com/package/maas-coding-proxy) [![npm](https://img.shields.io/npm/dm/maas-coding-proxy.svg)](https://www.npmjs.com/package/maas-coding-proxy)

[中文](../README.md)

A local proxy that forwards OpenAI-compatible API requests to iFlytek Xingchen Coding Plan API, for use with OpenCode, Cursor, Trae, and other coding tools.

> **Current version:** `0.0.8-beta.3`
>
> This project is currently in an alpha preview stage, so APIs, configuration, and behavior may still change before the first stable release.
>
> See [`CHANGELOG.md`](../CHANGELOG.md) for version history.

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

### Anthropic Protocol

```
Claude Code / Cursor (Anthropic mode)
        ↓  http://localhost:3000/anthropic/v1/messages
   ┌─────────────────────────┐
   │   Fastify Proxy          │
   │                         │
   │  1. API Key injection   │
   │  2. Model override      │
   │  3. Forward to iFlytek  │
   │  4. SSE stream passthru │
   │  5. 429/503/529 auto-retry│
   └─────────────────────────┘
        ↓  https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic/v1/messages
   iFlytek Anthropic-compatible endpoint
```

## Features

- **API Key Injection** — Clients don't need the real key; the proxy replaces the `Authorization` header on forwarding
- **Path Rewriting** — `/v1/` → iFlytek `/v2/` prefix
- **GET & POST Proxy** — Forwards both `POST /v1/*` (chat completions) and `GET /v1/*` (models listing)
- **SSE Stream Passthrough** — Real-time streaming with non-standard iFlytek events filtered out (`progress_notice`, `context_usage`)
- **Field Cleanup** — Automatically removes iFlytek-specific fields like `reasoning_content`, `plugins_content`
- **Auto Retry** — Exponential backoff on HTTP 429/503 and iFlytek business error codes 10012, 10010, 11210
- **Logging** — Console (one-line readable) + daily-rotating local files (7-day retention)
- **Session Summary** — Prints request count, token usage, retries, errors, and uptime on exit
- **Daily Statistics** — Aggregates usage across sessions per day, persists to local files, and supports CLI history queries
- **Ollama Protocol Compatibility** — `/ollama/api/chat`, `/ollama/api/generate`, `/ollama/api/tags`, `/ollama/api/version`, `/ollama/api/show` routes that automatically convert Ollama native protocol requests to OpenAI format for forwarding, and convert responses back to Ollama NDJSON format; also supports `/ollama/v1/chat/completions` and `/ollama/v1/models` for VS Code Continue.dev; unprefixed routes (`/api/chat`, `/api/generate`, etc.) are also supported for clients that set Base URL to `http://localhost:3000`
- **Anthropic Protocol Compatibility** — `/anthropic/v1/messages` route, passthrough Anthropic Messages API requests to iFlytek Anthropic-compatible endpoint, supporting Claude Code / Cursor (Anthropic mode) and other clients
- **One-Click Client Setup** — `maas-coding-proxy setup` subcommand for interactive configuration of Claude Code and other clients, with automatic installation detection, change preview, backup, and config writing
- **Real-Time Monitor Dashboard** — Auto-displayed Ink TUI panel on startup (enabled by default), showing request rate, success rate, token usage, concurrent/streaming request counts, latency stats, and request log stream; keyboard controls: `q` quit, `↑↓` scroll, `←→` page, `e` toggle errors, `r` reset daily stats; disable with `--no-monitor` or `MONITOR=false`

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

By default, the proxy listens on `127.0.0.1:3000` and exposes an OpenAI-compatible base URL at `http://127.0.0.1:3000/v1`, an Ollama protocol base URL at `http://127.0.0.1:3000/ollama`, and an Anthropic protocol base URL at `http://127.0.0.1:3000/anthropic`.

### One-Click Claude Code Setup

```bash
maas-coding-proxy setup
```

Interactive setup wizard for configuring Claude Code to use the local proxy:
1. Choose client type (Claude Code / Cursor / Trae / OpenCode)
2. Auto-detect Claude Code installation
3. Preview configuration changes
4. Choose write method (settings.json or .env)
5. Back up original config and write changes

Non-interactive mode (for scripted scenarios):

```bash
maas-coding-proxy setup --non-interactive
```

### View and Restore Backups

```bash
# List all backups
maas-coding-proxy setup restore --list

# Interactively select and restore a backup
maas-coding-proxy setup restore

# Restore the latest backup (non-interactive)
maas-coding-proxy setup restore --latest --non-interactive
```

## Global Install

Install globally via npm (no Bun required): [npm package](https://www.npmjs.com/package/maas-coding-proxy)

```bash
npm i -g maas-coding-proxy
```

Create a configuration file:

```bash
mkdir -p ~/.config/maas-coding-proxy
cp .env.example ~/.config/maas-coding-proxy/config.env
# Edit config.env and fill in XFYUN_API_KEY
```

Run the proxy:

```bash
maas-coding-proxy start
# or with inline options
maas-coding-proxy start --api-key sk-xxx --port 3000
```

Or use npx without installing:

```bash
npx maas-coding-proxy start --api-key sk-xxx
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

This repository uses a **tag-driven** GitHub Actions workflow to keep npm publishes and GitHub Releases in sync.

1. Add an `NPM_TOKEN` repository secret in GitHub Actions settings.
2. Keep the `## [Unreleased]` notes up to date in `CHANGELOG.md`.
3. Run `pnpm release:auto <version-or-bump> --push --yes` to automatically run tests, build, version bump, changelog promotion, commit, tag creation, and push.

After the tag is pushed, GitHub Actions automatically installs dependencies, extracts the changelog section, runs `prepublishOnly` checks, publishes to npm, and creates the GitHub Release.

Preview locally first with `pnpm release:auto:dry-run <version-or-bump>` without mutating the repository. See `CHANGELOG.md` or `pnpm release:auto --help` for details.

## Configuration

Via `.env` file or environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Proxy listen port |
| `XFYUN_API_KEY` | Required | iFlytek Coding Plan API Key |
| `XFYUN_BASE_URL` | `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2` | iFlytek API Base URL |
| `XFYUN_ANTHROPIC_BASE_URL` | `https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic` | iFlytek Anthropic protocol endpoint Base URL |
| `MAX_RETRIES` | `3` | Max retry attempts |
| `RETRY_DELAY_MS` | `1000` | Initial retry delay (ms) |
| `XFYUN_LOG_DIR` | XDG state dir | Log output directory |
| `MAAS_CODING_PROXY_CONFIG` | — | Path to a custom config file |
| `STATS_FLUSH_INTERVAL_MS` | `60000` | Daily stats flush interval (ms), set to `0` to disable |
| `STREAM_READ_TIMEOUT_MS` | `60000` | Stream SSE single read timeout (ms), prevents hang when upstream stops sending |
| `UPSTREAM_FETCH_TIMEOUT_MS` | `300000` | Upstream fetch total timeout (ms), covers connection + full streaming duration |
| `VERBOSE` | `false` | Enable debug logging (equivalent to `--verbose`) |
| `DEBUG_PROXY` | — | Set to `1` to enable debug logging (equivalent to `--debug`) |

### CLI Options

You can also configure the proxy via CLI flags:

| Option | Description | Default |
|---|---|---|
| `-p, --port <port>` | Proxy listen port | `3000` |
| `-k, --api-key <key>` | iFlytek Coding Plan API key | none |
| `--base-url <url>` | iFlytek API base URL | `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2` |
| `--anthropic-base-url <url>` | iFlytek Anthropic API base URL | `https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic` |
| `--max-retries <n>` | Max retry attempts | `3` |
| `--retry-delay <ms>` | Initial retry delay in milliseconds | `1000` |
| `--log-dir <dir>` | Log output directory | XDG state dir |
| `-c, --config <path>` | Path to config file | auto-detected |
| `-v, --verbose` | Enable debug logging | `false` |
| `--debug` | Enable request/response debug logging to `logs/debug/` (NDJSON format) | No |
| `--no-monitor` | Disable real-time monitor dashboard, use standard logging | enabled by default |

### Configuration Lookup Order

Configuration values are resolved with the following priority (highest first):

1. CLI flags (`--api-key`, `--port`, etc.)
2. Environment variables (`XFYUN_API_KEY`, `PORT`, etc.)
3. Config file specified by `--config` or `$MAAS_CODING_PROXY_CONFIG`
4. `$XDG_CONFIG_HOME/maas-coding-proxy/config.env` (default: `~/.config/maas-coding-proxy/config.env`, legacy `~/.config/xfyun-coding-proxy/config.env` is still supported)
5. `.env` in the current working directory

## Debugging

Enable debug logging when troubleshooting request issues:

```bash
maas-coding-proxy start --debug
# or
DEBUG_PROXY=1 maas-coding-proxy start
```

Debug logs are written as NDJSON to `logs/debug/YYYY-MM-DD.ndjson` and contain complete client requests, upstream responses, and proxy responses.

**Note:** Debug logs include sensitive information such as Authorization headers. Only use for troubleshooting; do not enable in production.

## Usage Statistics

The proxy automatically tracks token usage per request, aggregates it by day, and persists it to `<logDir>/stats/YYYY-MM-DD.json`. The Session Summary printed on exit includes a "Today" line showing the daily cumulative total.

### CLI Queries

```bash
# Show today's usage
maas-coding-proxy stats

# Show usage for a specific date
maas-coding-proxy stats --date 2025-05-05
maas-coding-proxy stats -d 2025-05-05

# List all dates with recorded stats
maas-coding-proxy stats --list
maas-coding-proxy stats -l
```

### Output Examples

**Today / specific date:**

```
════════════════════════════════════════════════
  Daily Stats — 2025-05-06
════════════════════════════════════════════════
  Requests:       42
  Tokens:         23.5k(23500)
    Input:        15.0k(15000)
    Output:       8.5k(8500)
  Retries:        3
  Errors:         1
════════════════════════════════════════════════
```

**History list:**

```
════════════════════════════════════════════════
  Usage History
════════════════════════════════════════════════
  Date         Requests   Tokens
  2025-05-06   42         23.5k(23500)
  2025-05-05   28         15.2k(15200)
════════════════════════════════════════════════
```

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

### Ollama Clients (Open WebUI / Continue.dev)

The proxy supports the Ollama native protocol. Ollama clients can point their Base URL to the proxy:

- Set Ollama Base URL to `http://localhost:3000/ollama`
- Supported endpoints: `POST /ollama/api/chat`, `POST /ollama/api/generate`, `GET /ollama/api/tags`, `GET /ollama/api/version`, `POST /ollama/api/show`, `POST /ollama/v1/chat/completions`, `GET /ollama/v1/models`
- Also supports unprefixed routes (`/api/chat`, `/api/generate`, etc.) for clients that set Base URL to `http://localhost:3000`
- Model names are overridden to `astron-code-latest` before forwarding
- Streaming responses use NDJSON format (`application/x-ndjson`)

Open WebUI: set the Ollama API URL to `http://localhost:3000/ollama`.

Continue.dev config example see the VS Code section below.

### Claude Code

Point the Anthropic API configuration to the proxy:

- Set Base URL to `http://localhost:3000/anthropic`
- Use a placeholder API key (e.g. `local-proxy`); the proxy will replace it with the real key on forwarding
- Model names are overridden to `astron-code-latest` before forwarding

> You can also use `maas-coding-proxy setup` to complete the above configuration automatically.

### VS Code (Continue.dev / Cline / Copilot)

**Continue.dev** config example (`~/.continue/config.yaml`):

```yaml
models:
  - name: iFlytek Xingchen
    provider: ollama
    model: astron-code-latest
    apiBase: http://localhost:3000/ollama
    roles:
      - chat
      - edit
```

**Cline** setup steps:

1. Open the Cline sidebar and click the settings icon
2. Set API Provider to **Ollama**
3. Set Base URL to `http://localhost:3000/ollama`
4. Select model `astron-code-latest`

**GitHub Copilot** custom model (requires VS Code 1.104+ / Insiders):

1. Open Copilot Chat, click the model picker → **Manage Models…**
2. Click **+ Add Models…** and select **OpenAI Compatible**
3. Enter a provider name (e.g. `iFlytek`), and use a placeholder API key (e.g. `local-proxy`)
4. Enter the custom Base URL: `http://localhost:3000/ollama`
5. After saving, Copilot will automatically refresh the model list and display the new model
6. Enable the model in the model management list, and it will appear in the Chat model picker

## Compatibility Notes

- The proxy listens on `127.0.0.1` by default and is intended for local use.
- Source checkout workflows use Bun for local development scripts; compiled `dist/` output and published packages target Node.js `>=20`.
- Incoming model values are overridden to `astron-code-latest` before forwarding upstream.
- String stream flags such as `"true"` are normalized to boolean `true` for upstream compatibility.
- Error responses are returned in an OpenAI-style `{ error: { message, type, code } }` structure.
- Ollama protocol routes use the `/ollama` prefix, supporting `/api/chat`, `/api/generate`, `/api/tags`, `/api/version`, `/api/show`, `/v1/chat/completions`, and `/v1/models` endpoints. Unprefixed routes (`/api/chat`, etc.) are also supported for clients that set Base URL directly to `http://localhost:3000`.
- Ollama-specific local parameters (`keep_alive`, `options.top_k`, `options.num_ctx`, etc.) are silently dropped.
- Ollama streaming responses use NDJSON format (`application/x-ndjson`), unlike OpenAI's SSE format.
- Anthropic protocol routes use the `/anthropic` prefix, supporting the `/v1/messages` endpoint.
- Anthropic protocol features such as Extended Thinking, Vision, and Tool Use are passed through without protocol conversion.
- Anthropic streaming responses use SSE format (`text/event-stream`), unlike Ollama's NDJSON format.
- The `setup` subcommand supports configuring Claude Code; support for more clients will be added in future releases. `setup restore` allows viewing and restoring backup configurations.
- Config files are automatically backed up before writing (backup filenames include a timestamp).

## Project Structure

```
src/
├── index.ts        # CLI entry point (bin)
├── server.ts       # Fastify server creation + startup + graceful shutdown
├── proxy.ts        # Core proxy: forwarding + streaming + retry + SSE filter
├── upstream.ts     # Shared upstream layer: fetchWithRetry, SSEFilter, safeSend, handleUpstreamResult
├── errors.ts       # Error formatting utilities
├── cli.ts          # CLI argument parsing (commander subcommands)
├── config.ts       # Config: CLI args + env vars + config discovery + validation
├── util.ts         # Token usage extraction + formatting
├── types/
│   └── openai.ts   # OpenAI protocol type guards
├── ollama/
│   ├── types.ts    # Ollama protocol type definitions
│   ├── request.ts  # Ollama → OpenAI request conversion
│   ├── response.ts # OpenAI → Ollama response conversion (incl. SSE→NDJSON)
│   └── handler.ts  # Ollama route handlers
├── anthropic/
│   ├── types.ts    # Anthropic protocol type definitions
│   └── handler.ts  # Anthropic route handlers
├── setup/
│   ├── types.ts        # Client type definitions and registry
│   ├── claude-code.ts  # Claude Code configuration logic
│   └── restore-cmd.ts  # setup restore subcommand handler
├── monitor/
│   ├── entry.ts    # Ink monitor panel entry
│   ├── index.ts    # Panel components
│   └── types.d.ts  # Type declarations
├── stats.ts            # Session stats + exit summary
├── stats-store.ts      # Stats data store
├── stats-persistence.ts # Stats persistence (read/write JSON)
├── stats-display.ts    # Stats formatted output
├── stats-types.ts      # Stats type definitions
├── stats-cmd.ts        # CLI stats subcommand handler
├── setup-cmd.ts        # setup subcommand handler
└── update-check.ts     # npm version update check
```

## Logging

- **Console**: One-line readable format via `@fastify/one-line-logger`
- **File**: Written to `<logDir>/proxy.log` via `pino-roll`, daily rotation, also rotates at 50MB, keeps last 7 files
  - Dev mode default: `./logs/proxy.log` (set `XFYUN_LOG_DIR=./logs` in `.env`)
  - Global install default: `~/.local/state/maas-coding-proxy/logs/proxy.log`

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
