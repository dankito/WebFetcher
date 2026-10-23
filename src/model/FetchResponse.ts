import type { FetchEngine } from "./FetchEngine"
import type { ResponseCookie } from "./ResponseCookie"

/** Details of a fetched response (= the JSON wrapper). */
export class FetchResponse {

  constructor(
    /** Decoded response content. For HTML already passed through the HtmlSanitizerService. */
    public content: string,
    public statusCode: number,
    /** Response headers (lower-case names). Multiple `set-cookie` headers are joined by a newline. */
    public headers: Record<string, string>,
    public cookies: ResponseCookie[],
    /** Total elapsed time in milliseconds, including failed attempts of previous engines. */
    public elapsedMs: number,
    /** The url after following redirects. */
    public finalUrl: string,
    /** The engine that produced this response. */
    public engine: FetchEngine,
  ) {}


  /** Mime type without parameters, e.g. `text/html`. */
  get mimeType(): string | undefined {
    const contentType = this.headers["content-type"]

    if (!contentType) {
      return undefined
    }

    return contentType.split(";")[0]?.trim().toLowerCase()
  }

  /** True for HTML / XHTML responses. Without content type the content is sniffed. */
  get isHtml(): boolean {
    const mimeType = this.mimeType

    if (mimeType === undefined) {
      return /^\s*(<!doctype\s+html|<html[\s>])/i.test(this.content)
    }

    return mimeType === "text/html" || mimeType === "application/xhtml+xml"
  }

}
