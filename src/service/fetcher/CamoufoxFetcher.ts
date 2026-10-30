import { setTimeout as sleep } from "node:timers/promises"
import type { Cookie, Page, Response as PlaywrightResponse } from "playwright-core"
import type { AppConfig } from "../../model/AppConfig"
import { EngineFailure, EngineFailureKind } from "../../model/EngineFailure"
import { FetchEngine } from "../../model/FetchEngine"
import type { FetchRequest } from "../../model/FetchRequest"
import { FetchResponse } from "../../model/FetchResponse"
import { CharsetDecoderService } from "../CharsetDecoderService"
import { Stopwatch } from "../Stopwatch"
import { CamoufoxBrowserManager, CamoufoxLease } from "./CamoufoxBrowserManager"
import type { Fetcher } from "./Fetcher"
import { BrowserDisplayMode } from "../../model/BrowserDisplayMode"

/**
 * Real (anti-detect) Firefox via Camoufox with humanized cursor movement and blocked WebRTC.
 * Always uses a Firefox fingerprint, `fingerprint=chrome*` is ignored,
 * as is `followRedirects` (a browser always follows redirects).
 * Starts downloading Camoufox in the background when the instance is created.
 */
export class CamoufoxFetcher implements Fetcher {

  private static readonly DEFAULT_TIMEOUT_MS = 30_000
  private static readonly NETWORK_IDLE_TIMEOUT_MS = 10_000
  private static readonly CHALLENGE_MAX_WAIT_MS = 20_000
  private static readonly CHALLENGE_POLL_MS = 1_000
  private static readonly SCROLL_DELAY_MIN_MS = 200
  private static readonly SCROLL_DELAY_MAX_MS = 400
  private static readonly MAX_SCROLL_STEPS = 50
  /** Random pause before the navigation, breaks the "instant goto" timing pattern. */
  private static readonly JITTER_MIN_MS = 100
  private static readonly JITTER_MAX_MS = 600
  private static readonly CHALLENGE_TITLE = /just a moment|checking your browser|einen moment/i
  private static readonly CLOSED_ERROR = /has been closed|target closed|browser.*crashed/i
  private static readonly NETWORK_ERROR = /NS_ERROR_|net::ERR_/


  readonly engine = FetchEngine.Camoufox
  readonly executesJavaScript = true

  private readonly browser: CamoufoxBrowserManager


  constructor(config: AppConfig, private readonly decoder: CharsetDecoderService) {
    this.browser = new CamoufoxBrowserManager(config.camoufoxDataDir, config.camoufoxIdleTimeout, BrowserDisplayMode.Headless)
  }


  /** Unloads the browser. */
  async close(): Promise<void> {
    await this.browser.close()
  }

