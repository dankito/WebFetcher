import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Hono } from "hono"
import { FetchError } from "../model/FetchError"
import { FetchRequest } from "../model/FetchRequest"
import type { FetchService } from "../service/FetchService"
import { FetchBodyShape } from "./schemas/FetchSchemas"

/**
 * MCP server (Streamable HTTP, stateless) at `/mcp` with one tool per POST endpoint:
 * `fetch_content` (`POST /fetch`) and `fetch_details` (`POST /fetch/details`).
 */
export class McpRouter {
  readonly router = new Hono()

  constructor(private readonly fetchService: FetchService) {
    this.router.all("/mcp", async context => {
      // stateless: a fresh server + transport per request
      const server = this.createServer()
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })

      await server.connect(transport)

      return transport.handleRequest(context.req.raw)
    })
  }

  private createServer(): McpServer {
    const server = new McpServer({ name: "web-fetcher", version: "1.0.0" })

    server.registerTool(
      "fetch_content",
      {
        description:
          "Fetches an url while circumventing anti-bot detection and returns only the response content: text, or for binary content (images, PDFs, ...) an embedded resource.",
        inputSchema: FetchBodyShape,
      },
      args => this.fetchContent(FetchRequest.from(args)),
    )

    server.registerTool(
      "fetch_details",
      {
        description:
          "Fetches an url while circumventing anti-bot detection and returns a JSON with content (base64 for binary content), contentEncoding, statusCode, headers, cookies, elapsedMs, finalUrl and engine.",
        inputSchema: FetchBodyShape,
      },
      args => this.fetchDetails(FetchRequest.from(args)),
    )

    return server
  }

  private async fetchContent(request: FetchRequest): Promise<CallToolResult> {
    const result = await this.fetchService.fetchDetails(request)

    if (result instanceof FetchError) {
      return this.errorResult(result)
    }

    if (typeof result.content === "string") {
      return { content: [{ type: "text", text: result.content }] }
    }

    return {
      content: [
        {
          type: "resource",
          resource: {
            uri: result.finalUrl,
            mimeType: result.contentType.mimeType,
            blob: Buffer.from(result.content).toString("base64"),
          },
        },
      ],
    }
  }

  private async fetchDetails(request: FetchRequest): Promise<CallToolResult> {
    const result = await this.fetchService.fetchDetails(request)

    if (result instanceof FetchError) {
      return this.errorResult(result)
    }

    return { content: [{ type: "text", text: JSON.stringify(result) }] }
  }

  private errorResult(error: FetchError): CallToolResult {
    return { isError: true, content: [{ type: "text", text: error.message }] }
  }
}
