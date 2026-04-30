# xfyun-coding-proxy

[中文](./docs/README.zh-CN.md)

A local proxy that forwards OpenAI-compatible API requests to iFlytek Xingchen Coding Plan API, for use with OpenCode, Cursor, and other coding tools.

## How It Works

```
OpenCode / Cursor / Other tools
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
- **SSE Stream Passthrough** — Real-time streaming with non-standard iFlytek events filtered out (`progress_notice`, `context_usage`)
- **Field Cleanup** — Automatically removes iFlytek-specific fields like `reasoning_content`, `plugins_content`
- **Auto Retry** — Exponential backoff on HTTP 429/503 and iFlytek business error code 10012
- **Logging** — Console (one-line readable) + daily-rotating local files (7-day retention)

## Quick Start

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

## Development

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

## Project Structure

```
src/
├── index.ts    # Entry point, Fastify server, graceful shutdown
├── proxy.ts    # Core proxy: forwarding + streaming + retry + SSE filter
├── cli.ts      # CLI argument parsing (commander)
├── config.ts   # Config: CLI args + env vars + validation
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
