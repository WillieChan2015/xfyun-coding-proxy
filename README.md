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

## Development

Source development requires Bun because the local start and watch scripts call Bun directly. Keep Node.js 20+ available as the supported runtime target for `pnpm build`, package verification, and running compiled `dist/` output.

```bash
pnpm dev          # Start with hot reload
pnpm test         # Run tests
pnpm test:watch   # Run tests in watch mode
pnpm lint         # Lint code
pnpm format       # Format code
pnpm build        # Compile TypeScript to dist/
```

## Configuration

Via `.env` file or environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Proxy listen port |
| `XFYUN_API_KEY` | Required | iFlytek Coding Plan API Key |
| `XFYUN_BASE_URL` | `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2` | iFlytek API Base URL |
| `MAX_RETRIES` | `3` | Max retry attempts |
| `RETRY_DELAY_MS` | `1000` | Initial retry delay (ms) |

### CLI Options

You can also configure the proxy via CLI flags:

| Option | Description | Default |
|---|---|---|
| `-p, --port <port>` | Proxy listen port | `3000` |
| `-k, --api-key <key>` | iFlytek Coding Plan API key | none |
| `--base-url <url>` | iFlytek API base URL | `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2` |
| `--max-retries <n>` | Max retry attempts | `3` |
| `--retry-delay <ms>` | Initial retry delay in milliseconds | `1000` |
| `-v, --verbose` | Enable debug logging | `false` |

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
├── index.ts    # Entry point, Fastify server, graceful shutdown
├── proxy.ts    # Core proxy: forwarding + streaming + retry + SSE filter
├── cli.ts      # CLI argument parsing (commander)
├── config.ts   # Config: CLI args + env vars + validation
├── stats.ts    # Session statistics tracking + exit summary
└── util.ts     # Token usage extraction + formatting
```

## Logging

- **Console**: One-line readable format via `@fastify/one-line-logger`
- **File**: Written to `./logs/proxy.log` via `pino-roll`, daily rotation, also rotates at 50MB, keeps last 7 files

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
