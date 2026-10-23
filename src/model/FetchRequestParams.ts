import type { FetchEngine } from "./FetchEngine"

/**
 * Parsed and validated request parameters, shared by GET and POST and by the MCP tools.
 * Never instantiated, therefore an interface.
 */
export interface FetchRequestParams {
  /** The only required parameter (http / https). */
  url: string

  /** In seconds. Unset or < 1 = no timeout. */
  timeout?: number

  /** Browser fingerprint, e.g. `firefox`, `chrome`, `firefox144`, `chrome131`. Defaults to `chrome`. */
  fingerprint?: string

  /** Defaults to true. */
  followRedirects: boolean

  /** Engines to try, in order. Unset = default order. */
  strategies?: FetchEngine[]

  /** unset: default behaviour, true: skips Impit, false: disables JS in Camoufox (and never escalates because of a JS wall). */
  executeJavaScript?: boolean

  /** If true, Camoufox scrolls to the end of the page to trigger lazy loading content. */
  loadLazyContent?: boolean

  /** Headers to send to the target url. */
  headers?: Record<string, string>

  /** Cookies to send to the target url. */
  cookies?: Record<string, string>
}
