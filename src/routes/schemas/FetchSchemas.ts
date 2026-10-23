import { z } from "zod"
import { FetchEngine } from "../../model/FetchEngine"
import { FetchErrorKind } from "../../model/FetchError"

const urlSchema = z.url({ protocol: /^https?$/ }).describe("The url to fetch (http or https).")

const timeoutDescription = "Timeout in seconds. Unset or < 1 = no timeout."
const fingerprintDescription =
  "Browser fingerprint like `firefox`, `chrome`, `firefox144` or `chrome131`. Defaults to `chrome`. Camoufox always uses Firefox."
const followRedirectsDescription = "Follow redirects. Defaults to true. Not supported by Camoufox."
const strategiesDescription =
  "Engines to try, in this order. Unset = default order (impit, then camoufox). Escalates to the next engine on errors, status > 299 or a detected JavaScript wall."
const executeJavaScriptDescription =
  "Unset: default behaviour. true: skips Impit. false: disables JavaScript in Camoufox (and no escalation because of a JavaScript wall)."
const loadLazyContentDescription =
  "If true, Camoufox scrolls to the end of the page to load lazy loading content. Implies a JavaScript engine (skips Impit)."

const fingerprintSchema = z
  .string()
  .regex(/^(firefox|chrome)\d*$/i, "Expected e.g. firefox, chrome, firefox144, chrome131")
  .describe(fingerprintDescription)

const strategiesSchema = z.array(z.enum(FetchEngine)).min(1).describe(strategiesDescription)

/** Query values are strings: `true` / `false` */
const queryBooleanSchema = z.enum(["true", "false"]).transform((value) => value === "true")

/** `strategies=impit,camoufox` as well as `strategies=impit&strategies=camoufox` */
const queryStrategiesSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => String(entry).split(","))
    }

    if (typeof value === "string") {
      return value.split(",")
    }

    return value
  },
  z.array(z.enum(FetchEngine)).min(1),
)

/** GET /fetch: no headers and cookies, there is no good way to pass them in a query. */
export const FetchQuerySchema = z.object({
  url: urlSchema,
  timeout: z.coerce.number().optional().describe(timeoutDescription),
  fingerprint: fingerprintSchema.optional(),
  followRedirects: queryBooleanSchema.default(true).describe(followRedirectsDescription),
  strategies: queryStrategiesSchema.optional().describe(strategiesDescription),
  executeJavaScript: queryBooleanSchema.optional().describe(executeJavaScriptDescription),
  loadLazyContent: queryBooleanSchema.optional().describe(loadLazyContentDescription),
})

/** POST /fetch (JSON body), also the input of the MCP tools. */
export const FetchBodyShape = {
  url: urlSchema,
  timeout: z.number().optional().describe(timeoutDescription),
  fingerprint: fingerprintSchema.optional(),
  followRedirects: z.boolean().default(true).describe(followRedirectsDescription),
  strategies: strategiesSchema.optional(),
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

export const FetchJsonResponseSchema = z.object({
  content: z.string().describe("Decoded response content. HTML gets a <base href> if there was none."),
  statusCode: z.number(),
  headers: z.record(z.string(), z.string()).describe("Lower-case header names. Multiple set-cookie headers are joined by a newline."),
  cookies: z.array(ResponseCookieSchema),
  elapsedMs: z.number().describe("Total elapsed time, including failed attempts of previous engines."),
  finalUrl: z.string().describe("The url after following redirects."),
  engine: z.enum(FetchEngine).describe("The engine that fetched this response."),
})

export const FetchErrorResponseSchema = z.object({
  error: z.string(),
  attempts: z.array(
    z.object({
      engine: z.enum(FetchEngine),
      kind: z.enum(FetchErrorKind),
      message: z.string(),
      statusCode: z.number().optional(),
    }),
  ),
})
