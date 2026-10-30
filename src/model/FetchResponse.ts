import { ContentType } from "./ContentType"
import type { FetchEngine } from "./FetchEngine"
import type { SetCookieParser } from "../service/SetCookieParser"

export enum ContentEncoding {
  /** `content` is the decoded text. */
  Text = "Text",
  /** `content` is the base64 encoded binary data. */
  Base64 = "Base64",
}

/** Details of a fetched response (= the JSON wrapper). */
export class FetchResponse {

  private static HtmlRegex = /^\s*(<!doctype\s+html|<html[\s>])/i


  constructor(
    /** Decoded text (HTML after sanitizing) or the raw bytes of a binary response (images, PDFs, ...). */
    readonly content: string | Uint8Array,
    readonly statusCode: number,
    /** Response headers with lower-case names, without `set-cookie` (see `cookies`). */
    readonly headers: Record<string, string>,
    /** The raw `Set-Cookie` header values. */
    readonly cookies: string[],
    /** Total elapsed time in milliseconds, including failed attempts of previous engines. */
    readonly elapsedMs: number,
    /** The url after following redirects. */
    readonly finalUrl: string,
    /** The engine that produced this response. */
    readonly engine: FetchEngine,
  ) {}

  get contentType(): ContentType {
    return new ContentType(this.headers["content-type"])
  }

  get isText(): boolean {
    return typeof this.content === "string"
  }

  /** True for HTML / XHTML responses. Without content type the (text) content is sniffed. */
  get isHtml(): boolean {
    const contentType = this.contentType

    if (contentType.mimeType === undefined) {
      return typeof this.content === "string" && FetchResponse.HtmlRegex.test(this.content)
    }

    return contentType.isHtml
  }

  get contentEncoding(): ContentEncoding {
    return this.isText ? ContentEncoding.Text : ContentEncoding.Base64
  }

  with(changes: { content?: string | Uint8Array; elapsedMs?: number }): FetchResponse {
    return new FetchResponse(
      changes.content ?? this.content,
      this.statusCode,
      this.headers,
      this.cookies,
      changes.elapsedMs ?? this.elapsedMs,
      this.finalUrl,
      this.engine,
    )
  }

  /** The JSON wrapper. Binary content is base64 encoded. */
  toJSON(cookieParser?: SetCookieParser) {
    return {
      statusCode: this.statusCode,
      contentEncoding: this.contentEncoding,
      contentType: this.headers["content-type"],
      finalUrl: this.finalUrl,
      engine: this.engine,
      elapsedMs: this.elapsedMs,
      headers: this.headers,
      cookies: this.cookies,
      cookiesParsed: cookieParser?.parseAll(this.cookies),
      // post content as last so that JSON is better human readable
      content: typeof this.content === "string" ? this.content : Buffer.from(this.content).toString("base64"),
    }
  }

}
