import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { Hono } from "hono"
import type { FetchService } from "../service/FetchService"
import { FetchBodyShape } from "./schemas/FetchSchemas"

/**
 * MCP server (Streamable HTTP, stateless) at `/mcp` with one tool per response type of `POST /fetch`:
 * `fetch_content` (plain content) and `fetch_details` (JSON wrapper as text).
 */
export class McpRouter {
  readonly router = new Hono()

  constructor(private fetchService: FetchService) {
    this.router.all("/mcp", async (c) => {
      // stateless: a fresh server + transport per request
      const server = this.createServer()
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })

      await server.connect(transport)

      return transport.handleRequest(c.req.raw)
    })
  }

  private createServer(): McpServer {
    const server = new McpServer({ name: "web-fetcher", version: "1.0.0" })

    server.registerTool(
      "fetch_content",
      {
        description:
          "Fetches an url while circumventing anti-bot detection and returns only the response content (HTML gets a <base href>).",
        inputSchema: FetchBodyShape,
      },
      async (args) => this.call(async () => this.fetchService.fetchContent(args)),
    )

    server.registerTool(
      "fetch_details",
      {
        description:
          "Fetches an url while circumventing anti-bot detection and returns a JSON with content, statusCode, headers, cookies, elapsedMs, finalUrl and engine.",
        inputSchema: FetchBodyShape,
      },
      async (args) => this.call(async () => JSON.stringify(await this.fetchService.fetchDetails(args))),
    )

    return server
  }

  private async call(action: () => Promise<string>) {
    try {
      return { content: [{ type: "text" as const, text: await action() }] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return { isError: true, content: [{ type: "text" as const, text: message }] }
    }
  }
}
