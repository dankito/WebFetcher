import { Impit, TimeoutError, type Browser } from "impit"
import { FetchEngine } from "../../model/FetchEngine"
import { FetchError, FetchErrorKind } from "../../model/FetchError"
import type { FetchRequestParams } from "../../model/FetchRequestParams"
import { FetchResponse } from "../../model/FetchResponse"
import { CharsetDecoderService } from "../CharsetDecoderService"
import { SetCookieParser } from "../SetCookieParser"
import type { FetchStrategy } from "./FetchStrategy"

/** Plain HTTP client with browser TLS / HTTP2 fingerprint impersonation. Does not execute JavaScript. */
export class ImpitFetchStrategy implements FetchStrategy {
  readonly engine = FetchEngine.Impit
  readonly executesJavaScript = false

  /** All browsers supported by impit. Typed so the compiler complains if impit drops one. */
  private static readonly SUPPORTED_BROWSERS: Browser[] = [
    "chrome",
    "chrome100",
    "chrome101",
    "chrome104",
    "chrome107",
    "chrome110",
    "chrome116",
    "chrome124",
    "chrome125",
    "chrome131",
    "chrome136",
    "chrome142",
    "chrome151",
    "firefox",
    "firefox128",
    "firefox133",
    "firefox135",
    "firefox144",
  ]

  private static readonly DEFAULT_FINGERPRINT = "chrome"

  private clients = new Map<Browser, Impit>()

  constructor(
    private decoder: CharsetDecoderService = new CharsetDecoderService(),
    private cookieParser: SetCookieParser = new SetCookieParser(),
  ) {}

  async fetch(params: FetchRequestParams): Promise<FetchResponse> {
    const start = performance.now()
    const client = this.getClient(this.resolveBrowser(params.fingerprint))
    const timeoutMs = params.timeout !== undefined && params.timeout >= 1 ? params.timeout * 1000 : null

    try {
      const response = await client.fetch(params.url, {
        method: "GET",
        headers: this.buildHeaders(params),
        timeout: timeoutMs,
        redirect: params.followRedirects ? "follow" : "manual",
      })

      const bytes = await response.bytes()
      const content = this.decoder.decode(bytes, response.headers.get("content-type"))

      return new FetchResponse(
        content,
        response.status,
        this.collectHeaders(response.headers),
        this.cookieParser.parseAll(response.headers.getSetCookie()),
        Math.round(performance.now() - start),
        response.url,
        this.engine,
      )
    } catch (error) {
      throw this.toFetchError(error)
    }
  }

  private getClient(browser: Browser): Impit {
    let client = this.clients.get(browser)

    if (!client) {
      // timeout is passed per request, redirect mode too
      client = new Impit({ browser, timeout: null })
      this.clients.set(browser, client)
    }

    return client
  }

  /**
   * Maps e.g. `chrome131` to a browser supported by impit. If the exact version is not supported,
   * the highest supported version below it is used, otherwise the unversioned browser (= latest).
   */
  private resolveBrowser(fingerprint: string = ImpitFetchStrategy.DEFAULT_FINGERPRINT): Browser {
    const normalized = fingerprint.trim().toLowerCase()
    const supported = ImpitFetchStrategy.SUPPORTED_BROWSERS
    const exact = supported.find((browser) => browser === normalized)

    if (exact) {
      return exact
    }

    const match = /^(chrome|firefox)(\d+)$/.exec(normalized)

    if (!match) {
      throw new FetchError(`Unsupported fingerprint "${fingerprint}"`, this.engine, FetchErrorKind.Unsupported)
    }

    const family = match[1] as "chrome" | "firefox"
    const requestedVersion = Number(match[2])

    const lowerVersions = supported
      .map((browser) => ({ browser, version: Number(browser.slice(family.length)) }))
      .filter((entry) => entry.browser.startsWith(family) && entry.version > 0 && entry.version <= requestedVersion)
      .sort((a, b) => b.version - a.version)

    return lowerVersions[0]?.browser ?? family
  }

  private buildHeaders(params: FetchRequestParams): Record<string, string> {
    const headers: Record<string, string> = { ...params.headers }

    if (params.cookies && Object.keys(params.cookies).length > 0) {
      const cookieHeader = Object.entries(params.cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ")

      const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === "cookie")

      if (existingKey) {
        headers[existingKey] = `${headers[existingKey]}; ${cookieHeader}`
      } else {
        headers.Cookie = cookieHeader
      }
    }

    return headers
  }

  private collectHeaders(responseHeaders: Headers): Record<string, string> {
    const headers: Record<string, string> = {}

    responseHeaders.forEach((value, name) => {
      const key = name.toLowerCase()

      if (key === "set-cookie") {
        return
      }

      headers[key] = value
    })

    const setCookies = responseHeaders.getSetCookie()

    if (setCookies.length > 0) {
      headers["set-cookie"] = setCookies.join("\n")
    }

    return headers
  }

  private toFetchError(error: unknown): FetchError {
    if (error instanceof FetchError) {
      return error
    }

    const message = error instanceof Error ? error.message : String(error)

    if (error instanceof TimeoutError) {
      return new FetchError(message, this.engine, FetchErrorKind.Timeout, undefined, { cause: error })
    }

    return new FetchError(message, this.engine, FetchErrorKind.Network, undefined, { cause: error })
  }
}
