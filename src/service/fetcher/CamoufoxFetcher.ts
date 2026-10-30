import type { Cookie, Page, Response as PlaywrightResponse } from "playwright-core"
import type { AppConfig } from "../../model/AppConfig"
import { EngineFailure, EngineFailureKind } from "../../model/EngineFailure"
import { FetchEngine } from "../../model/FetchEngine"
import type { FetchRequest } from "../../model/FetchRequest"
import { FetchResponse } from "../../model/FetchResponse"
import { CharsetDecoderService } from "../CharsetDecoderService"
import { Stopwatch } from "../Stopwatch"
import { CamoufoxBrowserManager } from "./CamoufoxBrowserManager"
import type { Fetcher } from "./Fetcher"

/**
 * Real (anti-detect) Firefox via Camoufox. Always uses a Firefox fingerprint, `fingerprint=chrome*` is ignored,
 * as is `followRedirects` (a browser always follows redirects).
 * Starts downloading Camoufox in the background when the instance is created.
 */
export class CamoufoxFetcher implements Fetcher {

  private static readonly NETWORK_IDLE_TIMEOUT_MS = 10_000
  private static readonly CHALLENGE_MAX_WAIT_MS = 20_000
  private static readonly CHALLENGE_POLL_MS = 1_000
  private static readonly SCROLL_DELAY_MS = 400
  private static readonly MAX_SCROLL_STEPS = 50
  private static readonly CHALLENGE_TITLE = /just a moment|checking your browser|einen moment/i


  readonly engine = FetchEngine.Camoufox
  readonly executesJavaScript = true

  private readonly browser: CamoufoxBrowserManager


  constructor(config: AppConfig, private readonly decoder: CharsetDecoderService) {
    this.browser = new CamoufoxBrowserManager(config.camoufoxDataDir, config.camoufoxIdleTimeout)
  }


  /** Unloads the browser. */
  async close(): Promise<void> {
    await this.browser.close()
  }

  async fetch(request: FetchRequest): Promise<FetchResponse | EngineFailure> {
    const stopwatch = Stopwatch.start()
    const lease = await this.browser.acquire(!request.javaScriptDisabled)

    if (lease instanceof Error) {
      return this.failure(EngineFailureKind.Other, `Launching Camoufox failed: ${lease.message}`)
    }

    let page: Page | undefined

    // library boundary: playwright reports problems by throwing
    try {
      page = await lease.context.newPage()

      if (request.hasHeaders && request.headers) {
        await page.setExtraHTTPHeaders(request.headers)
      }

      if (request.hasCookies && request.cookies) {
        await lease.context.addCookies(
          Object.entries(request.cookies).map(([name, value]) => ({ name, value, url: request.url })),
        )
      }

      let latestNavigation: PlaywrightResponse | undefined

      const currentPage = page

      currentPage.on("response", response => {
        if (response.request().isNavigationRequest() && response.frame() === currentPage.mainFrame()) {
          latestNavigation = response
        }
      })

      const navigationTimeoutMs = this.remainingMs(request, stopwatch)

      if (navigationTimeoutMs !== undefined && navigationTimeoutMs < 1) {
        return this.failure(EngineFailureKind.Timeout, "Timeout exceeded before the navigation started")
      }

      const firstResponse = await currentPage.goto(request.url, { timeout: navigationTimeoutMs ?? 0 })

      if (!request.javaScriptDisabled) {
        await this.waitForNetworkIdle(currentPage, request, stopwatch)
        await this.waitForChallenge(currentPage, request, stopwatch)

        if (request.loadLazyContent) {
          await this.scrollToEnd(currentPage, request, stopwatch)
        }
      }

      const mainResponse = latestNavigation ?? firstResponse
      const headers = mainResponse ? await mainResponse.allHeaders() : {}
      const finalUrl = currentPage.url()
      const cookies = await lease.context.cookies(finalUrl)

      return new FetchResponse(
        await this.readContent(currentPage, mainResponse, headers["content-type"]),
        mainResponse?.status() ?? 0,
        this.withoutSetCookie(headers),
        cookies.map(cookie => this.toSetCookie(cookie)),
        stopwatch.elapsedMs,
        finalUrl,
        this.engine,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const kind = error instanceof Error && error.name === "TimeoutError" ? EngineFailureKind.Timeout : EngineFailureKind.Network

      return this.failure(kind, message)
    } finally {
      await page?.close().catch(() => undefined)
      lease.release()
    }
  }

  private failure(kind: EngineFailureKind, message: string): EngineFailure {
    return new EngineFailure(this.engine, kind, message)
  }

  /** Remaining time of the request timeout in ms, undefined if there is no timeout. Can be <= 0. */
  private remainingMs(request: FetchRequest, stopwatch: Stopwatch): number | undefined {
    const timeoutMs = request.timeoutMs

    return timeoutMs === undefined ? undefined : timeoutMs - stopwatch.elapsedMs
  }

  /** HTML: the DOM after JavaScript ran. Everything else: the raw body, decoded if it is text. */
  private async readContent(
    page: Page,
    response: PlaywrightResponse | null | undefined,
    contentType: string | undefined,
  ): Promise<string | Uint8Array> {
    const isHtml = !contentType || /html/i.test(contentType)

    if (!isHtml && response) {
      // the body can be unavailable (e.g. after a download started), then the rendered page is used instead
      const body = await response.body().catch(() => undefined)

      if (body) {
        return this.decoder.decodeBody(body, contentType)
      }
    }

    return page.content()
  }

  /** Best effort, bounded by the request timeout. */
  private async waitForNetworkIdle(page: Page, request: FetchRequest, stopwatch: Stopwatch): Promise<void> {
    const remaining = this.remainingMs(request, stopwatch)

    if (remaining !== undefined && remaining < 1) {
      return
    }

    const timeout = Math.min(remaining ?? CamoufoxFetcher.NETWORK_IDLE_TIMEOUT_MS, CamoufoxFetcher.NETWORK_IDLE_TIMEOUT_MS)

    await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined)
  }

