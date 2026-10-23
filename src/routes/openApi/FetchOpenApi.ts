import { describeRoute, resolver } from "hono-openapi"
import { FetchErrorResponseSchema, FetchJsonResponseSchema } from "../schemas/FetchSchemas"

const description = `Fetches the url, first with Impit (browser TLS fingerprint, no JavaScript) and escalates to Camoufox
(anti-detect Firefox) on errors, status codes > 299 or if the page requires JavaScript.

The response type is selected by the \`Accept\` header:
* \`application/json\`: JSON wrapper with content, status code, headers, cookies, elapsed time, final url and engine.
* anything else: the plain response content (with the content type of the fetched response, always UTF-8).`

const responses = {
  200: {
    description: "Plain response content or (with `Accept: application/json`) the JSON wrapper.",
    content: {
      "application/json": { schema: resolver(FetchJsonResponseSchema) },
      "*/*": { schema: { type: "string" as const } },
    },
  },
  400: { description: "Invalid parameters or no applicable strategy." },
  502: {
    description: "No engine delivered a usable response.",
    content: { "application/json": { schema: resolver(FetchErrorResponseSchema) } },
  },
  504: {
    description: "All engines ran into the timeout.",
    content: { "application/json": { schema: resolver(FetchErrorResponseSchema) } },
  },
}

export class FetchOpenApi {
  static readonly get = describeRoute({
    operationId: "fetchGet",
    summary: "Fetch an url (GET)",
    description,
    tags: ["fetch"],
    responses,
  })

  static readonly post = describeRoute({
    operationId: "fetchPost",
    summary: "Fetch an url (POST)",
    description: `${description}

Like GET, but the parameters are sent as JSON body and additionally allow \`headers\` and \`cookies\` for the target url.`,
    tags: ["fetch"],
    responses,
  })
}