  async fetch(request: FetchRequest): Promise<FetchResponse | EngineFailure> {
    const lease = await this.browser.acquire(!request.javaScriptDisabled)

    if (lease instanceof Error) {
      return this.failure(EngineFailureKind.BrowserLaunch, `Launching Camoufox failed: ${lease.message}`)
    }

    // the time budget starts after the lease, so that the browser start-up and waiting for a free page slot don't use it up
    const stopwatch = Stopwatch.start()
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

      await sleep(this.randomBetween(CamoufoxFetcher.JITTER_MIN_MS, CamoufoxFetcher.JITTER_MAX_MS))

      const navigationTimeoutMs = this.remainingMs(request, stopwatch)

      if (navigationTimeoutMs < 1) { // actually it's guaranteed to be > 0
        return this.failure(EngineFailureKind.Timeout, "Timeout exceeded before the navigation started")
      }

      const firstResponse = await currentPage.goto(request.url, { timeout: navigationTimeoutMs })

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
      return this.failure(this.classify(error), error instanceof Error ? error.message : String(error))
    } finally {
      await page?.close().catch(() => undefined)

      // clear set cookies - only for request isolation
      // await this.clearCookies(lease, request)

      lease.release()
    }
  }

  /**
   * Zwei Einschränkungen:
   *
   * - Wenn die Seite während des Requests einen gleichnamigen Cookie aktualisiert hat, löschst du auch diesen neuen Wert.
   * - Parallele Requests zur selben Domain mit gleichnamigen Cookies stören sich weiterhin, weil das Löschen den anderen Request mittendrin treffen kann.
   *
   * Ich würde es nur einbauen, wenn dir die Isolation wichtiger ist als die Robustheit.
   */
  private async clearCookies(lease: CamoufoxLease, request: FetchRequest) {
    if (request.hasCookies && request.cookies) {
      const domain = new URL(request.url).hostname

      for (const name of Object.keys(request.cookies)) {
        await lease.context.clearCookies({ name, domain }).catch(() => undefined)
      }
    }
  }

  private failure(kind: EngineFailureKind, message: string): EngineFailure {
    return new EngineFailure(this.engine, kind, message)
  }

  /** Playwright reports everything as a generic Error, so the kind is derived from name and message. */
  private classify(error: unknown): EngineFailureKind {
    if (!(error instanceof Error)) {
      return EngineFailureKind.Other
    }

    if (error.name === "TimeoutError") {
      return EngineFailureKind.Timeout
    }

    if (CamoufoxFetcher.CLOSED_ERROR.test(error.message)) {
      return EngineFailureKind.BrowserClosed
    }

    if (CamoufoxFetcher.NETWORK_ERROR.test(error.message)) {
      return EngineFailureKind.Network
    }

    return EngineFailureKind.Other
  }

  /** Remaining time of the request timeout in ms. Can be <= 0. */
  private remainingMs(request: FetchRequest, stopwatch: Stopwatch): number {
    return request.timeoutMsOrDefault(CamoufoxFetcher.DEFAULT_TIMEOUT_MS) - stopwatch.elapsedMs
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min)
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

    if (remaining < 1) {
      return
    }

    const timeout = Math.min(remaining, CamoufoxFetcher.NETWORK_IDLE_TIMEOUT_MS)

    await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined)
  }

  /** Waits (bounded) until a JS challenge like Cloudflare's "Just a moment..." resolved itself. */
  private async waitForChallenge(page: Page, request: FetchRequest, stopwatch: Stopwatch): Promise<void> {
    const challengeStopwatch = Stopwatch.start()

    while (challengeStopwatch.elapsedMs < CamoufoxFetcher.CHALLENGE_MAX_WAIT_MS) {
      const title = await page.title().catch(() => "")

      if (!CamoufoxFetcher.CHALLENGE_TITLE.test(title) || this.remainingMs(request, stopwatch) < 1) {
        return
      }

      await page.waitForTimeout(CamoufoxFetcher.CHALLENGE_POLL_MS)
    }
  }

  /**
   * Scrolls down one viewport at a time (so that lazy loading triggered by IntersectionObservers fires for every
   * section) until the end is reached and the page height stopped growing, or the step limit / request timeout is hit.
   */
  private async scrollToEnd(page: Page, request: FetchRequest, stopwatch: Stopwatch): Promise<void> {
    for (let step = 0; step < CamoufoxFetcher.MAX_SCROLL_STEPS; step++) {
      if (this.remainingMs(request, stopwatch) < 1) {
        return
      }

      const position = await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight)

        return { bottom: window.scrollY + window.innerHeight, height: document.documentElement.scrollHeight }
      })

      await page.waitForTimeout(this.randomBetween(CamoufoxFetcher.SCROLL_DELAY_MIN_MS, CamoufoxFetcher.SCROLL_DELAY_MAX_MS))

      if (position.bottom >= position.height - 1) {
        // at the end: only stop if nothing was appended in the meantime
        const heightAfterDelay = await page.evaluate(() => document.documentElement.scrollHeight)

        if (heightAfterDelay <= position.height) {
          return
        }
      }
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