  /** Waits (bounded) until a JS challenge like Cloudflare's "Just a moment..." resolved itself. */
  private async waitForChallenge(page: Page, request: FetchRequest, stopwatch: Stopwatch): Promise<void> {
    const challengeStopwatch = Stopwatch.start()

    while (challengeStopwatch.elapsedMs < CamoufoxFetcher.CHALLENGE_MAX_WAIT_MS) {
      const title = await page.title().catch(() => "")
      const remaining = this.remainingMs(request, stopwatch)

      if (!CamoufoxFetcher.CHALLENGE_TITLE.test(title) || (remaining !== undefined && remaining < 1)) {
        return
      }

      await page.waitForTimeout(CamoufoxFetcher.CHALLENGE_POLL_MS)
    }
  }

  /** Scrolls down until the page height stops growing (or the request timeout is reached). */
  private async scrollToEnd(page: Page, request: FetchRequest, stopwatch: Stopwatch): Promise<void> {
    const readHeight = () => page.evaluate(() => document.documentElement.scrollHeight)
    let lastHeight = await readHeight()

    for (let step = 0; step < CamoufoxFetcher.MAX_SCROLL_STEPS; step++) {
      const remaining = this.remainingMs(request, stopwatch)

      if (remaining !== undefined && remaining < 1) {
        return
      }

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForTimeout(CamoufoxFetcher.SCROLL_DELAY_MS)

      const height = await readHeight()

      if (height === lastHeight) {
        return
      }

      lastHeight = height
    }
  }

  private withoutSetCookie(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "set-cookie"))
  }

  /** Playwright only provides parsed cookies, so they get serialized to a `Set-Cookie` value again. */
  private toSetCookie(cookie: Cookie): string {
    const parts = [`${cookie.name}=${cookie.value}`, `Domain=${cookie.domain}`, `Path=${cookie.path}`]

    if (cookie.expires > 0) {
      parts.push(`Expires=${new Date(cookie.expires * 1000).toUTCString()}`)
    }

    if (cookie.httpOnly) {
      parts.push("HttpOnly")
    }

    if (cookie.secure) {
      parts.push("Secure")
    }

    parts.push(`SameSite=${cookie.sameSite}`)

    return parts.join("; ")
  }

}