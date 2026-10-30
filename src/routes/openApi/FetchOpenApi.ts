import { describeRoute, resolver } from "hono-openapi"
import { FetchDetailsResponseSchema, FetchErrorResponseSchema } from "../schemas/FetchSchemas"

const errorContent = { "application/json": { schema: resolver(FetchErrorResponseSchema) } }

const errorResponses = {
  400: { description: "Invalid parameters or no applicable engine.", content: errorContent },
  403: { description: "The url points to a local or private address, which is not allowed.", content: errorContent },
  502: { description: "No engine delivered a usable response.", content: errorContent },
  504: { description: "All engines ran into the timeout.", content: errorContent },
}

const intro = `Fetches the url, first with Impit (browser TLS fingerprint, no JavaScript) and escalates to Camoufox
(anti-detect Firefox) on failures, status codes > 299 or if the page requires JavaScript.`

const contentDescription = `${intro}

Returns the plain response content with the content type of the fetched response: text is always UTF-8, binary
content (images, PDFs, ...) is returned as is. Details about the fetched response are in the \`X-Fetch-*\` headers:
* \`X-Fetch-Engine\`, \`X-Fetch-Status\`, \`X-Fetch-Final-Url\`
* \`X-Fetch-Header-<name>\`: every header of the fetched response (the total size of response headers is limited
  by many clients / proxies, e.g. to 16 KB)
* \`X-Fetch-Cookie\`: every raw \`Set-Cookie\` value of the fetched response

Use \`/fetch/details\` to get everything in a JSON body.`

const detailsDescription = `${intro}

Returns a JSON wrapper with the content, status code, headers, cookies, elapsed time, final url and the engine that
fetched the response. Binary content is base64 encoded (see \`contentEncoding\`).`

const postHint = "Like GET, but the parameters are sent as JSON body and additionally allow `headers` and `cookies` for the target url."

const contentResponses = {
  200: {
    description: "The plain response content.",
    content: { "*/*": { schema: { type: "string" as const, format: "binary" } } },
  },
  ...errorResponses,
}

const detailsResponses = {
  200: {
    description: "The JSON wrapper.",
    content: { "application/json": { schema: resolver(FetchDetailsResponseSchema) } },
  },
  ...errorResponses,
}

export class FetchOpenApi {
  static readonly getContent = describeRoute({
    operationId: "fetchContentGet",
    summary: "Fetch an url, returns the plain content (GET)",
    description: contentDescription,
    tags: ["fetch"],
    responses: contentResponses,
  })

  static readonly postContent = describeRoute({
    operationId: "fetchContentPost",
    summary: "Fetch an url, returns the plain content (POST)",
    description: `${contentDescription}\n\n${postHint}`,
    tags: ["fetch"],
    responses: contentResponses,
  })

  static readonly getDetails = describeRoute({
    operationId: "fetchDetailsGet",
    summary: "Fetch an url, returns the details as JSON (GET)",
    description: detailsDescription,
    tags: ["fetch"],
    responses: detailsResponses,
  })

  static readonly postDetails = describeRoute({
    operationId: "fetchDetailsPost",
    summary: "Fetch an url, returns the details as JSON (POST)",
    description: `${detailsDescription}\n\n${postHint}`,
    tags: ["fetch"],
    responses: detailsResponses,
  })
}
