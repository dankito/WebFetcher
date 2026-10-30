import { Impit, TimeoutError, type Browser } from "impit"
import { EngineFailure, EngineFailureKind } from "../../model/EngineFailure"
import { FetchEngine } from "../../model/FetchEngine"
import type { FetchRequest } from "../../model/FetchRequest"
import { FetchResponse } from "../../model/FetchResponse"
import { CharsetDecoderService } from "../CharsetDecoderService"
import { Stopwatch } from "../Stopwatch"
import type { Fetcher } from "./Fetcher"

interface VersionedBrowser {
  browser: Browser
  version: number
}

/** Plain HTTP client with browser TLS / HTTP2 fingerprint impersonation. Does not execute JavaScript. */
export class ImpitFetcher implements Fetcher {

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

  /** Unversioned browsers, which impit resolves to the latest version of that family. */
  private static readonly FAMILIES: Browser[] = ["chrome", "firefox"]

  /** Unversioned "chrome" = always the latest Chrome profile of the installed impit version. */
  private static readonly DEFAULT_BROWSER: Browser = "chrome"

  private static readonly DEFAULT_TIMEOUT_MS = 60_000

  /** Versioned browsers per family, highest version first. */
  private static readonly VERSIONS_BY_FAMILY = ImpitFetcher.indexVersions()


  readonly engine = FetchEngine.Impit
  readonly executesJavaScript = false

  /** No cookie jar is configured, so clients keep no cookie state and can be shared between requests. */
  private readonly clients = new Map<Browser, Impit>()

  constructor(private readonly decoder: CharsetDecoderService) {}


  async fetch(request: FetchRequest): Promise<FetchResponse | EngineFailure> {
    const stopwatch = Stopwatch.start()
    const client = this.getClient(this.resolveBrowser(request.fingerprint))

    // library boundary: impit reports every problem by throwing
    try {
      const response = await client.fetch(request.url, {
        method: "GET",
        headers: request.headersWithCookie,
        timeout: request.timeoutMsOrDefault(ImpitFetcher.DEFAULT_TIMEOUT_MS),
        redirect: request.followRedirects ? "follow" : "manual",
      })

      const bytes = await response.bytes()

      return new FetchResponse(
        this.decoder.decodeBody(bytes, response.headers.get("content-type")),
        response.status,
        this.collectHeaders(response.headers),
        response.headers.getSetCookie(),
        stopwatch.elapsedMs,
        response.url,
        this.engine,
      )
    } catch (error) {
      return this.toFailure(error)
    }
  }

  private getClient(browser: Browser): Impit {
    let client = this.clients.get(browser)

    if (!client) {
      // timeout and redirect mode are passed per request
      client = new Impit({ browser, timeout: null })
      this.clients.set(browser, client)
    }

    return client
  }

  /**
   * Maps e.g. `chrome131` to a browser supported by impit. If the exact version is not supported,
   * the highest supported version below it is used, otherwise the unversioned browser (= latest).
   */
  private resolveBrowser(fingerprint?: string): Browser {
    const normalized = (fingerprint ?? ImpitFetcher.DEFAULT_BROWSER).trim().toLowerCase()
    const exact = ImpitFetcher.SUPPORTED_BROWSERS.find(browser => browser === normalized)

    if (exact) {
      return exact
    }

    const match = /^([a-z]+)(\d+)$/.exec(normalized)
    const family = ImpitFetcher.FAMILIES.find(candidate => candidate === match?.[1])

    if (!match || !family) {
      return ImpitFetcher.DEFAULT_BROWSER
    }

    const requestedVersion = Number(match[2])
    const lower = ImpitFetcher.VERSIONS_BY_FAMILY.get(family)?.find(entry => entry.version <= requestedVersion)

    return lower?.browser ?? family
  }

  private static indexVersions(): Map<Browser, VersionedBrowser[]> {
    const index = new Map<Browser, VersionedBrowser[]>()

    for (const family of ImpitFetcher.FAMILIES) {
      const entries = ImpitFetcher.SUPPORTED_BROWSERS
        .filter(browser => browser.startsWith(family))
        .map(browser => ({ browser, version: Number(browser.slice(family.length)) }))
        .filter(entry => entry.version > 0)
        .sort((a, b) => b.version - a.version)

      index.set(family, entries)
    }

    return index
  }

  private collectHeaders(responseHeaders: Headers): Record<string, string> {
    const headers: Record<string, string> = {}

    responseHeaders.forEach((value, name) => {
      const key = name.toLowerCase()

      if (key !== "set-cookie") {
        headers[key] = value
      }
    })

    return headers
  }

  private toFailure(error: unknown): EngineFailure {
    const message = error instanceof Error ? error.message : String(error)
    const kind = error instanceof TimeoutError ? EngineFailureKind.Timeout : EngineFailureKind.Network

    return new EngineFailure(this.engine, kind, message)
  }

}