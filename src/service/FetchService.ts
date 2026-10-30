import { FetchEngine } from "../model/FetchEngine"
import { FetchAttempt, FetchError, FetchErrorKind, FetchFailedError } from "../model/FetchError"
import type { FetchRequest } from "../model/FetchRequest"
import type { FetchResponse } from "../model/FetchResponse"
import type { FetchStrategy } from "./engine/FetchStrategy"
import { HtmlSanitizerService } from "./HtmlSanitizerService"
import { JsWallDetectorService } from "./JsWallDetectorService"

export class FetchService {
  /**
   * @param strategies registered engines; their order is the default order
   */
  constructor(
    private strategies: FetchStrategy[],
    private htmlSanitizer: HtmlSanitizerService = new HtmlSanitizerService(),
    private jsWallDetector: JsWallDetectorService = new JsWallDetectorService(),
  ) {}

  /** Only the (sanitized) response content. */
  async fetchContent(params: FetchRequest): Promise<string> {
    const response = await this.fetchDetails(params)

    return response.content
  }

  /**
   * Tries the engines in order and escalates to the next one on errors, status codes > 299 or
   * (unless `executeJavaScript` is false) if a JS wall was detected in a response of an engine without JS.
   * @throws FetchFailedError if no engine delivered a usable response
   */
  async fetchDetails(params: FetchRequest): Promise<FetchResponse> {
    const start = performance.now()
    const candidates = this.selectStrategies(params)

    if (candidates.length === 0) {
      throw new FetchFailedError("No fetch strategy applicable for the given parameters", [])
    }

    const attempts: FetchAttempt[] = []

    for (const strategy of candidates) {
      try {
        const response = await strategy.fetch(params)
        const problem = this.findProblem(strategy, params, response)

        if (problem === undefined) {
          return this.finalize(response, start)
        }

        attempts.push(problem)
      } catch (error) {
        attempts.push(this.toAttempt(strategy, error))
      }
    }

    const summary = attempts.map((attempt) => `${attempt.engine}: ${attempt.message}`).join("; ")

    throw new FetchFailedError(`Fetching failed with all strategies (${summary})`, attempts)
  }

  private selectStrategies(params: FetchRequest): FetchStrategy[] {
    const requested = params.strategies ?? this.strategies.map((strategy) => strategy.engine)
    const engines: FetchEngine[] = [...new Set(requested)]
    const needsJavaScript = params.executeJavaScript === true || params.loadLazyContent === true

    return engines
      .map((engine) => this.strategies.find((strategy) => strategy.engine === engine))
      .filter((strategy): strategy is FetchStrategy => strategy !== undefined)
      .filter((strategy) => !needsJavaScript || strategy.executesJavaScript)
  }

  private findProblem(strategy: FetchStrategy, params: FetchRequest, response: FetchResponse): FetchAttempt | undefined {
    if (!this.isAcceptableStatus(response.statusCode, params)) {
      return new FetchAttempt(
        strategy.engine,
        FetchErrorKind.HttpStatus,
        `HTTP status ${response.statusCode}`,
        response.statusCode,
      )
    }

    // Engines with JavaScript render the page themselves: a <noscript> hint in the DOM is no wall there
    if (response.isHtml && !strategy.executesJavaScript && params.executeJavaScript !== false) {
      const reason = this.jsWallDetector.detect(response.content)

      if (reason !== undefined) {
        return new FetchAttempt(
          strategy.engine,
          FetchErrorKind.JsWall,
          `JavaScript required (${reason})`,
          response.statusCode,
        )
      }
    }

    return undefined
  }

  private isAcceptableStatus(statusCode: number, params: FetchRequest): boolean {
    if (statusCode >= 200 && statusCode <= 299) {
      return true
    }

    // without following redirects a 3xx is the expected result
    return !params.followRedirects && statusCode >= 300 && statusCode <= 399
  }

  private finalize(response: FetchResponse, start: number): FetchResponse {
    if (response.isHtml) {
      response.content = this.htmlSanitizer.sanitize(response.content, response.finalUrl)
    }

    response.elapsedMs = Math.round(performance.now() - start)

    return response
  }

  private toAttempt(strategy: FetchStrategy, error: unknown): FetchAttempt {
    if (error instanceof FetchError) {
      return new FetchAttempt(strategy.engine, error.kind, error.message, error.statusCode)
    }

    const message = error instanceof Error ? error.message : String(error)

    return new FetchAttempt(strategy.engine, FetchErrorKind.Other, message)
  }
}
