import type { Page, Response as PlaywrightResponse } from "playwright-core"
import { FetchEngine } from "../../model/FetchEngine"
import { FetchError, FetchErrorKind } from "../../model/FetchError"
import type { FetchRequestParams } from "../../model/FetchRequestParams"
import { FetchResponse } from "../../model/FetchResponse"
import { ResponseCookie } from "../../model/ResponseCookie"
import { CharsetDecoderService } from "../CharsetDecoderService"
import type { CamoufoxBrowserManager } from "./CamoufoxBrowserManager"
import type { FetchStrategy } from "./FetchStrategy"

/**
 * Real (anti-detect) Firefox via Camoufox. Always uses a Firefox fingerprint, `fingerprint=chrome*` is ignored.
 * Cannot disable following redirects (a browser always follows them).
 */
export class CamoufoxFetchStrategy implements FetchStrategy {
  readonly engine = FetchEngine.Camoufox
  readonly executesJavaScript = true

  private static readonly NETWORK_IDLE_TIMEOUT_MS = 10_000
  private static readonly CHALLENGE_MAX_WAIT_MS = 20_000
  private static readonly CHALLENGE_POLL_MS = 1_000
  private static readonly SCROLL_DELAY_MS = 400
  private static readonly MAX_SCROLL_STEPS = 50
  private static readonly CHALLENGE_TITLE = /just a moment|checking your browser|einen moment/i

  constructor(
    private browser: CamoufoxBrowserManager,
    private decoder: CharsetDecoderService = new CharsetDecoderService(),
  ) {}

  async fetch(params: FetchRequestParams): Promise<FetchResponse> {
    if (!params.followRedirects) {
      throw new FetchError(
        "followRedirects=false is not supported by Camoufox (a browser always follows redirects)",
        this.engine,
        FetchErrorKind.Unsupported,
      )
    }

    const start = performance.now()
    const javaScriptEnabled = params.executeJavaScript !== false
    const deadline = params.timeout !== undefined && params.timeout >= 1 ? start + params.timeout * 1000 : undefined
    const lease = await this.acquire(javaScriptEnabled)
    let page: Page | undefined

    try {
      page = await lease.context.newPage()

      if (params.headers && Object.keys(params.headers).length > 0) {
        await page.setExtraHTTPHeaders(params.headers)
      }

      if (params.cookies && Object.keys(params.cookies).length > 0) {
        await lease.context.addCookies(
          Object.entries(params.cookies).map(([name, value]) => ({ name, value, url: params.url })),
        )
      }

      let latestNavigation: PlaywrightResponse | undefined

      const currentPage = page

      currentPage.on("response", (response) => {
        if (response.request().isNavigationRequest() && response.frame() === currentPage.mainFrame()) {
          latestNavigation = response
        }
      })

      const firstResponse = await currentPage.goto(params.url, { timeout: this.remaining(deadline) })

      if (javaScriptEnabled) {
        await currentPage
          .waitForLoadState("networkidle", {
            timeout: this.cap(this.remaining(deadline), CamoufoxFetchStrategy.NETWORK_IDLE_TIMEOUT_MS),
          })
          .catch(() => undefined)

        await this.waitForChallenge(currentPage, deadline)

        if (params.loadLazyContent) {
          await this.scrollToEnd(currentPage, deadline)
        }
      }

      const mainResponse = latestNavigation ?? firstResponse
      const headers = mainResponse ? await mainResponse.allHeaders() : {}
      const finalUrl = currentPage.url()
      const content = await this.readContent(currentPage, mainResponse, headers["content-type"])
      const cookies = await lease.context.cookies(finalUrl)

      return new FetchResponse(
        content,
        mainResponse?.status() ?? 0,
        headers,
        cookies.map((cookie) => this.toResponseCookie(cookie)),
        Math.round(performance.now() - start),
        finalUrl,
        this.engine,
      )
    } catch (error) {
      throw this.toFetchError(error)
    } finally {
      await page?.close().catch(() => undefined)
      lease.release()
    }
  }

