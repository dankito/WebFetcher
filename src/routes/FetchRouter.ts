import { Hono, type Context } from "hono"
import { validator } from "hono-openapi"
import { FetchError, FetchErrorReason } from "../model/FetchError"
import { FetchRequest } from "../model/FetchRequest"
import type { FetchResponse } from "../model/FetchResponse"
import type { FetchService } from "../service/FetchService"
import { FetchOpenApi } from "./openApi/FetchOpenApi"
import { FetchBodySchema, FetchQuerySchema } from "./schemas/FetchSchemas"
import { SetCookieParser } from "../service/SetCookieParser"

export class FetchRouter {

  /** Header values may only contain visible latin1 characters, tab and space. */
  private static readonly VALID_HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/


  readonly router = new Hono()

  constructor(private readonly fetchService: FetchService, private readonly cookieParser: SetCookieParser) {
    this.router.get("/fetch", FetchOpenApi.getContent, validator("query", FetchQuerySchema), context =>
      this.content(context, FetchRequest.from(context.req.valid("query"))),
    )

    this.router.post("/fetch", FetchOpenApi.postContent, validator("json", FetchBodySchema), context =>
      this.content(context, FetchRequest.from(context.req.valid("json"))),
    )

    this.router.get("/fetch/details", FetchOpenApi.getDetails, validator("query", FetchQuerySchema), context =>
      this.details(context, FetchRequest.from(context.req.valid("query"))),
    )

    this.router.post("/fetch/details", FetchOpenApi.postDetails, validator("json", FetchBodySchema), context =>
      this.details(context, FetchRequest.from(context.req.valid("json"))),
    )
  }

  private async content(context: Context, request: FetchRequest): Promise<Response> {
    const result = await this.fetchService.fetchDetails(request)

    if (result instanceof FetchError) {
      return this.error(context, result)
    }

    // Bun's Response accepts any Uint8Array, only the lib typings insist on an ArrayBuffer backed one
    const body = typeof result.content === "string" ? result.content : (result.content as Uint8Array<ArrayBuffer>)

    return new Response(body, { status: 200, headers: this.contentHeaders(result) })
  }

  private async details(context: Context, request: FetchRequest): Promise<Response> {
    const result = await this.fetchService.fetchDetails(request)

    if (result instanceof FetchError) {
      return this.error(context, result)
    }

    return context.json(result.toJSON(this.cookieParser))
  }

  private contentHeaders(response: FetchResponse): Headers {
    const headers = new Headers()

    headers.set("Content-Type", this.contentType(response))
    headers.set("X-Fetch-Engine", response.engine)
    headers.set("X-Fetch-Status", String(response.statusCode))
    headers.set("X-Fetch-Final-Url", new URL(response.finalUrl).href)

    for (const [name, value] of Object.entries(response.headers)) {
      this.appendIfValid(headers, `X-Fetch-Header-${name}`, value)
    }

    for (const cookie of response.cookies) {
      this.appendIfValid(headers, "X-Fetch-Cookie", cookie)
    }

    return headers
  }

  /** Text is always sent as UTF-8 (it was decoded), binary content keeps its content type. */
  private contentType(response: FetchResponse): string {
    if (!response.isText) {
      return response.headers["content-type"] ?? "application/octet-stream"
    }

    return `${response.contentType.mimeType ?? "text/plain"}; charset=utf-8`
  }

  /** Values that can't be sent as header (e.g. non latin1 characters) are skipped. */
  private appendIfValid(headers: Headers, name: string, value: string): void {
    if (FetchRouter.VALID_HEADER_VALUE.test(value)) {
      headers.append(name, value)
    }
  }

  private error(context: Context, error: FetchError): Response {
    return context.json(
      { error: error.message, reason: error.reason, engineFailures: error.engineFailures },
      this.errorStatus(error),
    )
  }

  private errorStatus(error: FetchError): 400 | 403 | 502 | 504 {
    switch (error.reason) {
      case FetchErrorReason.ForbiddenAddress:
        return 403
      case FetchErrorReason.NoApplicableEngine:
        return 400
      case FetchErrorReason.Timeout:
        return 504
      default:
        return 502
    }
  }
}
