# Web Fetcher

**Web Fetcher** is a high-performance REST API and MCP server that fetches web pages while reliably bypassing modern anti-bot protections (Cloudflare, bot detection, JavaScript challenges).

The service uses an intelligent **two-tier escalation strategy**:
1. **[Impit](https://github.com/apify/impit)** (Ultra-fast): Performs lightweight HTTP requests using authentic browser TLS and HTTP/2 fingerprints (Chrome / Firefox) without the overhead of JavaScript execution.
2. **[Camoufox](https://github.com/daijro/camoufox)** (Fallback browser): If Impit encounters an error, receives an HTTP status `> 299`, or detects a JavaScript wall / challenge, Web Fetcher automatically escalates to Camoufox, an anti-detect headless Firefox browser.

---

## Features

- **⚡ Multi-Stage Anti-Bot Evasion**: Combines lightning-fast TLS fingerprint impersonation with a full anti-detect browser engine for heavy anti-bot challenges.
- **🛡️ Automatic Escalation & JS-Wall Detection**: Heuristically detects JavaScript walls, Cloudflare challenge screens, and empty client-rendered DOMs to escalate requests on the fly.
- **🍪 Persistent Cookie & Profile Management**: Maintains separate persistent browser profiles (`js/` and `nojs/`) to reuse clearance tokens (e.g., Cloudflare cookies) across requests.
- **📦 Dual Delivery Modes**:
  - Direct raw content (`/fetch`) preserving the original `Content-Type` with metadata in HTTP headers.
  - Comprehensive JSON wrapper (`/fetch/details`) with parsed cookies, headers, execution time, and base64-encoded binary support.
- **🔄 Smart Content Decoding & HTML Sanitization**: Automatically decodes character sets into UTF-8 and injects `<base href>` tags into HTML responses to ensure relative asset links remain valid.
- **📜 Lazy-Loading & Dynamic Content**: Optional automatic page scrolling in Camoufox to trigger and capture lazy-loaded assets.
- **🤖 Built-In MCP Server**: Stateless, Streamable HTTP `/mcp` endpoint providing `fetch_content` and `fetch_details` tools for direct integration into AI agents and LLM workflows.
- **🔒 SSRF Protection**: Built-in URL guard blocks requests to localhost, private subnets (RFC 1918), link-local addresses (cloud metadata APIs), and IPv6 equivalents.
- **📊 Observability & Documentation**: Comes with built-in Swagger UI (`/swagger-ui`), OpenAPI 3.0 schema (`/openapi.json`), Prometheus metrics (`/metrics`), and health checks (`/health`).

---

## Running the Service

### Docker Images & Tags

Pre-built multi-architecture container images supporting both **amd64** and **arm64** are available:

- **Registry Image**: `ghcr.io/dankito/web-fetcher`
- **Tags**:
  - Major version: `<major>` (e.g., `1`)
  - Minor version: `<major>.<minor>` (e.g., `1.0`)
  - Patch version: `<major>.<minor>.<patch>` (e.g., `1.0.0`)
  - Latest release: `latest`

### Option 1: Run with Docker CLI

```bash
docker run -d \
  --name web-fetcher \
  -p 3031:3031 \
  -v web-fetcher-data:/data/camoufox \
  ghcr.io/dankito/web-fetcher:latest
```

> **💡 Persistence Hint:**
> Camoufox stores persistent browser profiles and retrieved cookies (such as Cloudflare clearance cookies) in `/data/camoufox`. To preserve these cookies across container restarts and updates, mount a persistent volume to `/data` or `/data/camoufox`.

### Option 2: Run with Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  web-fetcher:
    image: ghcr.io/dankito/web-fetcher:latest
    container_name: web-fetcher
    restart: unless-stopped
    ports:
      - "3031:3031"
    environment:
      # Optional: configure the port and interface to listen on:
      - HOST=0.0.0.0
      - PORT=3031
      - ALLOW_LOCAL_ADDRESSES=false
    volumes:
      - web-fetcher-data:/data

volumes:
  web-fetcher-data:
```

Start the container:

```bash
docker compose up -d
```

### Option 3: Run from Source

Prerequisites: [Bun](https://bun.sh/) (version 1.1 or higher).

```bash
# Clone the repository
git clone https://github.com/dankito/WebFetcher.git
cd WebFetcher

# Install dependencies
bun install

# Download Camoufox browser binaries (one-time setup; also triggered automatically on first run if missing)
bun run camoufox:fetch

# Start the server
bun run start

# Or start in watch mode for development
bun run dev
```

---

## Configuration

Configure Web Fetcher using the following environment variables:

| Variable                | Default                          | Description                                                                                                                                              |
|-------------------------|----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `PORT`                  | `3031`                           | Port number the HTTP server listens on.                                                                                                                  |
| `HOST`                  | `127.0.0.1` (Docker: `0.0.0.0` ) | Host address or IP to bind to.                                                                                                                           | 
| `BASE_PATH`             | `""` *(empty)*                   | URL prefix for all API routes (e.g., `/web-fetcher`). Empty string means root path. *(Note: `/metrics` and request logger always listen at root level).* |
| `CAMOUFOX_DATA_DIR`     | `./data/camoufox`                | Directory where persistent Camoufox browser profiles (`js/` and `nojs/`) are stored.                                                                     |
| `CAMOUFOX_IDLE_TIMEOUT` | `300` (Docker: `900`)            | Inactivity timeout in seconds before idle Camoufox browser instances are unloaded from memory.                                                           |
| `ALLOW_LOCAL_ADDRESSES` | `false`                          | Set to `true` to allow fetching localhost, private network addresses (RFC 1918), and link-local cloud metadata (disables SSRF protection).               |

---

## API Endpoints

### 1. Fetch Raw Content (`GET|POST /fetch`)

Fetches a URL and returns the raw response body with its original `Content-Type`. Text content is always decoded and returned as UTF-8 (with automatic `<base href>` tag injection for HTML). Binary responses (images, PDFs, archives) are returned as raw bytes.

Response metadata is exposed via custom `X-Fetch-*` HTTP headers:
- `X-Fetch-Engine`: The engine that fetched the response (`Impit` or `Camoufox`).
- `X-Fetch-Status`: HTTP status code returned by the destination server.
- `X-Fetch-Final-Url`: Final URL after following redirects.
- `X-Fetch-Header-<name>`: Original response headers received from the target.
- `X-Fetch-Cookie`: Raw `Set-Cookie` header values.

### 2. Fetch Detailed JSON Wrapper (`GET|POST /fetch/details`)

Fetches a URL and returns a comprehensive JSON object containing content, status code, response headers, parsed cookies, timing, and engine information.

#### JSON Response Schema (`/fetch/details`):

```json
{
  "statusCode": 200,
  "contentEncoding": "Text",
  "contentType": "text/html; charset=utf-8",
  "finalUrl": "https://example.com/",
  "engine": "Impit",
  "elapsedMs": 245,
  "headers": {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "max-age=604800"
  },
  "cookies": [
    "session=abc123xyz; Path=/; Secure; HttpOnly"
  ],
  "cookiesParsed": [
    {
      "name": "session",
      "value": "abc123xyz",
      "path": "/",
      "secure": true,
      "httpOnly": true
    }
  ],
  "content": "<!doctype html><html><head><base href=\"https://example.com/\">...</head><body>...</body></html>"
}
```

*Note: For binary responses (e.g., images, PDFs), `contentEncoding` is set to `"Base64"` and `content` contains the base64-encoded string.*

---

### Request Parameters

Parameters can be supplied as URL query parameters (`GET`) or as a JSON request body (`POST`).

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | `string` | **Yes** | — | Target URL to fetch (`http://` or `https://`). |
| `timeout` | `number` | No | None | Request timeout in seconds. Omitted or `< 1` disables timeout. |
| `fingerprint` | `string` | No | `"chrome"` | Browser TLS fingerprint (e.g., `chrome`, `firefox`, `chrome131`, `firefox144`). Unsupported version numbers automatically fall back to the closest match. Camoufox always uses Firefox. |
| `followRedirects` | `boolean` | No | `true` | Whether to follow HTTP redirects. *(Ignored by Camoufox, as a real browser always follows redirects).* |
| `engines` | `string[]` / `string` | No | `["Impit", "Camoufox"]` | Ordered list of engines to try. In `GET`, pass comma-separated (`engines=Impit,Camoufox`) or repeated query keys. |
| `executeJavaScript` | `boolean` | No | `undefined` | Controls JavaScript execution: <br>• `true`: Skips Impit and executes via Camoufox with JS enabled.<br>• `false`: Disables JS in Camoufox and prevents escalation on JS walls.<br>• *Omitted*: Default escalation behavior. |
| `loadLazyContent` | `boolean` | No | `false` | When `true`, Camoufox scrolls down the page to trigger dynamic lazy-loading. Skips Impit. |
| `headers` | `Record<string, string>` | No | `undefined` | **POST only**: Custom HTTP request headers to send to the target URL. |
| `cookies` | `Record<string, string>` | No | `undefined` | **POST only**: Custom cookies (`name -> value` pairs) to send to the target URL. |

#### Example: POST Request (`/fetch/details`)

```bash
curl -X POST http://localhost:3031/fetch/details \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "timeout": 15,
    "fingerprint": "chrome",
    "executeJavaScript": true,
    "headers": {
      "Accept-Language": "en-US,en;q=0.9"
    },
    "cookies": {
      "user_pref": "dark_mode"
    }
  }'
```

---

### Error Handling

If fetching fails, Web Fetcher returns a JSON error response with details about engine attempts:

| HTTP Status | Reason | Description |
|---|---|---|
| `400` | `NoApplicableEngine` | Invalid parameters or no applicable engine found for the given criteria. |
| `403` | `ForbiddenAddress` | Blocked target address (SSRF protection: localhost, private subnets, cloud metadata). |
| `502` | `AllEnginesFailed` | All attempted engines failed to retrieve a successful response. |
| `504` | `Timeout` | All attempted engines timed out. |

#### Error Response Format:

```json
{
  "error": "Fetching failed with all engines (Impit: HTTP status 403; Camoufox: goto: Timeout 10000ms exceeded)",
  "reason": "AllEnginesFailed",
  "engineFailures": [
    {
      "engine": "Impit",
      "kind": "HttpStatus",
      "message": "HTTP status 403",
      "statusCode": 403
    },
    {
      "engine": "Camoufox",
      "kind": "Timeout",
      "message": "goto: Timeout 10000ms exceeded"
    }
  ]
}
```

---

### Other Endpoints

| Endpoint        | Method         | Description                                                                                                                              |
|-----------------|----------------|------------------------------------------------------------------------------------------------------------------------------------------|
| `/mcp`          | `GET` / `POST` | Stateless Streamable HTTP [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) endpoint for AI assistants and agentic tools. |
| `/openapi.json` | `GET`          | OpenAPI 3.0 JSON specification describing all routes and data schemas.                                                                   |
| `/swagger-ui`   | `GET`          | Interactive Swagger UI documentation and testing console.                                                                                |
| `/health`       | `GET`          | Service health status returning `{ "status": "ok", "timestamp": "..." }`.                                                                |
| `/metrics`      | `GET`          | Prometheus metrics endpoint for monitoring request rates, latencies, and status codes.                                                   |

---

## Model Context Protocol (MCP) Tools

Web Fetcher exposes a stateless Streamable HTTP MCP server at `/mcp` compatible with AI assistants (e.g. Claude Desktop, Cursor, Junie, LangChain):

| Tool Name       | Required Parameters | Description                                                                                                                  |
|-----------------|---------------------|------------------------------------------------------------------------------------------------------------------------------|
| `fetch_content` | `url`               | Fetches a URL and returns only the plain content (text as plain text, binary assets as embedded resource blobs).             |
| `fetch_details` | `url`               | Fetches a URL and returns the full JSON details wrapper (status code, headers, parsed cookies, execution time, and content). |

> **💡 Note on Tool Parameters:**
> All MCP tools accept the exact same input parameters and default values as `POST /fetch` and `POST /fetch/details` (`url`, `timeout`, `fingerprint`, `followRedirects`, `engines`, `executeJavaScript`, `loadLazyContent`, `headers`, `cookies`).

### Example MCP Server Configuration (Claude Desktop / Cursor)

```json
{
  "mcpServers": {
    "web-fetcher": {
      "url": "http://localhost:3031/mcp"
    }
  }
}
```

---

## Security & SSRF Protection

By default, Web Fetcher protects against **Server-Side Request Forgery (SSRF)**:
- Rejects requests resolving to `localhost`, loopback addresses (`127.0.0.0/8`, `::1`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), link-local addresses (`169.254.0.0/16`, `fe80::/10`), and IPv4-mapped IPv6 equivalents.
- Hostnames are resolved via DNS and every IP is checked.
- To allow internal network requests in trusted environments, set `ALLOW_LOCAL_ADDRESSES=true`.

---

## Testing

```bash
# Run offline unit tests
bun run test

# Run tests against live protected websites (requires Internet connection and Camoufox)
bun run test:protected

# Check TypeScript types
bun run typecheck
```

---

## License

MIT license, see [LICENSE](LICENSE) for details.
