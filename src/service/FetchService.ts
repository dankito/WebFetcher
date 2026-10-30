import { EngineFailure, EngineFailureKind } from "../model/EngineFailure"
import type { FetchEngine } from "../model/FetchEngine"
import { FetchError, FetchErrorReason } from "../model/FetchError"
import type { FetchRequest } from "../model/FetchRequest"
import type { FetchResponse } from "../model/FetchResponse"
import type { Fetcher } from "./fetcher/Fetcher"
import { HtmlSanitizerService } from "./HtmlSanitizerService"
import { JsWallDetectorService } from "./JsWallDetectorService"
import { Stopwatch } from "./Stopwatch"
import type { UrlGuardService } from "./UrlGuardService"

export class FetchService {
  /**
   * @param fetchers registered engines; their order is the default order
   */
  constructor(
    private readonly fetchers: Fetcher[],
    private readonly urlGuard: UrlGuardService,
    private readonly htmlSanitizer: HtmlSanitizerService = new HtmlSanitizerService(),
    private readonly jsWallDetector: JsWallDetectorService = new JsWallDetectorService(),
  ) {}

  /** Only the (sanitized) response content: text, or the raw bytes of binary responses. */
  async fetchContent(request: FetchRequest): Promise<string | Uint8Array | FetchError> {
    const result = await this.fetchDetails(request)

    if (result instanceof FetchError) {
      return result
    }

    return result.content
  }

  /**
   * Tries the engines in order and escalates to the next one on failures, status codes > 299 or
   * (unless `executeJavaScript` is false) if a JS wall was detected in a response of an engine without JS.
   * Returns a FetchError if no engine delivered a usable response.
   */
  async fetchDetails(request: FetchRequest): Promise<FetchResponse | FetchError> {
    const stopwatch = Stopwatch.start()
    const violation = await this.urlGuard.findViolation(request.url)

    if (violation !== undefined) {
      return new FetchError(FetchErrorReason.ForbiddenAddress, violation)
    }

    const candidates = this.selectFetchers(request)

    if (candidates.length === 0) {
      return new FetchError(
        FetchErrorReason.NoApplicableEngine,
        "No engine applicable for the given engines and options (e.g. executeJavaScript=true requires a JavaScript engine)",
      )
    }

    const failures: EngineFailure[] = []

    for (const fetcher of candidates) {
      const result = await fetcher.fetch(request)

      if (result instanceof EngineFailure) {
        failures.push(result)
        continue
      }

      const problem = this.findProblem(fetcher, request, result)

      if (problem === undefined) {
        return this.finalize(result, stopwatch)
      }

      failures.push(problem)
    }

    const allTimeouts = failures.every(failure => failure.kind === EngineFailureKind.Timeout)
    const summary = failures.map(failure => `${failure.engine}: ${failure.message}`).join("; ")

    return new FetchError(
      allTimeouts ? FetchErrorReason.Timeout : FetchErrorReason.AllEnginesFailed,
      `Fetching failed with all engines (${summary})`,
      failures,
    )
  }

  private selectFetchers(request: FetchRequest): Fetcher[] {
    const requested = request.engines ?? this.fetchers.map(fetcher => fetcher.engine)
    const engines: FetchEngine[] = [...new Set(requested)]

    return engines.flatMap(engine => {
      const fetcher = this.fetchers.find(candidate => candidate.engine === engine)

      if (fetcher === undefined || (request.requiresJavaScript && !fetcher.executesJavaScript)) {
        return []
      }

      return [fetcher]
    })
  }

  private findProblem(fetcher: Fetcher, request: FetchRequest, response: FetchResponse): EngineFailure | undefined {
    if (!this.isAcceptableStatus(response.statusCode, request)) {
      return new EngineFailure(
        fetcher.engine,
        EngineFailureKind.HttpStatus,
        `HTTP status ${response.statusCode}`,
        response.statusCode,
      )
    }

    // Engines with JavaScript render the page themselves: a <noscript> hint in the DOM is no wall there
    if (typeof response.content === "string" && response.isHtml && !fetcher.executesJavaScript && !request.javaScriptDisabled) {
      const reason = this.jsWallDetector.detect(response.content)

      if (reason !== undefined) {
        return new EngineFailure(
          fetcher.engine,
          EngineFailureKind.JsWall,
          `JavaScript required (${reason})`,
          response.statusCode,
        )
      }
    }

    return undefined
  }

  private isAcceptableStatus(statusCode: number, request: FetchRequest): boolean {
    if (statusCode >= 200 && statusCode <= 299) {
      return true
    }

    // without following redirects a 3xx is the expected result
    return !request.followRedirects && statusCode >= 300 && statusCode <= 399
  }

  private finalize(response: FetchResponse, stopwatch: Stopwatch): FetchResponse {
    if (typeof response.content === "string" && response.isHtml) {
      return response.with({
        content: this.htmlSanitizer.sanitize(response.content, response.finalUrl),
        elapsedMs: stopwatch.elapsedMs,
      })
    }

    return response.with({ elapsedMs: stopwatch.elapsedMs })
  }
}
