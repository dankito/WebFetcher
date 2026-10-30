import { Hono, type Context } from "hono"
import { validator } from "hono-openapi"
import { FetchFailedError } from "../model/FetchError"
import type { FetchRequest } from "../model/FetchRequest"
import type { FetchService } from "../service/FetchService"
import { FetchOpenApi } from "./openApi/FetchOpenApi"
import { FetchBodySchema, FetchQuerySchema } from "./schemas/FetchSchemas"

export class FetchRouter {
  readonly router = new Hono()

  constructor(private fetchService: FetchService) {
    this.router.get("/fetch", FetchOpenApi.get, validator("query", FetchQuerySchema), (c) =>
      this.handle(c, c.req.valid("query")),
    )

    this.router.post("/fetch", FetchOpenApi.post, validator("json", FetchBodySchema), (c) =>
      this.handle(c, c.req.valid("json")),
    )
  }

  private async handle(c: Context, params: FetchRequest): Promise<Response> {
    try {
      const response = await this.fetchService.fetchDetails(params)

      if (this.wantsJson(c.req.header("accept"))) {
        return c.json(response)
      }

      return new Response(response.content, {
        status: 200,
        headers: {
          "Content-Type": `${response.mimeType ?? "text/plain"}; charset=utf-8`,
          "X-Fetch-Engine": response.engine,
          "X-Fetch-Status": String(response.statusCode),
          "X-Fetch-Final-Url": new URL(response.finalUrl).href,
        },
      })
    } catch (error) {
      if (error instanceof FetchFailedError) {
        return c.json({ error: error.message, attempts: error.attempts }, this.errorStatus(error))
      }

      throw error
    }
  }

  private errorStatus(error: FetchFailedError): 400 | 502 | 504 {
    if (error.attempts.length === 0) {
      return 400
    }

    if (error.isTimeout) {
      return 504
    }

    return 502
  }

  private wantsJson(accept: string | undefined): boolean {
    return accept !== undefined && accept.toLowerCase().includes("application/json")
  }
}
