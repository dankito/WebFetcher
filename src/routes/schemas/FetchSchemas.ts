import { z } from "zod"
import { ContentEncoding } from "../../model/FetchResponse"
import { EngineFailureKind } from "../../model/EngineFailure"
import { FetchEngine } from "../../model/FetchEngine"
import { FetchErrorReason } from "../../model/FetchError"

const urlSchema = z.url({ protocol: /^https?$/ }).describe("The url to fetch (http or https).")

const timeoutDescription = "Timeout in seconds. Unset or < 1 = no timeout."
const fingerprintDescription =
  "Browser fingerprint like `firefox`, `chrome`, `firefox144` or `chrome131`. Defaults to `chrome`. Camoufox always uses Firefox."
const followRedirectsDescription = "Follow redirects. Defaults to true. Ignored by Camoufox (a browser always follows redirects)."
const enginesDescription =
  "Engines to try, in this order. Unset = default order (Impit, then Camoufox). Escalates to the next engine on failures, status > 299 or a detected JavaScript wall."
const executeJavaScriptDescription =
  "Unset: default behaviour. true: skips Impit. false: disables JavaScript in Camoufox (and no escalation because of a JavaScript wall)."
const loadLazyContentDescription =
  "If true, Camoufox scrolls to the end of the page to load lazy loading content. Skips Impit."

const fingerprintSchema = z
  .string()
  .regex(/^(firefox|chrome)\d*$/i, "Expected e.g. firefox, chrome, firefox144, chrome131")
  .describe(fingerprintDescription)

/**
 * Query values are strings: `true` / `false` (and some more spellings like 1 / 0).
 * `meta` makes OpenAPI / Swagger UI show a boolean instead of a string.
 */
const queryBoolean = (description: string) => z.stringbool().meta({ type: "boolean", description })

/** `engines=Impit,Camoufox` as well as `engines=Impit&engines=Camoufox` */
const queryEnginesSchema = z.preprocess(
  value => {
    if (Array.isArray(value)) {
      return value.flatMap(entry => String(entry).split(","))
    }

    if (typeof value === "string") {
      return value.split(",")
    }

    return value
  },
  z.array(z.enum(FetchEngine)).min(1),
)

/** GET: no headers and cookies, there is no good way to pass them in a query. */
export const FetchQuerySchema = z.object({
  url: urlSchema,
  timeout: z.coerce.number().optional().describe(timeoutDescription),
  fingerprint: fingerprintSchema.optional(),
  followRedirects: queryBoolean(followRedirectsDescription).default(true),
  engines: queryEnginesSchema.optional().describe(enginesDescription),
  executeJavaScript: queryBoolean(executeJavaScriptDescription).optional(),
  loadLazyContent: queryBoolean(loadLazyContentDescription).optional(),
})

/** POST (JSON body), also the input of the MCP tools. */
export const FetchBodyShape = {
  url: urlSchema,
  timeout: z.number().optional().describe(timeoutDescription),
  fingerprint: fingerprintSchema.optional(),
  followRedirects: z.boolean().default(true).describe(followRedirectsDescription),
  engines: z.array(z.enum(FetchEngine)).min(1).optional().describe(enginesDescription),
  executeJavaScript: z.boolean().optional().describe(executeJavaScriptDescription),
  loadLazyContent: z.boolean().optional().describe(loadLazyContentDescription),
  headers: z.record(z.string(), z.string()).optional().describe("Headers to send to the url."),
  cookies: z.record(z.string(), z.string()).optional().describe("Cookies to send to the url (name -> value)."),
}

export const FetchBodySchema = z.object(FetchBodyShape)

export const ResponseCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  expires: z.string().optional(),
  maxAge: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.string().optional(),
})

export const FetchDetailsResponseSchema = z.object({
  content: z.string().describe("The decoded text (HTML gets a <base href> if there was none) or, for binary content, base64."),
  contentEncoding: z.enum(ContentEncoding).describe("`Text` or `Base64` (binary responses like images or PDFs)."),
  statusCode: z.number(),
  headers: z.record(z.string(), z.string()).describe("Lower-case header names, without set-cookie (see cookies)."),
  cookies: z.array(z.string()).describe("The raw Set-Cookie header values."),
  // TODO: keep?
  cookiesParsed: z.array(ResponseCookieSchema),
  elapsedMs: z.number().describe("Total elapsed time, including failed attempts of previous engines."),
  finalUrl: z.string().describe("The url after following redirects."),
  engine: z.enum(FetchEngine).describe("The engine that fetched this response."),
})

export const FetchErrorResponseSchema = z.object({
  error: z.string(),
  reason: z.enum(FetchErrorReason),
  engineFailures: z.array(
    z.object({
      engine: z.enum(FetchEngine),
      kind: z.enum(EngineFailureKind),
      message: z.string(),
      statusCode: z.number().optional(),
    }),
  ),
})