  private async acquire(javaScriptEnabled: boolean) {
    try {
      return await this.browser.acquire(javaScriptEnabled)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      throw new FetchError(`Launching Camoufox failed: ${message}`, this.engine, FetchErrorKind.Other, undefined, {
        cause: error,
      })
    }
  }

  /** HTML: the DOM after JavaScript ran. Everything else (json, text, ...): the raw body, decoded. */
  private async readContent(
    page: Page,
    response: PlaywrightResponse | null | undefined,
    contentType: string | undefined,
  ): Promise<string> {
    const isHtml = !contentType || /html/i.test(contentType)

    if (!isHtml && response) {
      try {
        return this.decoder.decode(await response.body(), contentType)
      } catch {
        // body not available any more, use the rendered page instead
      }
    }

    return page.content()
  }

  /** Waits (bounded) until a JS challenge like Cloudflare's "Just a moment..." resolved itself. */
  private async waitForChallenge(page: Page, deadline: number | undefined): Promise<void> {
    const challengeDeadline = performance.now() + CamoufoxFetchStrategy.CHALLENGE_MAX_WAIT_MS

    while (performance.now() < challengeDeadline) {
      const title = await page.title().catch(() => "")

      if (!CamoufoxFetchStrategy.CHALLENGE_TITLE.test(title)) {
        return
      }

      if (deadline !== undefined && performance.now() >= deadline) {
        return
      }

      await page.waitForTimeout(CamoufoxFetchStrategy.CHALLENGE_POLL_MS)
    }
  }

  /** Scrolls down until the page height stops growing. */
  private async scrollToEnd(page: Page, deadline: number | undefined): Promise<void> {
    const readHeight = () => page.evaluate(() => document.documentElement.scrollHeight)
    let lastHeight = await readHeight()

    for (let step = 0; step < CamoufoxFetchStrategy.MAX_SCROLL_STEPS; step++) {
      if (deadline !== undefined && performance.now() >= deadline) {
        return
      }

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForTimeout(CamoufoxFetchStrategy.SCROLL_DELAY_MS)

      const height = await readHeight()

      if (height === lastHeight) {
        return
      }

      lastHeight = height
    }
  }

  /** Remaining time in ms for Playwright. 0 = no timeout; throws if the deadline already passed. */
  private remaining(deadline: number | undefined): number {
    if (deadline === undefined) {
      return 0
    }

    const remaining = Math.floor(deadline - performance.now())

    if (remaining < 1) {
      throw new FetchError("Timeout exceeded", this.engine, FetchErrorKind.Timeout)
    }

    return remaining
  }

  private cap(timeoutMs: number, maxMs: number): number {
    if (timeoutMs === 0) {
      return maxMs
    }

    return Math.min(timeoutMs, maxMs)
  }

  private toResponseCookie(cookie: {
    name: string
    value: string
    domain: string
    path: string
    expires: number
    httpOnly: boolean
    secure: boolean
    sameSite: string
  }): ResponseCookie {
    return new ResponseCookie(
      cookie.name,
      cookie.value,
      cookie.domain,
      cookie.path,
      cookie.expires > 0 ? new Date(cookie.expires * 1000).toUTCString() : undefined,
      undefined,
      cookie.httpOnly,
      cookie.secure,
      cookie.sameSite,
    )
  }

  private toFetchError(error: unknown): FetchError {
    if (error instanceof FetchError) {
      return error
    }

    const message = error instanceof Error ? error.message : String(error)

    if (error instanceof Error && error.name === "TimeoutError") {
      return new FetchError(message, this.engine, FetchErrorKind.Timeout, undefined, { cause: error })
    }

    return new FetchError(message, this.engine, FetchErrorKind.Network, undefined, { cause: error })
  }
}
