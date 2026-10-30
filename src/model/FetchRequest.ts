import type { FetchEngine } from "./FetchEngine"

export type FetchRequestData = Pick<
  FetchRequest,
  | "url"
  | "timeout"
  | "fingerprint"
  | "followRedirects"
  | "engines"
  | "executeJavaScript"
  | "loadLazyContent"
  | "headers"
  | "cookies"
>

/** The parsed and validated parameters of a fetch request, shared by GET, POST and the MCP tools. */
export class FetchRequest {

  constructor(
    /** The only required parameter (http / https). */
    readonly url: string,
    /** In seconds. Unset or < 1 = no timeout. */
    readonly timeout?: number,
    /** Browser fingerprint, e.g. `firefox`, `chrome`, `firefox144`, `chrome131`. Defaults to `chrome`. */
    readonly fingerprint?: string,
    /** Defaults to true. Ignored by Camoufox (a browser always follows redirects). */
    readonly followRedirects: boolean = true,
    /** Engines to try, in order. Unset = default order. */
    readonly engines?: FetchEngine[],
    /** unset: default behaviour, true: skips Impit, false: disables JS in Camoufox (and never escalates because of a JS wall). */
    readonly executeJavaScript?: boolean,
    /** If true, Camoufox scrolls to the end of the page to trigger lazy loading content. */
    readonly loadLazyContent?: boolean,
    /** Headers to send to the target url. */
    readonly headers?: Record<string, string>,
    /** Cookies to send to the target url. */
    readonly cookies?: Record<string, string>,
  ) {}

  static from(data: FetchRequestData): FetchRequest {
    return new FetchRequest(
      data.url,
      data.timeout,
      data.fingerprint,
      data.followRedirects,
      data.engines,
      data.executeJavaScript,
      data.loadLazyContent,
      data.headers,
      data.cookies,
    )
  }

  /** Timeout in milliseconds or undefined for no timeout. */
  get timeoutMs(): number | undefined {
    if (this.timeout === undefined || this.timeout < 1) {
      return undefined
    }

    return this.timeout * 1000
  }

  timeoutMsOrDefault(defaultTimeoutMs: number): number {
    return this.timeoutMs ?? defaultTimeoutMs
  }

  /** True if only engines that execute JavaScript are applicable. */
  get requiresJavaScript(): boolean {
    return this.executeJavaScript === true || this.loadLazyContent === true
  }

  get javaScriptDisabled(): boolean {
    return this.executeJavaScript === false
  }

  get hasHeaders(): boolean {
    return this.headers !== undefined && Object.keys(this.headers).length > 0
  }

  get hasCookies(): boolean {
    return this.cookies !== undefined && Object.keys(this.cookies).length > 0
  }

  /** The cookies as value of a `Cookie` header, e.g. `a=1; b=2`. */
  get cookieHeader(): string | undefined {
    if (!this.cookies || !this.hasCookies) {
      return undefined
    }

    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ")
  }

  /** The headers including the cookies as `Cookie` header (appended to a `Cookie` header from `headers`, if there is one). */
  get headersWithCookie(): Record<string, string> {
    const headers: Record<string, string> = { ...this.headers }
    const cookieHeader = this.cookieHeader

    if (cookieHeader === undefined) {
      return headers
    }

    const existingKey = Object.keys(headers).find(key => key.toLowerCase() === "cookie")

    if (existingKey === undefined) {
      headers.Cookie = cookieHeader
    } else {
      headers[existingKey] = `${headers[existingKey]}; ${cookieHeader}`
    }

    return headers
  }
}
